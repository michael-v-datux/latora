/**
 * server/routes/practice.js — Маршрути для повторення слів
 *
 * Працює через Supabase Auth JWT (Bearer token) + RLS.
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");

// GET /api/practice/stats — загальна статистика для головного екрану
// ВАЖЛИВО: цей маршрут ПЕРЕД /:listId, щоб "stats" не матчився як listId
router.get("/practice/stats", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;

    // Отримуємо всі списки користувача
    const { data: lists, error: listsErr } = await supabase
      .from("lists")
      .select("id")
      .eq("user_id", userId);

    if (listsErr) throw listsErr;

    const listIds = (lists || []).map((l) => l.id);
    if (listIds.length === 0) {
      return res.json({ due: 0, mastered: 0, total: 0 });
    }

    // Отримуємо всі унікальні word_id з усіх списків
    const { data: listWords, error: lwErr } = await supabase
      .from("list_words")
      .select("word_id")
      .in("list_id", listIds);

    if (lwErr) throw lwErr;

    const wordIds = [...new Set((listWords || []).map((lw) => lw.word_id))];
    if (wordIds.length === 0) {
      return res.json({ due: 0, mastered: 0, total: 0 });
    }

    // Отримуємо прогрес для всіх слів
    const { data: progress, error: progErr } = await supabase
      .from("user_word_progress")
      .select("word_id, next_review, repetitions, ease_factor")
      .in("word_id", wordIds);

    if (progErr) throw progErr;

    const now = new Date();
    const progressMap = new Map((progress || []).map((p) => [p.word_id, p]));

    let due = 0;
    let mastered = 0;

    for (const wid of wordIds) {
      const p = progressMap.get(wid);
      if (!p || new Date(p.next_review) <= now) {
        due++;
      }
      if (p && p.repetitions >= 5 && p.ease_factor >= 2.3) {
        mastered++;
      }
    }

    return res.json({ due, mastered, total: wordIds.length });
  } catch (error) {
    return next(error);
  }
});

// GET /api/practice/:listId/all — усі слова зі списку + дистрактори для quiz
// ВАЖЛИВО: цей маршрут ПЕРЕД загальним /:listId
router.get("/practice/:listId/all", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { listId } = req.params;

    const { data, error } = await supabase
      .from("list_words")
      .select("word_id, words(*)")
      .eq("list_id", listId);

    if (error) throw error;

    const words = (data || []).map((d) => d.words);
    const wordIds = words.map((w) => w.id);

    // Якщо слів у списку мало (< 6) — підтягуємо додаткові з БД для quiz-дистракторів
    let distractors = [];
    if (words.length < 6) {
      const admin = require("../lib/supabase.admin.cjs");
      // Беремо випадкові слова тієї ж мовної пари, яких немає в списку
      const sampleLang = words[0];
      if (sampleLang) {
        const { data: extra, error: extraErr } = await admin
          .from("words")
          .select("id, translation")
          .eq("source_lang", sampleLang.source_lang)
          .eq("target_lang", sampleLang.target_lang)
          .not("id", "in", `(${wordIds.join(",")})`)
          .limit(10);

        if (!extraErr && extra) {
          distractors = extra;
        }
      }
    }

    return res.json({ words, distractors });
  } catch (error) {
    return next(error);
  }
});

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
