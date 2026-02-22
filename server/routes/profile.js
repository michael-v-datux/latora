/**
 * server/routes/profile.js — Маршрути профілю користувача
 *
 * GET /api/profile/me — профіль + subscription_plan + streak + cefr_distribution
 *                      + word_state_distribution + vocab_growth + vocab_velocity
 *                      + review_activity + difficulty_overview + weakness_map
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

// ─── Хелпер: обчислити стрік (consecutive practice days) ───────────────────
function computeStreak(sessions, clientTz) {
  if (!sessions || sessions.length === 0) return 0;

  const uniqueDays = new Set();
  for (const s of sessions) {
    try {
      const localDate = new Date(s.completed_at).toLocaleDateString("en-CA", {
        timeZone: clientTz || "UTC",
      });
      uniqueDays.add(localDate);
    } catch {
      // ігноруємо некоректні дати
    }
  }

  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });

  let startStr;
  if (uniqueDays.has(todayStr)) {
    startStr = todayStr;
  } else if (uniqueDays.has(yesterdayStr)) {
    startStr = yesterdayStr;
  } else {
    return 0;
  }

  let streak = 0;
  let cursor = new Date(startStr + "T12:00:00Z");
  while (true) {
    const dayStr = cursor.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });
    if (!uniqueDays.has(dayStr)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

// GET /api/profile/me
router.get("/profile/me", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;
    const clientTz = req.query.tz || "UTC";

    // ── 1. Профіль (план підписки + usage counters) ──────────────────────────
    const { data: profileData, error: profileErr } = await supabase
      .from("profiles")
      .select("id, subscription_plan, ai_requests_today, ai_reset_date, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (profileErr && profileErr.code !== "PGRST116") throw profileErr;
    const profile = profileData ?? { id: userId, subscription_plan: "free" };

    // ── 2. Стрік ─────────────────────────────────────────────────────────────
    const { data: sessions, error: sessErr } = await supabase
      .from("practice_sessions")
      .select("completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false });

    if (sessErr) throw sessErr;
    const streak = computeStreak(sessions || [], clientTz);

    // ── 3. Списки цього юзера ────────────────────────────────────────────────
    const { data: userLists, error: ulErr } = await supabase
      .from("lists")
      .select("id")
      .eq("user_id", userId);

    if (ulErr) throw ulErr;
    const listIds = (userLists || []).map((l) => l.id);

    // ── 4. Слова в списках: CEFR + word_id + added_at ────────────────────────
    const cefrDist = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
    const validLevels = new Set(Object.keys(cefrDist));
    let wordIds = [];
    let lwData = [];

    if (listIds.length > 0) {
      const { data: lwResult, error: lwErr } = await supabase
        .from("list_words")
        .select("word_id, added_at, words(cefr_level)")
        .in("list_id", listIds);

      if (lwErr) throw lwErr;
      lwData = lwResult || [];

      // CEFR розподіл
      for (const lw of lwData) {
        const level = lw.words?.cefr_level;
        if (level && validLevels.has(level)) {
          cefrDist[level]++;
        }
      }

      // Унікальні word_id
      wordIds = [...new Set(lwData.map((lw) => lw.word_id).filter(Boolean))];
    }

    // ── 5. Паралельні запити для аналітики ──────────────────────────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const [progressRes, growthRes, eventsRes, factorRes] = await Promise.all([
      // user_word_progress: стани + personal_score + trend
      wordIds.length > 0
        ? supabase
            .from("user_word_progress")
            .select("word_id, word_state, personal_score, trend_direction")
            .in("word_id", wordIds)
        : Promise.resolve({ data: [] }),

      // list_words: vocab growth за 30 днів
      listIds.length > 0
        ? supabase
            .from("list_words")
            .select("added_at")
            .in("list_id", listIds)
            .gte("added_at", thirtyDaysAgo.toISOString())
        : Promise.resolve({ data: [] }),

      // practice_events: результати для review activity + heatmap (30 днів)
      supabase
        .from("practice_events")
        .select("result, created_at")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo.toISOString()),

      // words: difficulty factors для weakness map
      wordIds.length > 0
        ? supabase
            .from("words")
            .select("id, base_score, frequency_band, polysemy_level, morph_complexity, phrase_flag")
            .in("id", wordIds)
        : Promise.resolve({ data: [] }),
    ]);

    // ── 6. Обчислення: word_state_distribution ──────────────────────────────
    const stateDist = { new: 0, learning: 0, stabilizing: 0, mastered: 0, decaying: 0, total: 0 };
    const progressMap = new Map();

    for (const p of progressRes.data || []) {
      const state = p.word_state || "new";
      if (stateDist[state] !== undefined) stateDist[state]++;
      progressMap.set(p.word_id, {
        personal_score: p.personal_score,
        trend_direction: p.trend_direction,
      });
    }
    // Слова без рядка progress вважаються "new"
    const wordsWithProgress = progressRes.data?.length ?? 0;
    stateDist.new += Math.max(0, wordIds.length - wordsWithProgress);
    stateDist.total = wordIds.length;

    // ── 7. Обчислення: vocab_growth + vocab_velocity ─────────────────────────
    const growthByDate = {};
    for (const row of growthRes.data || []) {
      try {
        const dayStr = new Date(row.added_at).toLocaleDateString("en-CA", {
          timeZone: clientTz || "UTC",
        });
        growthByDate[dayStr] = (growthByDate[dayStr] || 0) + 1;
      } catch { /* skip */ }
    }

    const vocabGrowth = [];
    let velocity7 = 0;
    let velocity30 = 0;
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });
      const count = growthByDate[dayStr] || 0;
      vocabGrowth.push({ date: dayStr, count });
      velocity30 += count;
      if (i < 7) velocity7 += count;
    }

    // ── 8. Обчислення: review_activity + mistake_heatmap ────────────────────
    let totalReviews = 0;
    let correctReviews = 0;

    // Heatmap: { date: { total, correct } } за 30 днів
    const heatmapByDate = {};
    for (const ev of eventsRes.data || []) {
      totalReviews++;
      if (ev.result === true) correctReviews++;
      // Heatmap bucket
      try {
        const dayStr = new Date(ev.created_at).toLocaleDateString("en-CA", {
          timeZone: clientTz || "UTC",
        });
        if (!heatmapByDate[dayStr]) heatmapByDate[dayStr] = { total: 0, correct: 0 };
        heatmapByDate[dayStr].total++;
        if (ev.result === true) heatmapByDate[dayStr].correct++;
      } catch { /* skip */ }
    }

    const reviewActivity = {
      total_reviews: totalReviews,
      correct: correctReviews,
      incorrect: totalReviews - correctReviews,
      accuracy_pct: totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : null,
    };

    // Будуємо 30-денний heatmap масив (той самий діапазон що vocab_growth)
    const mistakeHeatmap = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });
      const bucket = heatmapByDate[dayStr];
      if (bucket && bucket.total > 0) {
        const accuracy = Math.round((bucket.correct / bucket.total) * 100);
        mistakeHeatmap.push({ date: dayStr, total: bucket.total, correct: bucket.correct, accuracy_pct: accuracy });
      } else {
        mistakeHeatmap.push({ date: dayStr, total: 0, correct: 0, accuracy_pct: null });
      }
    }

    // ── 9. Обчислення: difficulty_overview + weakness_map ───────────────────
    const factorMap = new Map((factorRes.data || []).map((w) => [w.id, w]));

    let sumBase = 0;
    let sumPersonal = 0;
    let diffCount = 0;
    const trendCounts = { easier: 0, harder: 0, stable: 0 };
    const factors = {
      frequency_band:   { sumDelta: 0, count: 0 },
      polysemy_level:   { sumDelta: 0, count: 0 },
      morph_complexity: { sumDelta: 0, count: 0 },
      phrase_flag:      { sumDelta: 0, count: 0 },
    };

    for (const [wordId, prog] of progressMap) {
      const wordData = factorMap.get(wordId);
      if (!wordData) continue;

      if (prog.trend_direction && trendCounts[prog.trend_direction] !== undefined) {
        trendCounts[prog.trend_direction]++;
      }

      if (wordData.base_score != null && prog.personal_score != null) {
        sumBase += wordData.base_score;
        sumPersonal += prog.personal_score;
        diffCount++;
        const delta = prog.personal_score - wordData.base_score;

        if (wordData.frequency_band != null) {
          factors.frequency_band.sumDelta += delta;
          factors.frequency_band.count++;
        }
        if (wordData.polysemy_level != null) {
          factors.polysemy_level.sumDelta += delta;
          factors.polysemy_level.count++;
        }
        if (wordData.morph_complexity != null) {
          factors.morph_complexity.sumDelta += delta;
          factors.morph_complexity.count++;
        }
        if (wordData.phrase_flag != null) {
          factors.phrase_flag.sumDelta += delta;
          factors.phrase_flag.count++;
        }
      }
    }

    const dominantTrend =
      Object.entries(trendCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    const difficultyOverview =
      diffCount > 0
        ? {
            avg_base_score: Math.round(sumBase / diffCount),
            avg_personal_score: Math.round(sumPersonal / diffCount),
            dominant_trend: dominantTrend,
            word_count: diffCount,
          }
        : null;

    const weaknessMap = {};
    for (const [key, val] of Object.entries(factors)) {
      weaknessMap[key] =
        val.count > 0
          ? { avg_delta: Math.round(val.sumDelta / val.count), count: val.count }
          : null;
    }

    // ── 10. Saves today (for usage counter) ─────────────────────────────────
    const todayUTCStart = new Date();
    todayUTCStart.setUTCHours(0, 0, 0, 0);

    let savesToday = 0;
    if (listIds.length > 0) {
      const { count: savesCount, error: savesErr } = await supabase
        .from("list_words")
        .select("id", { count: "exact", head: true })
        .in("list_id", listIds)
        .gte("added_at", todayUTCStart.toISOString());

      if (!savesErr) savesToday = savesCount ?? 0;
    }

    // ── 11. Usage counters (reset AI if date changed) ────────────────────────
    const { getEntitlements } = require("../config/entitlements");
    const plan = profile.subscription_plan || "free";
    const ent  = getEntitlements(plan);

    const todayUTC = new Date().toISOString().slice(0, 10);
    const aiResetNeeded = !profile.ai_reset_date || profile.ai_reset_date !== todayUTC;
    const aiUsageToday  = aiResetNeeded ? 0 : (profile.ai_requests_today ?? 0);

    // ── 12. Відповідь ────────────────────────────────────────────────────────
    return res.json({
      ...profile,
      streak,
      cefr_distribution: cefrDist,
      word_state_distribution: stateDist,
      vocab_growth: vocabGrowth,
      vocab_velocity: { last_7_days: velocity7, last_30_days: velocity30 },
      review_activity: reviewActivity,
      mistake_heatmap: mistakeHeatmap,
      difficulty_overview: difficultyOverview,
      weakness_map: weaknessMap,
      usage: {
        plan,
        ai_requests_today:  aiUsageToday,
        ai_limit:           ent.maxAiPerDay,
        saves_today:        savesToday,
        saves_limit:        ent.maxSavesPerDay,
        list_count:         listIds.length,
        list_limit:         ent.maxLists,
        total_words:        wordIds.length,
        words_limit:        ent.maxTotalWords,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
