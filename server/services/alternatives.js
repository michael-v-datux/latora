/**
 * server/services/alternatives.js — Генерація альтернативних перекладів через Claude Haiku
 *
 * generateAlternatives(word, primaryTranslation, { sourceLang, targetLang, maxCount })
 *   → [{ translation, part_of_speech, example_sentence }, ...]
 *
 * Альтернативи = різні значення/відтінки слова (не парафрази!).
 * Наприклад "well" → ["криниця", "здоровий", "ну"] (окрім основного перекладу).
 *
 * Graceful fallback: при будь-якій помилці повертаємо [].
 */

const Anthropic = require('@anthropic-ai/sdk');

let anthropic;
try {
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
} catch (e) {
  console.warn('⚠️  Anthropic API не налаштовано. Alternatives недоступні.');
}

// Той самий parseClaudeJson що і в difficulty.js
function parseClaudeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') throw new Error('Empty response');
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

  // Спробуємо витягти масив [...] або об'єкт {...}
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(text.slice(arrStart, arrEnd + 1)); } catch (_) {}
  }

  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s !== -1 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }

  throw new Error(`Not valid JSON: "${text.slice(0, 200)}"`);
}

/**
 * Генерує альтернативні переклади слова через Claude Haiku.
 *
 * @param {string} word — оригінальне слово (вже lowercase)
 * @param {string} primaryTranslation — основний переклад (DeepL)
 * @param {{ sourceLang: string, targetLang: string, maxCount: number }} opts
 * @returns {Promise<Array<{ translation: string, part_of_speech: string, example_sentence: string }>>}
 */
async function generateAlternatives(word, primaryTranslation, opts = {}) {
  const { sourceLang = 'EN', targetLang = 'UK', maxCount = 3 } = opts;

  if (!anthropic) return [];

  try {
    const prompt = `You are a language expert helping learners of ${sourceLang}.

The word "${word}" (${sourceLang}) has this primary translation in ${targetLang}: "${primaryTranslation}".

List up to ${maxCount} ALTERNATIVE translations that represent different meanings or senses of the word "${word}".
- Each alternative must be a genuinely different meaning/sense, NOT a synonym of "${primaryTranslation}"
- Skip if the word has fewer distinct meanings
- Order from most common to least common sense
- Do NOT include "${primaryTranslation}" or very close synonyms of it

Respond ONLY with a valid JSON array:
[
  {
    "translation": "${targetLang} translation of this sense",
    "part_of_speech": "noun|verb|adjective|adverb|interjection|other",
    "example_sentence": "Short natural sentence in ${sourceLang} showing THIS specific meaning"
  }
]

If there are no meaningful alternatives, return an empty array: []`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0]?.text?.trim() || '[]';
    const parsed = parseClaudeJson(raw);

    // Валідуємо: має бути масив об'єктів з translation
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(item => item && typeof item.translation === 'string' && item.translation.trim())
      .slice(0, maxCount)
      .map(item => ({
        translation:      String(item.translation || '').trim(),
        part_of_speech:   String(item.part_of_speech || 'other').trim(),
        example_sentence: String(item.example_sentence || '').trim(),
      }));

  } catch (e) {
    console.warn('⚠️  generateAlternatives error:', e?.message || e);
    return [];
  }
}

module.exports = { generateAlternatives };
