/**
 * server/routes/words.js — Word-level stats endpoint
 *
 * GET /api/words/:wordId/stats — per-word accuracy, streak, recent history
 *
 * Data sources (no new tables needed):
 *  - practice_events: full answer history per word
 *  - user_word_progress: current SRS state, correct/wrong counts, personal_score
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const { getEntitlements } = require("../config/entitlements");

// GET /api/words/:wordId/stats
router.get("/words/:wordId/stats", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;
    const { wordId } = req.params;

    // Check plan — word stats are available to all but limited for free
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("subscription_plan")
      .eq("id", userId)
      .single();

    const plan = profileRow?.subscription_plan || "free";
    const ent = getEntitlements(plan);

    // Free users get last 10 events; Pro get full history (last 100)
    const eventLimit = ent.wordStats ? 100 : 10;

    // 1. Fetch user_word_progress
    const { data: progress, error: progErr } = await supabase
      .from("user_word_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("word_id", wordId)
      .single();

    if (progErr && progErr.code !== "PGRST116") throw progErr;

    // 2. Fetch recent practice events
    const { data: events, error: evErr } = await supabase
      .from("practice_events")
      .select("id, result, answer_time_ms, created_at, list_id")
      .eq("user_id", userId)
      .eq("word_id", wordId)
      .order("created_at", { ascending: false })
      .limit(eventLimit);

    if (evErr) throw evErr;

    const eventsArr = events || [];

    // 3. Compute derived stats
    const totalAttempts = eventsArr.length;
    const correctCount  = eventsArr.filter((e) => e.result === true).length;
    const wrongCount    = totalAttempts - correctCount;
    const accuracy      = totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : null;

    // Average answer time (excluding nulls)
    const timedEvents = eventsArr.filter((e) => e.answer_time_ms != null);
    const avgAnswerMs = timedEvents.length > 0
      ? Math.round(timedEvents.reduce((sum, e) => sum + e.answer_time_ms, 0) / timedEvents.length)
      : null;

    // Current answer streak (count consecutive correct from most recent)
    let currentStreak = 0;
    for (const e of eventsArr) {
      if (e.result === true) currentStreak++;
      else break;
    }

    // 4. Compose response
    return res.json({
      word_id:         wordId,
      plan,
      // SRS state
      progress:        progress || null,
      // Aggregated
      total_attempts:  totalAttempts,
      correct_count:   correctCount,
      wrong_count:     wrongCount,
      accuracy_pct:    accuracy,
      avg_answer_ms:   avgAnswerMs,
      current_streak:  currentStreak,
      // Recent history (newest first), limited by plan
      recent_events:   eventsArr.map((e) => ({
        result:         e.result,
        answer_time_ms: e.answer_time_ms,
        created_at:     e.created_at,
      })),
      history_limited: !ent.wordStats, // tells client that history is capped at 10
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
