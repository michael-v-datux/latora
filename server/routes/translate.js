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
const { translateText, getLanguages } = require('../services/deepl');
const { assessDifficulty } = require('../services/difficulty');
const { enrichIdioms } = require('../services/idioms');
// public (anon) client: можна читати words, але писати в words після RLS — ні
const supabase = require('../lib/supabase.server.cjs');
// admin (service role) client: пишемо кеш words (bypasses RLS)
const supabaseAdmin = require('../lib/supabase.admin.cjs');

const NOT_FOUND_MSG = 'Цього слова немає у словнику';

function normalize(s) {
  return (s || '').trim().replace(/\s+/g, ' ');
}

function looksLikeWord(input) {
  const s = normalize(input);
  if (s.length < 2 || s.length > 40) return false;

  // Дозволяємо: будь-які літери (Unicode) + пробіли + апострофи + дефіси
  // (під європейські мови з діакритикою)
  const ok = /^[\p{L}\s'’\-–—\.]+$/u.test(s);
  if (!ok) return false;

  return true;
}

function isIdentityTranslation(original, translation) {
  const a = normalize(original).toLowerCase();
  const b = normalize(translation).toLowerCase();
  return a === b;
}

router.post('/translate', async (req, res) => {
  try {
    const { word, sourceLang, targetLang } = req.body;

    // Валідація
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      return res.status(400).json({ error: 'Слово не може бути порожнім' });
    }

    const cleanWordRaw = normalize(word);
    const cleanWord = cleanWordRaw.toLowerCase();

    const sl = String(sourceLang || 'EN').toUpperCase();
    const tl = String(targetLang || 'UK').toUpperCase();

    // Евристичний фільтр: не викликаємо DeepL і не кешуємо сміття
    if (!looksLikeWord(cleanWordRaw)) {
      console.log(`🧹 Reject (not a word): "${cleanWordRaw}"`);
      return res.json({
        error: NOT_FOUND_MSG,
        _source: 'guard',
      });
    }

    // Крок 1: Перевіряємо кеш (чи вже перекладали це слово)
    const { data: cached, error: cacheError } = await supabase
      .from('words')
      .select('*')
      .eq('original', cleanWord)
      .eq('source_lang', sl)
      .eq('target_lang', tl)
      .maybeSingle();

    if (cacheError) {
      console.warn('⚠️ Cache read error:', cacheError.message);
    }

    if (cached) {
      console.log(`📦 Кеш: "${cleanWord}" вже є в базі`);
      return res.json({ ...cached, _source: 'cache' });
    }

    // Крок 2: Переклад через DeepL
    console.log(`🔤 Перекладаємо: "${cleanWord}" ${sl}→${tl}`);
    const { translation } = await translateText(cleanWord, { sourceLang: sl, targetLang: tl });

    // Якщо DeepL повернув те саме — вважаємо "немає у словнику" і НЕ кешуємо
    if (!translation || isIdentityTranslation(cleanWord, translation)) {
      console.log(`🧹 Not caching identity/empty translation: "${cleanWord}" -> "${translation || ''}"`);
      return res.json({
        error: NOT_FOUND_MSG,
        _source: 'deepl_identity',
      });
    }

    // Крок 3: AI-оцінка складності
    console.log(`🧠 Оцінюємо складність: "${cleanWord}"`);
    const difficulty = await assessDifficulty(cleanWord, translation);

    // Optional enrichment: idioms / set phrases
    const idioms = await enrichIdioms({
      original: cleanWordRaw,
      baseTranslation: translation,
      sourceLang: sl,
      targetLang: tl,
    });

    // Крок 4: Зберігаємо в базу
    const wordData = {
      original: cleanWord,
      translation,
      source_lang: sl,
      target_lang: tl,
      transcription: difficulty.transcription,
      difficulty_score: difficulty.difficulty_score,
      cefr_level: difficulty.cefr_level,
      difficulty_factors: difficulty.factors,
      example_sentence: difficulty.example_sentence,
      part_of_speech: difficulty.part_of_speech,
      alt_translations: idioms?.alternatives || null,
      translation_notes: idioms?.note || null,
      translation_kind: idioms?.kind || null,
    };

    const { data: saved, error: saveError } = await supabaseAdmin
      .from('words')
      // upsert щоб не падати на UNIQUE(original, source_lang, target_lang) у випадку гонки
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

// GET /api/languages — DeepL supported languages (cached)
router.get('/languages', async (req, res) => {
  try {
    const [source, target] = await Promise.all([
      getLanguages('source'),
      getLanguages('target'),
    ]);
    return res.json({ source, target });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;