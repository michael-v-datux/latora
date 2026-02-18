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

// GET /api/practice/list-statuses — стан повторення для кожного списку (одним запитом)
// ВАЖЛИВО: цей маршрут ПЕРЕД /:listId
router.get("/practice/list-statuses", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;

    // 1. Всі списки
    const { data: lists, error: listsErr } = await supabase
      .from("lists")
      .select("id")
      .eq("user_id", userId);

    if (listsErr) throw listsErr;

    const listIds = (lists || []).map((l) => l.id);
    if (listIds.length === 0) {
      return res.json({ statuses: {} });
    }

    // 2. Всі list_words (щоб знати які слова в яких списках)
    const { data: listWords, error: lwErr } = await supabase
      .from("list_words")
      .select("list_id, word_id")
      .in("list_id", listIds);

    if (lwErr) throw lwErr;

    // Групуємо word_ids по list_id
    const listWordMap = {};
    for (const lw of listWords || []) {
      if (!listWordMap[lw.list_id]) listWordMap[lw.list_id] = [];
      listWordMap[lw.list_id].push(lw.word_id);
    }

    // 3. Всі унікальні word_ids
    const allWordIds = [...new Set((listWords || []).map((lw) => lw.word_id))];
    if (allWordIds.length === 0) {
      const statuses = {};
      listIds.forEach((id) => {
        statuses[id] = { total: 0, due: 0, reviewed_today: 0 };
      });
      return res.json({ statuses });
    }

    // 4. Прогрес для всіх слів
    const { data: progress, error: progErr } = await supabase
      .from("user_word_progress")
      .select("word_id, next_review, updated_at")
      .in("word_id", allWordIds);

    if (progErr) throw progErr;

    const progressMap = new Map((progress || []).map((p) => [p.word_id, p]));

    // Визначаємо початок сьогоднішнього дня в таймзоні клієнта
    const now = new Date();
    const clientTz = req.query.tz || "UTC";
    let todayStart;
    try {
      // Дістаємо локальну дату користувача (формат "2025-01-15")
      const localDateStr = now.toLocaleDateString("en-CA", { timeZone: clientTz });
      // Знаходимо UTC-еквівалент опівночі в таймзоні клієнта:
      // Створюємо дату "YYYY-MM-DDT00:00:00" і конвертуємо з клієнтської TZ в UTC
      const parts = localDateStr.split("-");
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      const day = parseInt(parts[2]);
      // Створюємо опівніч в UTC, потім корегуємо на offset таймзони
      const probe = new Date(Date.UTC(year, month, day, 12, 0, 0)); // полудень UTC для безпеки
      const utcStr = probe.toLocaleString("en-US", { timeZone: "UTC" });
      const tzStr = probe.toLocaleString("en-US", { timeZone: clientTz });
      const offsetMs = new Date(utcStr) - new Date(tzStr);
      todayStart = new Date(Date.UTC(year, month, day, 0, 0, 0) + offsetMs);
    } catch {
      // Fallback на UTC якщо таймзона некоректна
      todayStart = new Date(now);
      todayStart.setUTCHours(0, 0, 0, 0);
    }

    // 5. Рахуємо статуси для кожного списку
    const statuses = {};
    for (const listId of listIds) {
      const wids = listWordMap[listId] || [];
      let due = 0;
      let reviewedToday = 0;

      for (const wid of wids) {
        const p = progressMap.get(wid);
        if (!p || new Date(p.next_review) <= now) {
          due++;
        }
        if (p && new Date(p.updated_at) >= todayStart) {
          reviewedToday++;
        }
      }

      statuses[listId] = { total: wids.length, due, reviewed_today: reviewedToday, sessions_today: 0 };
    }

    // 6. Рахуємо завершені сесії за сьогодні
    const { data: sessions, error: sessErr } = await supabase
      .from("practice_sessions")
      .select("list_id, completed_at")
      .in("list_id", listIds);

    if (!sessErr && sessions) {
      for (const s of sessions) {
        if (new Date(s.completed_at) >= todayStart && statuses[s.list_id]) {
          statuses[s.list_id].sessions_today++;
        }
      }
    }

    // partial_today не обчислюється на сервері — трекується локально на клієнті (AsyncStorage).
    // Підхід через лічення practice_events виявився ненадійним через накопичення
    // "зайвих" подій після багатьох сесій. Клієнт сам знає чи є незавершена сесія.

    return res.json({ statuses });
  } catch (error) {
    return next(error);
  }
});

