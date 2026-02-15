/**
 * server/routes/practice.js — Маршрути для повторення слів
 *
 * Працює через Supabase Auth JWT (Bearer token) + RLS.
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");

// GET /api/practice/:listId — слова для повторення зі списку
router.get("/practice/:listId", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { listId } = req.params;

    // Отримуємо слова зі списку разом з даними слова
    // RLS на list_words гарантує, що користувач бачить тільки свої списки
    const { data, error } = await supabase
      .from("list_words")
      .select("word_id, words(*)")
      .eq("list_id", listId);

    if (error) throw error;

    const wordIds = (data || []).map((d) => d.word_id);
    if (wordIds.length === 0) {
      return res.json({ total: 0, due: 0, words: [] });
    }

    // Отримуємо прогрес для кожного слова (RLS на user_word_progress)
    const { data: progress, error: progressError } = await supabase
      .from("user_word_progress")
      .select("*")
      .in("word_id", wordIds);

    if (progressError) throw progressError;

    const now = new Date();

    const words = (data || []).map((d) => {
      const p = (progress || []).find((pr) => pr.word_id === d.word_id) || null;
      return {
        ...d.words,
        progress: p,
        is_due: !p || new Date(p.next_review) <= now,
      };
    });

    const dueWords = words.filter((w) => w.is_due);

    return res.json({
      total: words.length,
      due: dueWords.length,
      words: dueWords,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/practice/result — зберегти результат повторення
router.post("/practice/result", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { wordId, quality, newProgress } = req.body;

    if (!wordId || !quality || !newProgress) {
      return res.status(400).json({ error: "wordId, quality та newProgress обов'язкові" });
    }

    const payload = {
      user_id: req.user.id,
      word_id: wordId,
      ease_factor: newProgress.ease_factor,
      interval_days: newProgress.interval_days,
      repetitions: newProgress.repetitions,
      next_review: newProgress.next_review,
      last_result: quality,
    };

    const { data, error } = await supabase
      .from("user_word_progress")
      .upsert(payload, { onConflict: "user_id,word_id" })
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
