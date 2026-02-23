/**
 * server/routes/profile.js — Маршрути профілю користувача
 *
 * GET /api/profile/me — профіль + subscription_plan + streak + cefr_distribution
 *                      + word_state_distribution + vocab_growth + vocab_velocity
 *                      + review_activity + difficulty_overview + weakness_map
 *                      + skill_profile (ALE factor scores)
 *                      + language_stats (pair counts, role breakdown — рівні A/B/C)
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");
const { baseLang, normalizePair } = require("../lib/langUtils");

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
        .select("word_id, added_at, words(cefr_level, source_lang, target_lang)")
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

    const [progressRes, growthRes, eventsRes, factorRes, skillProfileRes] = await Promise.all([
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

      // practice_events: результати для review activity + heatmap + language stats (30 днів)
      supabase
        .from("practice_events")
        .select("result, created_at, source_lang, target_lang, prompt_side")
        .eq("user_id", userId)
        .gte("created_at", thirtyDaysAgo.toISOString()),

      // words: difficulty factors для weakness map
      wordIds.length > 0
        ? supabase
            .from("words")
            .select("id, base_score, frequency_band, polysemy_level, morph_complexity, phrase_flag")
            .in("id", wordIds)
        : Promise.resolve({ data: [] }),

      // user_skill_profile: ALE factor scores
      supabase
        .from("user_skill_profile")
        .select("frequency_score, polysemy_score, morph_score, idiom_score, total_updates, updated_at")
        .eq("user_id", userId)
        .single(),
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

    // ── 12. Skill profile (ALE) ───────────────────────────────────────────────
    const skillProfile = skillProfileRes?.data ?? null;

    // ── 12b. Language stats (рівні A / B / C) ────────────────────────────────
    // Level A — Pair counts (кількість слів у кожній мовній парі)
    // Level B1 — Involved counts (скільки слів містять кожну мову)
    // Level B2 / C / KPI — тільки для Pro (analyticsLevel === 'full')
    const { getEntitlements: _getEnt } = require("../config/entitlements");
    const _ent = _getEnt(plan);
    const isFullAnalytics = _ent.analyticsLevel === 'full';

    // --- A & B1: обчислюємо з list_words → words (вже є в lwData) ---
    const pairWordCount  = {};   // { "EN|UK": 120, "PL|DE": 30 }
    const pairDirCount   = {};   // { "EN|UK": { "EN->UK": 3, "UK->EN": 1 } } — directional split
    const langInvolved   = {};   // { "EN": 150, "UK": 120, "PL": 30, "DE": 30 }

    for (const lw of lwData) {
      const src = lw.words?.source_lang ? baseLang(lw.words.source_lang) : null;
      const tgt = lw.words?.target_lang ? baseLang(lw.words.target_lang) : null;
      if (!src || !tgt) continue;

      const pairKey = normalizePair(src, tgt);
      pairWordCount[pairKey] = (pairWordCount[pairKey] || 0) + 1;

      // Directional split: рахуємо окремо EN→UK і UK→EN всередині тієї ж пари
      if (!pairDirCount[pairKey]) pairDirCount[pairKey] = {};
      const dirKey = `${src}->${tgt}`;
      pairDirCount[pairKey][dirKey] = (pairDirCount[pairKey][dirKey] || 0) + 1;

      langInvolved[src] = (langInvolved[src] || 0) + 1;
      langInvolved[tgt] = (langInvolved[tgt] || 0) + 1;
    }

    // Level A: масив пар з кількістю слів + directional breakdown
    const pairStats = Object.entries(pairWordCount).map(([pair, wordCount]) => {
      const [langA, langB] = pair.split('|');
      // Перетворюємо { "EN->UK": 3, "UK->EN": 1 } → [{ dir: "EN→UK", count: 3 }, ...]
      const directions = Object.entries(pairDirCount[pair] || {})
        .map(([dir, count]) => ({ dir: dir.replace('->', '→'), count }))
        .sort((a, b) => b.count - a.count);
      return { pair, lang_a: langA, lang_b: langB, word_count: wordCount, directions };
    }).sort((a, b) => b.word_count - a.word_count);

    // Level B1: масив мов з кількістю слів (де ця мова задіяна)
    const langStats = Object.entries(langInvolved).map(([lang, count]) => ({
      lang,
      word_count: count,
    })).sort((a, b) => b.word_count - a.word_count);

    // --- B2 / C / KPI: тільки Pro — з practice_events за 30 днів ---
    // Для Free — повертаємо тільки рівні A та B1
    let pairPracticeStats = null;  // B2: { "EN|UK": { total7: N, total30: N, correct7: N, correct30: N } }
    let roleStats         = null;  // C:  { "EN": { as_source: N, as_target: N, acc_source: %, acc_target: % } }

    if (isFullAnalytics && eventsRes.data?.length > 0) {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const pairPractice = {};  // { pairKey: { t30, c30, t7, c7 } }
      const rolePractice = {};  // { lang: { as_source: {total, correct}, as_target: {total, correct} } }

      for (const ev of eventsRes.data) {
        const src = ev.source_lang ? baseLang(ev.source_lang) : null;
        const tgt = ev.target_lang ? baseLang(ev.target_lang) : null;
        if (!src || !tgt) continue;

        const pairKey = normalizePair(src, tgt);
        if (!pairPractice[pairKey]) pairPractice[pairKey] = { t30: 0, c30: 0, t7: 0, c7: 0 };
        pairPractice[pairKey].t30++;
        if (ev.result === true) pairPractice[pairKey].c30++;

        const evDate = new Date(ev.created_at);
        if (evDate >= sevenDaysAgo) {
          pairPractice[pairKey].t7++;
          if (ev.result === true) pairPractice[pairKey].c7++;
        }

        // Role-level: тільки якщо prompt_side відомий
        if (ev.prompt_side === 'source' || ev.prompt_side === 'target') {
          // prompt_side = 'source' → юзер бачив source, вгадував target → перевіряємо target
          // prompt_side = 'target' → юзер бачив target, вгадував source → перевіряємо source
          // Для ролі "producing": мова виступає як TARGET (юзер має її відтворити)
          // source_lang as_source: prompt='source' → juzer бачить src, продукує tgt → src=passive role
          // Спрощення: as_source = кількість разів ця мова була SOURCE у practice_events
          for (const lang of [src, tgt]) {
            if (!rolePractice[lang]) {
              rolePractice[lang] = {
                as_source:  { total: 0, correct: 0 },
                as_target:  { total: 0, correct: 0 },
              };
            }
          }
          const isCorrect = ev.result === true;
          // Source lang as_source
          rolePractice[src].as_source.total++;
          if (isCorrect) rolePractice[src].as_source.correct++;
          // Target lang as_target
          rolePractice[tgt].as_target.total++;
          if (isCorrect) rolePractice[tgt].as_target.correct++;
        }
      }

      // B2: serialize pair practice activity
      pairPracticeStats = Object.entries(pairPractice).map(([pair, v]) => {
        const [langA, langB] = pair.split('|');
        return {
          pair, lang_a: langA, lang_b: langB,
          practice_30d: v.t30,
          correct_30d:  v.c30,
          accuracy_30d: v.t30 > 0 ? Math.round((v.c30 / v.t30) * 100) : null,
          practice_7d:  v.t7,
          correct_7d:   v.c7,
          accuracy_7d:  v.t7  > 0 ? Math.round((v.c7 / v.t7)   * 100) : null,
        };
      }).sort((a, b) => b.practice_30d - a.practice_30d);

      // C: role stats per language
      roleStats = Object.entries(rolePractice).map(([lang, roles]) => ({
        lang,
        as_source_total:   roles.as_source.total,
        as_source_acc_pct: roles.as_source.total > 0
          ? Math.round((roles.as_source.correct / roles.as_source.total) * 100)
          : null,
        as_target_total:   roles.as_target.total,
        as_target_acc_pct: roles.as_target.total > 0
          ? Math.round((roles.as_target.correct / roles.as_target.total) * 100)
          : null,
      })).sort((a, b) => (b.as_source_total + b.as_target_total) - (a.as_source_total + a.as_target_total));
    }

    const languageStats = {
      analytics_level:    isFullAnalytics ? 'full' : 'basic',
      pair_word_counts:   pairStats,           // Level A — Free
      lang_involved:      langStats,           // Level B1 — Free
      pair_practice:      pairPracticeStats,   // Level B2 — Pro (null for Free)
      role_stats:         roleStats,           // Level C — Pro (null for Free)
    };

    // ── 13. Відповідь ────────────────────────────────────────────────────────
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
      skill_profile: skillProfile,
      language_stats: languageStats,
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