// GET /api/practice/session-counts — кількість завершених сесій за весь час (по списках)
// ВАЖЛИВО: цей маршрут ПЕРЕД /:listId
router.get("/practice/session-counts", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const listIds = req.query.listIds ? req.query.listIds.split(",") : null;

    let query = supabase.from("practice_sessions").select("list_id");
    if (listIds) {
      query = query.in("list_id", listIds);
    }

    const { data, error } = await query;
    if (error) throw error;

    const counts = {};
    for (const row of data || []) {
      counts[row.list_id] = (counts[row.list_id] || 0) + 1;
    }

    return res.json({ counts });
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

    const words = (data || []).map((d) => d.words).filter(Boolean);
    const wordIds = words.map((w) => w.id);

    // Баг 1 (Practice): у змішаному списку можуть бути різні мовні пари.
    // Знаходимо унікальні пари target_lang і для кожної підтягуємо дистрактори окремо.
    let distractors = [];
    if (words.length < 6) {
      const admin = require("../lib/supabase.admin.cjs");

      // Збираємо унікальні (source_lang, target_lang) пари серед слів у списку
      const pairsMap = new Map();
      for (const w of words) {
        const key = `${(w.source_lang || '').toUpperCase()}|${(w.target_lang || '').toUpperCase()}`;
        if (!pairsMap.has(key)) pairsMap.set(key, { source_lang: w.source_lang, target_lang: w.target_lang });
      }

      // Для кожної пари підтягуємо дистрактори (щоб фейки були відповідної мови)
      const excludeIds = wordIds.length > 0 ? `(${wordIds.join(",")})` : '(null)';
      for (const pair of pairsMap.values()) {
        // Скільки слів потрібно для цієї пари (мінімум 2 фейки)
        const neededForPair = Math.max(0, 6 - words.filter(
          w => (w.target_lang || '').toUpperCase() === (pair.target_lang || '').toUpperCase()
        ).length);
        if (neededForPair <= 0) continue;

        const { data: extra, error: extraErr } = await admin
          .from("words")
          .select("id, translation, source_lang, target_lang")
          .eq("source_lang", pair.source_lang)
          .eq("target_lang", pair.target_lang)
          .not("id", "in", excludeIds)
          .limit(Math.max(neededForPair + 2, 5));

        if (!extraErr && extra) {
          distractors.push(...extra);
        }
      }
    }

    return res.json({ words, distractors });
  } catch (error) {
    return next(error);
  }
});

// GET /api/practice/:listId — слова для повторення зі списку
// ?force=true — повернути ВСІ слова (для перезапуску сесії)
router.get("/practice/:listId", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { listId } = req.params;
    const force = req.query.force === "true";

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

    // Підтягуємо останні 6 practice_events для кожного слова (для Trend Engine)
    const { data: events } = await supabase
      .from("practice_events")
      .select("word_id, result, created_at")
      .eq("user_id", req.user.id)
      .in("word_id", wordIds)
      .order("created_at", { ascending: false })
      .limit(wordIds.length * 6);  // до 6 подій на слово

    // Групуємо events по word_id
    const eventsMap = {};
    for (const ev of events || []) {
      if (!eventsMap[ev.word_id]) eventsMap[ev.word_id] = [];
      if (eventsMap[ev.word_id].length < 6) eventsMap[ev.word_id].push(ev);
    }

    const now = new Date();

    const words = (data || []).map((d) => {
      const p = (progress || []).find((pr) => pr.word_id === d.word_id) || null;
      const wordEvents = eventsMap[d.word_id] || [];
      return {
        ...d.words,
        progress: p,
        recent_events: wordEvents,   // передаємо фронту для Trend Engine
        is_due: !p || new Date(p.next_review) <= now,
      };
    });

    // force=true — повернути всі слова, інакше тільки due
    const resultWords = force ? words : words.filter((w) => w.is_due);

    return res.json({
      total: words.length,
      due: words.filter((w) => w.is_due).length,
      words: resultWords,
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/practice/result — зберегти результат повторення + practice_event
router.post("/practice/result", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const {
      wordId,
      quality,
      newProgress,
      sessionId   = null,   // опційний FK на practice_sessions
      listId      = null,   // опційний FK на lists
      answerTimeMs = null,  // час відповіді (мс)
    } = req.body;

    if (!wordId || !quality || !newProgress) {
      return res.status(400).json({ error: "wordId, quality та newProgress обов'язкові" });
    }

    const userId = req.user.id;

    // ── 1. Upsert user_word_progress (v2: + Personal Layer поля) ───────────
    const payload = {
      user_id:       userId,
      word_id:       wordId,
      ease_factor:   newProgress.ease_factor,
      interval_days: newProgress.interval_days,
      repetitions:   newProgress.repetitions,
      next_review:   newProgress.next_review,
      last_result:   quality,
      updated_at:    new Date().toISOString(),
      // Personal Layer (розраховані на фронті через calculateFullProgress)
      wrong_count:      newProgress.wrong_count      ?? null,
      correct_count:    newProgress.correct_count    ?? null,
      personal_score:   newProgress.personal_score   ?? null,
      word_state:       newProgress.word_state        ?? null,
      trend_direction:  newProgress.trend_direction   ?? null,
    };

    const { data, error } = await supabase
      .from("user_word_progress")
      .upsert(payload, { onConflict: "user_id,word_id" })
      .select()
      .single();

    if (error) throw error;

    // ── 2. Логуємо practice_event (fire-and-forget, не блокуємо відповідь) ─
    const isCorrect = quality !== "forgot";
    supabase
      .from("practice_events")
      .insert({
        user_id:       userId,
        session_id:    sessionId,
        word_id:       wordId,
        list_id:       listId,
        result:        isCorrect,
        answer_time_ms: answerTimeMs,
      })
      .then(({ error: evErr }) => {
        if (evErr) console.warn("⚠️ practice_events insert failed:", evErr.message);
      });

    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

// POST /api/practice/session — зберегти завершену сесію повторення
router.post("/practice/session", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const { listId, wordCount, correctCount } = req.body;

    if (!listId) {
      return res.status(400).json({ error: "listId обов'язковий" });
    }

    const { data, error } = await supabase
      .from("practice_sessions")
      .insert({
        user_id: req.user.id,
        list_id: listId,
        word_count: wordCount || 0,
        correct_count: correctCount || 0,
      })
      .select()
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
