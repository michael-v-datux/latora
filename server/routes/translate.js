/**
 * server/routes/translate.js — Маршрут перекладу
 *
 * POST /api/translate
 * Тіло запиту: { word: "serendipity" }
 *
 * Логіка:
 * 1. Перевіряємо чи слово вже є в базі (кеш)
 * 2. Якщо ні — перекладаємо через DeepL
 * 3. Оцінюємо складність через Claude AI
 * 4. Зберігаємо в базу для майбутніх запитів
 * 5. Повертаємо результат
 */

const express = require('express');
const router = express.Router();

router.get('/languages', async (req, res, next) => {
  try {
    const source = await getLanguages('source');
    const target = await getLanguages('target');
    return res.json({ source, target });
  } catch (e) {
    return next(e);
  }
});

const { translateText, getLanguages } = require('../services/deepl');
const { assessDifficulty } = require('../services/difficulty');
const { detectIdioms } = require('../services/idioms');
// public (anon) client: можна читати words, але писати в words після RLS — ні
const supabase = require('../lib/supabase.server.cjs');
// admin (service role) client: пишемо кеш words (bypasses RLS)
const supabaseAdmin = require('../lib/supabase.admin.cjs');

const NOT_FOUND_MSG = 'Цього слова немає у словнику';

// Назви мов для повідомлень про помилку (baseLang → локалізована назва)
const LANG_NAMES_UK = {
  EN: 'англійською',
  UK: 'українською',
  DE: 'німецькою',
  FR: 'французькою',
  IT: 'італійською',
  ES: 'іспанською',
  PL: 'польською',
  CS: 'чеською',
  HU: 'угорською',
  SV: 'шведською',
  RO: 'румунською',
  LT: 'литовською',
  LV: 'латиською',
  ET: 'естонською',
};

function normalizeLang(code) {
  return (code || '').trim().toUpperCase();
}

function baseLang(code) {
  // ES-419 -> ES, EN-GB -> EN
  return normalizeLang(code).split('-')[0];
}
function normalize(s) {
  return (s || '').trim().replace(/\s+/g, ' ');
}

/** Перевіряє чи відповідає слово очікуваній мові (source_lang) */
function detectInputScript(text) {
  const s = normalize(text);
  const latinCount = (s.match(/[a-zA-Z]/g) || []).length;
  const cyrillicCount = (s.match(/[\u0400-\u04FF]/g) || []).length;
  const total = latinCount + cyrillicCount;
  if (total === 0) return 'unknown';
  return latinCount > cyrillicCount ? 'latin' : 'cyrillic';
}

/** Повертає очікуваний скрипт для мови */
function expectedScript(langCode) {
  const base = baseLang(langCode);
  // Кирилиця: UK (Ukrainian), RU, BG, MK, SR
  if (['UK', 'RU', 'BG', 'MK', 'SR'].includes(base)) return 'cyrillic';
  // Латиниця: решта підтримуваних мов
  return 'latin';
}

function looksLikeWord(input) {
  const s = normalize(input);
  if (s.length < 2 || s.length > 40) return false;

  // Дозволяємо: латиниця/кирилиця + пробіли + апострофи + дефіси
  const ok = /^[a-zA-Z\u0400-\u04FF\s''-]+$/.test(s);
  if (!ok) return false;

  // Відсікаємо латиницю без голосних (типу xqzvprm)
  const isLatin = /^[a-zA-Z\s''-]+$/.test(s);
  if (isLatin) {
    const hasVowel = /[aeiouy]/i.test(s);
    if (!hasVowel) return false;
  }

  return true;
}

function isIdentityTranslation(original, translation) {
  const a = normalize(original).toLowerCase();
  const b = normalize(translation).toLowerCase();
  return a === b;
}

