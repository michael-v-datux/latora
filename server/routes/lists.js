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
    const { wordId, forceMix = false, rememberChoice = false } = req.body;

    if (!wordId) {
      return res.status(400).json({ error: "wordId обов'язковий" });
    }

    // 1) Fetch list settings
    const { data: list, error: listError } = await supabase
      .from('lists')
      .select('id, language_mix_policy')
      .eq('id', req.params.id)
      .single();
    if (listError) throw listError;

    // 2) Fetch the word being added (language pair)
    const { data: word, error: wordError } = await supabase
      .from('words')
      .select('id, source_lang, target_lang')
      .eq('id', wordId)
      .single();
    if (wordError) throw wordError;

    const listPolicy = (list?.language_mix_policy || 'ASK').toUpperCase();

    // 3) If policy is ASK and not forcing, check if list already has a single language pair and it mismatches
    if (listPolicy === 'ASK' && !forceMix) {
      const { data: existingPairs, error: pairsError } = await supabase
        .from('list_words')
        .select('words(source_lang, target_lang)')
        .eq('list_id', req.params.id)
        .limit(30); // we only need a sample to detect pair; lists typically consistent
      if (pairsError) throw pairsError;

      const pairs = (existingPairs || [])
        .map((x) => x.words)
        .filter(Boolean)
        .map((w) => `${String(w.source_lang || '').toUpperCase()}→${String(w.target_lang || '').toUpperCase()}`);

      const unique = Array.from(new Set(pairs));

      // If list has exactly one pair and it differs from the incoming word pair, block with a 409 and details
      const incomingPair = `${String(word.source_lang || '').toUpperCase()}→${String(word.target_lang || '').toUpperCase()}`;
      if (unique.length === 1 && unique[0] && unique[0] !== incomingPair) {
        return res.status(409).json({
          code: 'LANG_MIX_CONFIRM',
          message: 'List already contains words translated with a different language pair',
          list_pair: unique[0],
          new_pair: incomingPair,
        });
      }
    }

    // 4) If user decided to remember, set policy to ALLOW (only for this list)
    if (forceMix && rememberChoice) {
      const { error: updateError } = await supabase
        .from('lists')
        .update({ language_mix_policy: 'ALLOW' })
        .eq('id', req.params.id);
      if (updateError) throw updateError;
    }

    // 5) Insert word to list
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


// GET /api/lists/:id — отримати один список + слова (join до words)
router.get("/lists/:id", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;

    const { data: list, error: listError } = await supabase
      .from("lists")
      .select("id, name, emoji, created_at")
      .eq("id", req.params.id)
      .single();

    if (listError) throw listError;

    const { data: items, error: itemsError } = await supabase
      .from("list_words")
      .select("added_at, words(*)")
      .eq("list_id", req.params.id)
      .order("added_at", { ascending: false });

    if (itemsError) throw itemsError;

    const words = (items || [])
      .map((lw) => lw.words)
      .filter(Boolean);

    return res.json({
      ...list,
      word_count: words.length,
      words,
    });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/lists/:id/words/:wordId — видалити слово зі списку
router.delete("/lists/:id/words/:wordId", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { id, wordId } = req.params;

    const { error } = await supabase
      .from("list_words")
      .delete()
      .eq("list_id", id)
      .eq("word_id", wordId);

    if (error) throw error;

    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

// POST /api/lists/:id/words/bulk-delete — видалити кілька слів зі списку
// body: { wordIds: [uuid, ...] }
router.post("/lists/:id/words/bulk-delete", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { id } = req.params;
    const { wordIds } = req.body;

    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: "wordIds обов'язковий" });
    }

    const { error } = await supabase
      .from("list_words")
      .delete()
      .eq("list_id", id)
      .in("word_id", wordIds);

    if (error) throw error;
    return res.json({ success: true, deleted: wordIds.length });
  } catch (error) {
    return next(error);
  }
});

// POST /api/lists/move-words — перенести слова між списками
// body: { fromListId, toListId, wordIds }
router.post("/lists/move-words", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { fromListId, toListId, wordIds } = req.body;

    if (!fromListId || !toListId) {
      return res.status(400).json({ error: "fromListId і toListId обов'язкові" });
    }
    if (fromListId === toListId) {
      return res.status(400).json({ error: "Списки мають бути різні" });
    }
    if (!Array.isArray(wordIds) || wordIds.length === 0) {
      return res.status(400).json({ error: "wordIds обов'язковий" });
    }

    // 1) Додаємо в новий список (upsert щоб не падати на дублі)
    const rows = wordIds.map((wordId) => ({ list_id: toListId, word_id: wordId }));
    const { error: insertError } = await supabase
      .from("list_words")
      .upsert(rows, { onConflict: "list_id,word_id" });
    if (insertError) throw insertError;

    // 2) Видаляємо зі старого
    const { error: deleteError } = await supabase
      .from("list_words")
      .delete()
      .eq("list_id", fromListId)
      .in("word_id", wordIds);
    if (deleteError) throw deleteError;

    return res.json({ success: true, moved: wordIds.length });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
