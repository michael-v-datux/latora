/**
 * server/services/difficulty.js — AI-оцінка складності через Claude
 * 
 * Це "серце" LexiLevel — сервіс, який оцінює наскільки складне слово
 * для українськомовного студента. Використовує Claude Haiku (швидко і дешево).
 * 
 * Комбінує два підходи:
 * 1. Базовий алгоритмічний (довжина, складність написання)
 * 2. AI-аналіз (контекст, багатозначність, культурні нюанси)
 */

const Anthropic = require('@anthropic-ai/sdk');

// Ініціалізація клієнта Claude
let anthropic;
try {
  anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
} catch (e) {
  console.warn('⚠️ Anthropic API не налаштовано. AI-оцінка буде недоступна.');
}


/**
 * Claude інколи обгортає JSON у markdown-блоки ```json ... ```
 * або додає зайвий текст. Ця функція робить парсинг "production-safe".
 */
function parseClaudeJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Claude returned empty response');
  }

  let text = rawText.trim();

  // 1) Знімаємо markdown code fences, якщо вони є
  //    ```json\n{...}\n``` або ```\n{...}\n```
  // Claude іноді додає текст ДО fence — тоді витягуємо перший fenced-блок.
  if (text.includes('```')) {
    const fenceStart = text.indexOf('```');
    const fenceEnd = text.indexOf('```', fenceStart + 3);
    if (fenceStart !== -1 && fenceEnd !== -1 && fenceEnd > fenceStart) {
      let inner = text.slice(fenceStart + 3, fenceEnd).trim();
      inner = inner.replace(/^json\s*/i, '').trim();
      text = inner;
    } else if (text.startsWith('```')) {
      text = text.replace(/^```(?:json)?\s*/i, '');   // прибираємо відкриваючий fence
      text = text.replace(/\s*```\s*$/i, '');        // прибираємо закриваючий fence
      text = text.trim();
    }
  }

  // 2) Перша спроба — чистий JSON
  try {
    return JSON.parse(text);
  } catch (e1) {
    // 3) Друга спроба — витягуємо перший JSON-обʼєкт з тексту
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const candidate = text.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch (e2) {
        // fallthrough
      }
    }
    // 4) Повертаємо оригінальну помилку, але з коротким превʼю відповіді для дебагу
    const preview = text.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`Claude response is not valid JSON: ${e1.message}. Preview: "${preview}"`);
  }
}

/**
 * Оцінити складність англійського слова для українськомовного студента
 * 
 * @param {string} word — англійське слово
 * @param {string} translation — український переклад
 * @returns {Object} — { cefr_level, difficulty_score, factors, example_sentence, part_of_speech, transcription }
 */
async function assessDifficulty(word, translation) {
  // Базова оцінка (без AI, працює завжди)
  const baseScore = getBaseScore(word);

  // Якщо Claude API недоступний — повертаємо базову оцінку
  if (!anthropic) {
    return {
      cefr_level: scoreToCefr(baseScore),
      difficulty_score: baseScore,
      factors: { source: 'algorithmic' },
      example_sentence: null,
      part_of_speech: null,
      transcription: null,
    };
  }

  try {
    // Запит до Claude Haiku
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',  // найшвидша та найдешевша модель
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `You are an expert in English language teaching for Ukrainian speakers.
        
Assess the difficulty of the English word "${word}" (translated as "${translation}" in Ukrainian) for a Ukrainian-speaking student.

Respond ONLY with a valid JSON object (no markdown, no backticks):
{
  "cefr_level": "B2",
  "difficulty_score": 65,
  "part_of_speech": "noun",
  "transcription": "/ˈwɜːrd/",
  "example_sentence": "A natural sentence using the word.",
  "factors": {
    "polysemy": 2,
    "false_friends": false,
    "phonetic_difficulty": 5,
    "cultural_context": 3,
    "morphological_complexity": 4
  }
}

Rules:
- cefr_level: A1, A2, B1, B2, C1, or C2
- difficulty_score: 1-100 (1=easiest, 100=hardest)
- All factor values: 1-10
- polysemy: number of common meanings
- false_friends: true if similar Ukrainian word exists with different meaning
- transcription: IPA format`
      }],
    });

    // Парсимо JSON-відповідь від Claude
    const responseText = message.content[0].text.trim();
    const aiResult = parseClaudeJson(responseText);

    // Комбінуємо базову та AI оцінку (70% AI, 30% базова)
    const combinedScore = Math.round(aiResult.difficulty_score * 0.7 + baseScore * 0.3);

    return {
      cefr_level: aiResult.cefr_level,
      difficulty_score: Math.min(100, Math.max(1, combinedScore)),
      factors: { ...aiResult.factors, source: 'ai+algorithmic' },
      example_sentence: aiResult.example_sentence,
      part_of_speech: aiResult.part_of_speech,
      transcription: aiResult.transcription,
    };
  } catch (error) {
    console.error('Claude API error:', error.message);
    // Якщо AI не спрацював — повертаємо базову оцінку
    return {
      cefr_level: scoreToCefr(baseScore),
      difficulty_score: baseScore,
      factors: { source: 'algorithmic_fallback', error: error.message },
      example_sentence: null,
      part_of_speech: null,
      transcription: null,
    };
  }
}

/**
 * Базова алгоритмічна оцінка (без AI)
 * Враховує: довжину слова, кількість складів, наявність складних буквосполучень
 */
function getBaseScore(word) {
  let score = 30; // базовий бал

  // Довжина слова
  if (word.length <= 4) score -= 10;
  else if (word.length <= 7) score += 0;
  else if (word.length <= 10) score += 15;
  else score += 25;

  // Кількість складів (приблизна оцінка)
  const syllables = countSyllables(word);
  if (syllables <= 1) score -= 5;
  else if (syllables <= 2) score += 0;
  else if (syllables <= 3) score += 10;
  else score += 20;

  // Складні буквосполучення для українців
  const hardPatterns = ['th', 'wh', 'ough', 'tion', 'sion', 'ious', 'eous'];
  for (const pattern of hardPatterns) {
    if (word.toLowerCase().includes(pattern)) {
      score += 5;
    }
  }

  // Обмежуємо діапазон 1-100
  return Math.min(100, Math.max(1, score));
}

/**
 * Підрахунок складів (спрощений алгоритм)
 */
function countSyllables(word) {
  word = word.toLowerCase();
  if (word.length <= 3) return 1;
  
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

/**
 * Конвертувати числовий бал в CEFR рівень
 */
function scoreToCefr(score) {
  if (score <= 20) return 'A1';
  if (score <= 35) return 'A2';
  if (score <= 50) return 'B1';
  if (score <= 65) return 'B2';
  if (score <= 80) return 'C1';
  return 'C2';
}

module.exports = { assessDifficulty };