router.post('/translate', async (req, res) => {
  try {
    const { word, source_lang, target_lang } = req.body;

    // Валідація
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      return res.status(400).json({ error: 'Слово не може бути порожнім' });
    }

    const cleanWordRaw = normalize(word);
    const cleanWord = cleanWordRaw.toLowerCase();

    const srcLang = String(source_lang || 'EN').trim().toUpperCase();
    const tgtLang = String(target_lang || 'UK').trim().toUpperCase();

    // Евристичний фільтр: не викликаємо DeepL і не кешуємо сміття
    if (!looksLikeWord(cleanWordRaw)) {
      console.log(`🧹 Reject (not a word): "${cleanWordRaw}"`);
      return res.json({
        error: NOT_FOUND_MSG,
        _source: 'guard',
      });
    }

    // Баг 3: перевіряємо чи скрипт вводу відповідає source_lang
    const inputScript = detectInputScript(cleanWordRaw);
    const expScript = expectedScript(srcLang);
    if (inputScript !== 'unknown' && inputScript !== expScript) {
      const baseSrc = baseLang(srcLang);
      const langName = LANG_NAMES_UK[baseSrc] || srcLang;
      return res.json({
        error: `Слово для перекладу має бути написане ${langName}`,
        errorCode: 'WRONG_SCRIPT',
        expectedLang: langName,
        _source: 'script_guard',
      });
    }

    // Крок 1: Перевіряємо кеш (чи вже перекладали це слово)
    const { data: cached, error: cacheError } = await supabase
      .from('words')
      .select('*')
      .eq('original', cleanWord)
      .eq('source_lang', srcLang)
      .eq('target_lang', tgtLang)
      .maybeSingle();

    if (cacheError) {
      console.warn('⚠️ Cache read error:', cacheError.message);
    }

    if (cached) {
      console.log(`📦 Кеш: "${cleanWord}" вже є в базі`);
      return res.json({ ...cached, _source: 'cache' });
    }

    // Крок 2: Переклад через DeepL
    console.log(`🔤 Перекладаємо: "${cleanWord}"`);
    const { translation: deeplTranslation } = await translateText(cleanWord, srcLang, tgtLang);

    // Якщо DeepL повернув те саме — вважаємо "немає у словнику" і НЕ кешуємо
    if (!deeplTranslation || isIdentityTranslation(cleanWord, deeplTranslation)) {
      console.log(`🧹 Not caching identity/empty translation: "${cleanWord}" -> "${deeplTranslation || ''}"`);
      return res.json({
        error: NOT_FOUND_MSG,
        _source: 'deepl_identity',
      });
    }

    // Крок 2.5: Виявлення ідіом (не ламає потік; при помилці просто пропускаємо)
    let idiom = null;
    try {
      idiom = await detectIdioms({
        original: cleanWordRaw,
        sourceLang: srcLang,
        targetLang: tgtLang,
        literalTranslation: deeplTranslation,
      });
    } catch (e) {
      console.warn('⚠️ Idiom detect error:', e?.message || e);
      idiom = null;
    }

    // Якщо це ідіома — основний переклад робимо "idiomatic" (перший варіант),
    // а DeepL лишаємо як literal у alt_translations
    const primaryTranslation = (idiom && idiom.is_idiom && Array.isArray(idiom.idiomatic_translations) && idiom.idiomatic_translations[0])
      ? idiom.idiomatic_translations[0]
      : deeplTranslation;

    // Крок 3: Difficulty Engine v2 (BaseScore + AI Adjustment)
    console.log(`🧠 Оцінюємо складність v2: "${cleanWord}"`);
    const difficulty = await assessDifficulty(cleanWord, primaryTranslation, {
      sourceLang: srcLang,
      targetLang: tgtLang,
    });

    // Крок 4: Зберігаємо в базу (включаючи нові поля v2)
    const wordData = {
      original: cleanWord,
      source_lang: srcLang,
      target_lang: tgtLang,
      translation: primaryTranslation,
      transcription:    difficulty.transcription,
      difficulty_score: difficulty.difficulty_score,
      cefr_level:       difficulty.cefr_level,
      difficulty_factors: difficulty.factors,
      example_sentence: difficulty.example_sentence,
      part_of_speech:   difficulty.part_of_speech,

      // ── Difficulty Engine v2: нові поля ──────────────────────────
      base_score:       difficulty.base_score,
      ai_adjustment:    difficulty.ai_adjustment,
      confidence_score: difficulty.confidence_score,
      frequency_band:   difficulty.frequency_band,
      polysemy_level:   difficulty.polysemy_level,
      morph_complexity: difficulty.morph_complexity,
      phrase_flag:      difficulty.phrase_flag,
      // ─────────────────────────────────────────────────────────────

      // Для ідіом: зберігаємо ідіоматичні варіанти + literal(DeepL)
      alt_translations: (idiom && idiom.is_idiom)
        ? {
            idiomatic: idiom.idiomatic_translations,
            literal: idiom.literal_translation || deeplTranslation,
          }
        : null,
      translation_notes: (idiom && idiom.is_idiom) ? idiom.note : null,
      translation_kind:  (idiom && idiom.is_idiom) ? 'idiom' : null,
    };

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('words')
      // upsert щоб не падати на UNIQUE(original) у випадку гонки
      .upsert(wordData, { onConflict: 'original,source_lang,target_lang' })
      .select()
      .single();

    if (saveError) {
      console.warn('⚠️ Не вдалось зберегти в базу:', saveError.message);
      // Все одно повертаємо результат (навіть якщо кеш не спрацював)
      return res.json({ ...wordData, _source: 'ai', _cacheSaved: false });
    }

    console.log(`✅ Збережено: "${cleanWord}" (${difficulty.cefr_level}, ${difficulty.difficulty_score}/100)`);
    return res.json({ ...saved, _source: 'ai', _cacheSaved: true });

  } catch (error) {
    console.error('❌ Помилка перекладу:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;