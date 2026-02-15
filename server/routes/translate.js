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
const { translateText } = require('../services/deepl');
const { assessDifficulty } = require('../services/difficulty');
const { createClient } = require('@supabase/supabase-js');

// Supabase-клієнт для серверних операцій
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

router.post('/translate', async (req, res) => {
  try {
    const { word } = req.body;

    // Валідація
    if (!word || typeof word !== 'string' || word.trim().length === 0) {
      return res.status(400).json({ error: 'Слово не може бути порожнім' });
    }

    const cleanWord = word.trim().toLowerCase();

    // Крок 1: Перевіряємо кеш (чи вже перекладали це слово)
    const { data: cached } = await supabase
      .from('words')
      .select('*')
      .eq('original', cleanWord)
      .single();

    if (cached) {
      console.log(`📦 Кеш: "${cleanWord}" вже є в базі`);
      return res.json(cached);
    }

    // Крок 2: Переклад через DeepL
    console.log(`🔤 Перекладаємо: "${cleanWord}"`);
    const { translation } = await translateText(cleanWord);

    // Крок 3: AI-оцінка складності
    console.log(`🧠 Оцінюємо складність: "${cleanWord}"`);
    const difficulty = await assessDifficulty(cleanWord, translation);

    // Крок 4: Зберігаємо в базу
    const wordData = {
      original: cleanWord,
      translation,
      transcription: difficulty.transcription,
      difficulty_score: difficulty.difficulty_score,
      cefr_level: difficulty.cefr_level,
      difficulty_factors: difficulty.factors,
      example_sentence: difficulty.example_sentence,
      part_of_speech: difficulty.part_of_speech,
    };

    const { data: saved, error: saveError } = await supabase
      .from('words')
      .insert(wordData)
      .select()
      .single();

    if (saveError) {
      console.warn('⚠️ Не вдалось зберегти в базу:', saveError.message);
      // Все одно повертаємо результат (навіть якщо кеш не спрацював)
      return res.json(wordData);
    }

    console.log(`✅ Збережено: "${cleanWord}" (${difficulty.cefr_level}, ${difficulty.difficulty_score}/100)`);
    return res.json(saved);

  } catch (error) {
    console.error('❌ Помилка перекладу:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
