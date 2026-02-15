/**
 * server/routes/lists.js — Маршрути управління списками
 */

const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');

// GET /api/lists
router.get('/lists', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'Не авторизовано' });

    const { data, error } = await supabase
      .from('lists')
      .select('*, list_words(count)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data.map(l => ({ ...l, word_count: l.list_words?.[0]?.count || 0 })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/lists
router.post('/lists', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { name, emoji = '📚', description = '' } = req.body;
    if (!userId) return res.status(401).json({ error: 'Не авторизовано' });
    if (!name) return res.status(400).json({ error: 'Назва обов\'язкова' });

    const { data, error } = await supabase
      .from('lists')
      .insert({ user_id: userId, name, emoji, description })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/lists/:id/words
router.post('/lists/:id/words', async (req, res) => {
  try {
    const { wordId } = req.body;
    if (!wordId) return res.status(400).json({ error: 'wordId обов\'язковий' });

    const { data, error } = await supabase
      .from('list_words')
      .insert({ list_id: req.params.id, word_id: wordId })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/lists/:id
router.delete('/lists/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('lists').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/suggest-list — AI-рекомендація списку
router.get('/suggest-list', async (req, res) => {
  try {
    const { wordId, userId } = req.query;
    if (!wordId || !userId) return res.status(400).json({ error: 'wordId та userId обов\'язкові' });

    // Отримуємо слово та списки користувача зі словами
    const [wordRes, listsRes] = await Promise.all([
      supabase.from('words').select('*').eq('id', wordId).single(),
      supabase.from('lists').select('*, list_words(word_id, words(*))').eq('user_id', userId),
    ]);

    if (wordRes.error || listsRes.error) throw wordRes.error || listsRes.error;

    const word = wordRes.data;
    const lists = listsRes.data;

    // Проста евристика: рекомендуємо список з найбільш схожими словами за CEFR-рівнем
    let bestList = null;
    let bestScore = -1;

    for (const list of lists) {
      const listWords = list.list_words?.map(lw => lw.words) || [];
      let score = 0;

      for (const lw of listWords) {
        if (lw && lw.cefr_level === word.cefr_level) score += 2;
        if (lw && lw.part_of_speech === word.part_of_speech) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestList = list;
      }
    }

    res.json({
      suggested_list_id: bestList?.id || null,
      suggested_list_name: bestList?.name || null,
      reason: bestScore > 0 ? 'Similar words by level and type' : 'Most recent list',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
