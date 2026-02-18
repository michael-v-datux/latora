/**
 * server/routes/profile.js — Маршрути профілю користувача
 *
 * GET /api/profile/me — профіль + subscription_plan + streak + cefr_distribution
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

// ─── Хелпер: обчислити стрік (consecutive practice days) ───────────────────
// Логіка:
//   - Беремо всі унікальні дати (в таймзоні клієнта) завершених сесій
//   - Рахуємо кількість днів поспіль НАЗАД від сьогодні (включно)
//   - Якщо сьогодні ще не було сесій — рахуємо з вчора (щоб не скидати стрік
//     якщо людина ще не встигла повторити, але вчора повторювала)
//   - Стрік "згорає" якщо пропущено ≥2 дні (тобто позавчора — останній день)
function computeStreak(sessions, clientTz) {
  if (!sessions || sessions.length === 0) return 0;

  // Перетворити кожну сесію у локальну дату (рядок YYYY-MM-DD)
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

  // Отримати сьогоднішню та вчорашню локальні дати
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString("en-CA", { timeZone: clientTz || "UTC" });

  // Стартова точка: якщо сьогодні є сесії — рахуємо з сьогодні,
  // якщо ні, але вчора були — рахуємо з вчора (стрік ще живий)
  // якщо ні вчора, ні сьогодні — стрік = 0 (згорів)
  let startStr;
  if (uniqueDays.has(todayStr)) {
    startStr = todayStr;
  } else if (uniqueDays.has(yesterdayStr)) {
    startStr = yesterdayStr;
  } else {
    return 0;
  }

  // Рахуємо поспіль назад від startStr
  let streak = 0;
  let cursor = new Date(startStr + "T12:00:00Z"); // полудень UTC щоб уникнути DST проблем
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

    // 1. Профіль (план підписки)
    const { data: profileData, error: profileErr } = await supabase
      .from("profiles")
      .select("id, subscription_plan, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (profileErr && profileErr.code !== "PGRST116") throw profileErr;
    const profile = profileData ?? { id: userId, subscription_plan: "free" };

    // 2. Стрік — всі завершені сесії (тільки completed_at, без обмеження дат)
    const { data: sessions, error: sessErr } = await supabase
      .from("practice_sessions")
      .select("completed_at")
      .eq("user_id", userId)
      .order("completed_at", { ascending: false });

    if (sessErr) throw sessErr;

    const streak = computeStreak(sessions || [], clientTz);

    // 3. CEFR distribution — слова у списках цього юзера
    // Джойнимо: lists → list_words → words і групуємо за cefr_level
    const { data: listWords, error: lwErr } = await supabase
      .from("lists")
      .select("list_words(words(cefr_level))")
      .eq("user_id", userId);

    if (lwErr) throw lwErr;

    const cefrDist = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 };
    const validLevels = new Set(Object.keys(cefrDist));

    for (const list of listWords || []) {
      for (const lw of list.list_words || []) {
        const level = lw.words?.cefr_level;
        if (level && validLevels.has(level)) {
          cefrDist[level]++;
        }
      }
    }

    return res.json({
      ...profile,
      streak,
      cefr_distribution: cefrDist,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
