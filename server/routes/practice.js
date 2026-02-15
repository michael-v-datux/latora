/**
 * server/routes/practice.js — Маршрути для повторення слів
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET /api/practice/:listId — слова для повторення зі списку
router.get('/practice/:listId', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизовано' });

    const { listId } = req.params;

    // Отримуємо слова зі списку разом з прогресом користувача
    const { data, error } = await supabase
      .from('list_words')
      .select('word_id, words(*)')
      .eq('list_id', listId);

    if (error) throw error;

    // Отримуємо прогрес для кожного слова
    const wordIds = data.map(d => d.word_id);
    const { data: progress } = await supabase
      .from('user_word_progress')
      .select('*')
      .eq('user_id', userId)
      .in('word_id', wordIds);

    // Об'єднуємо слова з прогресом
    const now = new Date();
    const words = data.map(d => {
      const p = progress?.find(pr => pr.word_id === d.word_id);
      return {
        ...d.words,
        progress: p || null,
        is_due: !p || new Date(p.next_review) <= now,
      };
    });

    // Фільтруємо: спочатку ті, що потребують повторення
    const dueWords = words.filter(w => w.is_due);
    
    res.json({
      total: words.length,
      due: dueWords.length,
      words: dueWords,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/practice/result — зберегти результат повторення
router.post('/practice/result', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизовано' });

    const { wordId, quality, newProgress } = req.body;
    if (!wordId || !quality || !newProgress) {
      return res.status(400).json({ error: 'wordId, quality та newProgress обов\'язкові' });
    }

    // Upsert (вставити або оновити) прогрес
    const { data, error } = await supabase
      .from('user_word_progress')
      .upsert({
        user_id: userId,
        word_id: wordId,
        ease_factor: newProgress.ease_factor,
        interval_days: newProgress.interval_days,
        repetitions: newProgress.repetitions,
        next_review: newProgress.next_review,
        last_result: quality,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
