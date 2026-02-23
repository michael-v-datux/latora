/**
 * server/services/difficulty.js — Difficulty Engine v2
 *
 * Архітектура:
 *   FinalScore = clamp(BaseScore + AI_Adjustment, 0, 100)
 *
 *   1. BaseScore   — детерміністичний, стабільний, дешевий (без LLM)
 *      Компоненти: CEFR numeric · frequency_band · polysemy_level ·
 *                  morph_complexity · word_length · phrase_flag
 *
 *   2. AI Adjustment Layer — Claude Haiku повертає ТІЛЬКИ:
 *      adjustment (-15…+15) · confidence (0–100) · short_reason
 *      (НЕ повний difficulty — контроль залишається у движку)
 *
 *   3. confidence_score — зважена метрика надійності
 *
 * Personal Modifier Layer живе у srsService.js і розраховується
 * при кожному повторенні (не при перекладі).
 */

const Anthropic = require('@anthropic-ai/sdk');

let anthropic;
try {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch (e) {
  console.warn('⚠️  Anthropic API не налаштовано. AI-adjustment буде недоступний.');
}

// ─── CEFR ↔ числовий ────────────────────────────────────────────────────────

const CEFR_TO_NUM = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
const CEFR_ORDER  = ['A1','A2','B1','B2','C1','C2'];

function cefrToNum(level) {
  return CEFR_TO_NUM[String(level).toUpperCase()] ?? 3; // default B1
}

function scoreToCefr(score) {
  if (score <= 17) return 'A1';
  if (score <= 33) return 'A2';
  if (score <= 50) return 'B1';
  if (score <= 66) return 'B2';
  if (score <= 83) return 'C1';
  return 'C2';
}

// ─── Детерміністичний BaseScore ──────────────────────────────────────────────

/**
 * Підрахунок складів (спрощений алгоритм для латиниці / кирилиці)
 */
function countSyllables(word) {
  const w = word.toLowerCase();
  if (w.length <= 3) return 1;
  // Кирилиця: голосні а е є и і ї о у ю я
  if (/[\u0400-\u04FF]/.test(w)) {
    const m = w.match(/[аеєиіїоуюя]/g);
    return m ? m.length : 1;
  }
  // Латиниця
  let cleaned = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = cleaned.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

/**
 * frequency_band (1–5) — евристика за довжиною та силабами (без корпусу).
 * Реальний корпусний rank може замінити це поле пізніше.
 * 1 = дуже часте, 5 = рідкісне
 */
function estimateFrequencyBand(word) {
  const len = word.length;
  const syl = countSyllables(word);
  // Короткі слова зазвичай частіші
  if (len <= 4 && syl === 1) return 1;
  if (len <= 6 && syl <= 2) return 2;
  if (len <= 9 && syl <= 3) return 3;
  if (len <= 12 && syl <= 4) return 4;
  return 5;
}

/**
 * polysemy_level (1–5) — евристика (справжній рівень повертає AI)
 */
function estimatePolysemyLevel(word, partOfSpeech) {
  // Іменники та дієслова зазвичай більш полісемантичні
  const pos = (partOfSpeech || '').toLowerCase();
  if (['noun','verb'].includes(pos)) return 3;
  if (['adjective','adverb'].includes(pos)) return 2;
  return 2;
}

/**
 * morph_complexity (1–5) — правило-базована оцінка
 */
function morphComplexity(word) {
  const w = word.toLowerCase();
  let score = 1;
  // Суфікси що підвищують складність
  const complexSuffixes = [
    'tion','sion','ness','ment','ity','ous','ious','eous',
    'ance','ence','ful','less','able','ible','ish','ise','ize',
  ];
  for (const sfx of complexSuffixes) {
    if (w.endsWith(sfx)) { score += 1; break; }
  }
  // Складні буквосполучення для слов'янськомовних
  const hardClusters = ['th','wh','ough','sch','tch','dge','wr','kn','ph','gh'];
  let clusterHits = 0;
  for (const cl of hardClusters) {
    if (w.includes(cl)) clusterHits++;
  }
  score += Math.min(2, clusterHits);

  // Довгі слова → складніша морфологія
  if (word.length > 12) score += 1;

  return Math.min(5, score);
}

/**
 * phrase_flag — true якщо слово містить пробіл або є складним виразом
 */
function detectPhrase(word) {
  return word.trim().includes(' ') || word.includes('-');
}

/**
 * Основний детерміністичний BaseScore (0–100)
 *
 * Ваги підібрані щоб:
 *  - A1/A2 → 0–33
 *  - B1/B2 → 34–66
 *  - C1/C2 → 67–100
 */
function computeBaseScore({ word, cefrNum, frequencyBand, polysemyLevel, morphComplexityVal, phraseFlag }) {
  // Нормалізуємо кожен компонент до 0–1
  const cefrScaled    = (cefrNum - 1)          / 5;           // 0=A1, 1=C2
  const freqScaled    = (frequencyBand - 1)    / 4;           // 0=common, 1=rare
  const polyScaled    = (polysemyLevel - 1)    / 4;
  const morphScaled   = (morphComplexityVal - 1) / 4;
  const lengthRaw     = Math.min(word.length, 15);
  const lengthScaled  = (lengthRaw - 2) / 13;                 // нормалізуємо 2–15 chars
  const phraseAdd     = phraseFlag ? 0.06 : 0;

  // Ваги (сума ≈ 1.0)
  const W_CEFR   = 0.35;
  const W_FREQ   = 0.20;
  const W_POLY   = 0.15;
  const W_MORPH  = 0.15;
  const W_LENGTH = 0.15;

  const raw =
    W_CEFR  * cefrScaled   +
    W_FREQ  * freqScaled   +
    W_POLY  * polyScaled   +
    W_MORPH * morphScaled  +
    W_LENGTH * lengthScaled +
    phraseAdd;

  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

// ─── Claude JSON-парсинг (robust) ────────────────────────────────────────────

function parseClaudeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') throw new Error('Claude returned empty response');
  let text = rawText.trim();

  if (text.includes('```')) {
    const s = text.indexOf('```');
    const e = text.indexOf('```', s + 3);
    if (s !== -1 && e > s) {
      let inner = text.slice(s + 3, e).trim();
      inner = inner.replace(/^json\s*/i, '').trim();
      text = inner;
    }
  }

  try { return JSON.parse(text); } catch (_) {}

  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }

  throw new Error(`Claude response is not valid JSON. Preview: "${text.slice(0, 200)}"`);
}

// ─── AI Adjustment Layer ─────────────────────────────────────────────────────

/**
 * Запит до Claude Haiku.
 * AI НЕ генерує повний difficulty — тільки adjustment + confidence + reason.
 *
 * @returns {{ adjustment: number, confidence: number, reason: string,
 *             cefr_level: string, part_of_speech: string,
 *             transcription: string, example_sentence: string,
 *             example_sentence_target: string,
 *             polysemy_level: number, definition: string, definition_uk: string }}
 */
async function getAiAdjustment({ word, translation, sourceLang, targetLang, baseScore }) {
  const srcLabel = sourceLang || 'EN';
  const tgtLabel = targetLang || 'UK';

  // Чи потрібне визначення українською?
  // Так — завжди (UI може бути UK навіть якщо вивчають польську)
  const needsUkDef = true;

  const prompt = `You are an expert in language teaching for ${tgtLabel}-speaking students learning ${srcLabel}.

The word/phrase "${word}" (translation: "${translation}") has a base difficulty score of ${baseScore}/100.

Respond ONLY with a valid JSON object:
{
  "adjustment": 5,
  "confidence": 78,
  "reason": "One concise sentence explaining the main difficulty nuance.",
  "cefr_level": "B2",
  "part_of_speech": "noun",
  "transcription": "/ˈwɜːrd/",
  "example_sentence": "A natural example sentence in ${srcLabel} using the word.",
  "example_sentence_target": "A natural example sentence in ${tgtLabel} using the translated word '${translation}'.",
  "polysemy_level": 3,
  "definition": "A concise English-language definition of the meaning.",
  "definition_uk": "Стисле визначення слова українською мовою."
}

Rules:
- adjustment: integer from -15 to +15. Positive = harder than base, negative = easier.
  Adjust for: semantic nuance, false friends, cultural context, irregular forms.
- confidence: 0–100 (your certainty about this assessment)
- cefr_level: A1 A2 B1 B2 C1 C2
- polysemy_level: 1(mono-semantic)–5(highly polysemous)
- transcription: IPA format, ${srcLabel} pronunciation
- example_sentence: in ${srcLabel} (source language), natural usage of "${word}"
- example_sentence_target: in ${tgtLabel} (target language), natural usage of the translated word "${translation}". Must be a different sentence from example_sentence.
- definition: a short, clear English definition of the word/phrase/idiom meaning.
  For single words: dictionary-style (e.g. "very silly; deserving to be laughed at").
  For idioms/fixed expressions: explain figurative meaning.
  For collocations/phrases: brief contextual description.
  Keep it under 120 characters. Do not include the word itself in the definition.
- definition_uk: same as definition but in Ukrainian. Keep under 120 characters.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = message.content[0]?.text?.trim() || '';
  return parseClaudeJson(raw);
}

// ─── Confidence Score ────────────────────────────────────────────────────────

/**
 * confidence_score = weighted(AI confidence, CEFR alignment, frequency reliability)
 */
function computeConfidence({ aiConfidence, aiCefr, baseScore }) {
  const baseCefr = scoreToCefr(baseScore);
  const cefrMatch = aiCefr === baseCefr ? 1.0 : (Math.abs(CEFR_ORDER.indexOf(aiCefr) - CEFR_ORDER.indexOf(baseCefr)) <= 1 ? 0.7 : 0.4);
  const normalized = Math.min(100, Math.max(0, aiConfidence));
  return Math.round(normalized * 0.7 + cefrMatch * 30);
}

// ─── Публічний API ───────────────────────────────────────────────────────────

/**
 * assessDifficulty — головна функція Difficulty Engine v2
 *
 * @param {string} word
 * @param {string} translation
 * @param {{ sourceLang?: string, targetLang?: string }} opts
 * @returns {{
 *   cefr_level: string,
 *   difficulty_score: number,        // FinalScore (0–100)
 *   base_score: number,
 *   ai_adjustment: number,
 *   confidence_score: number,
 *   frequency_band: number,
 *   polysemy_level: number,
 *   morph_complexity: number,
 *   phrase_flag: boolean,
 *   factors: object,
 *   example_sentence: string|null,         // у source_lang (напр. EN)
 *   example_sentence_target: string|null,  // у target_lang (напр. PL, DE …)
 *   part_of_speech: string|null,
 *   transcription: string|null,
 *   definition: string|null,               // англійською
 *   definition_uk: string|null,            // українською
 * }}
 */
async function assessDifficulty(word, translation, opts = {}) {
  const { sourceLang = 'EN', targetLang = 'UK' } = opts;

  // ── 1. Детерміністичні компоненти ─────────────────────────────────────────
  const phraseFlag        = detectPhrase(word);
  const frequencyBand     = estimateFrequencyBand(word);
  const morphComplexityVal = morphComplexity(word);
  // polysemy — попередній estimate, буде уточнений AI
  const polysemyEstimate  = estimatePolysemyLevel(word, null);

  // Тимчасовий CEFR (з базового алго) для розрахунку BaseScore
  // після AI отримаємо точніший CEFR
  const prelimCefrNum = 3; // B1 як default до AI відповіді

  const baseScore = computeBaseScore({
    word,
    cefrNum:          prelimCefrNum,
    frequencyBand,
    polysemyLevel:    polysemyEstimate,
    morphComplexityVal,
    phraseFlag,
  });

  // ── 2. AI Adjustment ───────────────────────────────────────────────────────
  if (!anthropic) {
    // No AI — повертаємо детерміністичний результат
    return {
      cefr_level:               scoreToCefr(baseScore),
      difficulty_score:         baseScore,
      base_score:               baseScore,
      ai_adjustment:            0,
      confidence_score:         40,
      frequency_band:           frequencyBand,
      polysemy_level:           polysemyEstimate,
      morph_complexity:         morphComplexityVal,
      phrase_flag:              phraseFlag,
      factors:                  { source: 'deterministic_only' },
      example_sentence:         null,
      example_sentence_target:  null,
      part_of_speech:           null,
      transcription:            null,
      definition:               null,
      definition_uk:            null,
    };
  }

  try {
    const ai = await getAiAdjustment({ word, translation, sourceLang, targetLang, baseScore });

    // Clamp adjustment
    const adjustment = Math.min(15, Math.max(-15, Math.round(ai.adjustment ?? 0)));

    // Перерахуємо BaseScore з AI CEFR
    const aiCefrNum = cefrToNum(ai.cefr_level || 'B1');
    const refinedBase = computeBaseScore({
      word,
      cefrNum:          aiCefrNum,
      frequencyBand,
      polysemyLevel:    Math.min(5, Math.max(1, ai.polysemy_level ?? polysemyEstimate)),
      morphComplexityVal,
      phraseFlag,
    });

    const finalScore      = Math.min(100, Math.max(0, refinedBase + adjustment));
    const polysemyFinal   = Math.min(5, Math.max(1, Math.round(ai.polysemy_level ?? polysemyEstimate)));
    const confidenceScore = computeConfidence({
      aiConfidence: ai.confidence ?? 60,
      aiCefr:       ai.cefr_level || 'B1',
      baseScore:    refinedBase,
    });

    return {
      cefr_level:               ai.cefr_level || scoreToCefr(finalScore),
      difficulty_score:         finalScore,
      base_score:               refinedBase,
      ai_adjustment:            adjustment,
      confidence_score:         confidenceScore,
      frequency_band:           frequencyBand,
      polysemy_level:           polysemyFinal,
      morph_complexity:         morphComplexityVal,
      phrase_flag:              phraseFlag,
      factors: {
        polysemy:               polysemyFinal,
        false_friends:          ai.false_friends ?? false,
        phonetic_difficulty:    ai.phonetic_difficulty ?? null,
        cultural_context:       ai.cultural_context ?? null,
        morphological_complexity: morphComplexityVal,
        source: 'v2_ai+deterministic',
        ai_reason: ai.reason || null,
      },
      example_sentence:         ai.example_sentence         || null,
      example_sentence_target:  ai.example_sentence_target  || null,
      part_of_speech:           ai.part_of_speech            || null,
      transcription:            ai.transcription             || null,
      definition:               ai.definition                || null,
      definition_uk:            ai.definition_uk             || null,
    };
  } catch (error) {
    console.error('🤖 AI adjustment failed, using deterministic result:', error.message);
    return {
      cefr_level:               scoreToCefr(baseScore),
      difficulty_score:         baseScore,
      base_score:               baseScore,
      ai_adjustment:            0,
      confidence_score:         35,
      frequency_band:           frequencyBand,
      polysemy_level:           polysemyEstimate,
      morph_complexity:         morphComplexityVal,
      phrase_flag:              phraseFlag,
      factors:                  { source: 'deterministic_fallback', error: error.message },
      example_sentence:         null,
      example_sentence_target:  null,
      part_of_speech:           null,
      transcription:            null,
      definition:               null,
      definition_uk:            null,
    };
  }
}

// Залишаємо для зворотної сумісності з backfill скриптом
function getBaseScore(word, cefrNum = 3, polysemy = 2) {
  return computeBaseScore({
    word,
    cefrNum,
    frequencyBand:     estimateFrequencyBand(word),
    polysemyLevel:     polysemy,
    morphComplexityVal: morphComplexity(word),
    phraseFlag:        detectPhrase(word),
  });
}

module.exports = {
  assessDifficulty,
  // Утиліти (для backfill та тестів)
  getBaseScore,
  scoreToCefr,
  cefrToNum,
  computeBaseScore,
  estimateFrequencyBand,
  estimatePolysemyLevel,
  morphComplexity,
  detectPhrase,
};
