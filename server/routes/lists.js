/**
 * server/routes/lists.js — Маршрути управління списками
 *
 * ВАЖЛИВО:
 * - Використовує Supabase Auth JWT (Bearer token) + RLS політики.
 * - user_id береться з токена (req.user.id), не з x-user-id / query param.
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");

// GET /api/lists — отримати списки поточного користувача
router.get("/lists", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;

    const { data, error } = await supabase
      .from("lists")
      .select("*, list_words(count)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json(
      (data || []).map((l) => ({
        ...l,
        word_count: l.list_words?.[0]?.count || 0,
      }))
    );
  } catch (error) {
    return next(error);
  }
});

// POST /api/lists — створити список
router.post("/lists", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;

    const { name, emoji = "📚", description = "" } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Назва обов'язкова" });
    }

    const { data, error } = await supabase
      .from("lists")
      .insert({
        user_id: req.user.id,
        name: name.trim(),
        emoji,
        description,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
});

// POST /api/lists/:id/words — додати слово до списку
router.post("/lists/:id/words", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { wordId } = req.body;

    if (!wordId) {
      return res.status(400).json({ error: "wordId обов'язковий" });
    }

    const { data, error } = await supabase
      .from("list_words")
      .insert({ list_id: req.params.id, word_id: wordId })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/lists/:id — видалити список
router.delete("/lists/:id", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;

    const { error } = await supabase.from("lists").delete().eq("id", req.params.id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

// GET /api/suggest-list?wordId=... — рекомендація списку (без userId у query)
router.get("/suggest-list", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { wordId } = req.query;

    if (!wordId) {
      return res.status(400).json({ error: "wordId обов'язковий" });
    }

    // Отримуємо слово та списки користувача зі словами
    const [wordRes, listsRes] = await Promise.all([
      supabase.from("words").select("*").eq("id", wordId).single(),
      supabase.from("lists").select("*, list_words(word_id, words(*))"),
    ]);

    if (wordRes.error || listsRes.error) throw wordRes.error || listsRes.error;

    const word = wordRes.data;
    const lists = listsRes.data || [];

    // Евристика: рекомендуємо список з найбільш схожими словами за CEFR/частиною мови
    let bestList = null;
    let bestScore = -1;

    for (const list of lists) {
      const listWords = list.list_words?.map((lw) => lw.words) || [];
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

    return res.json({
      suggested_list_id: bestList?.id || null,
      suggested_list_name: bestList?.name || null,
      reason: bestScore > 0 ? "Similar words by level and type" : "Most recent list",
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
