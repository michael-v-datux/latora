/**
 * server/routes/profile.js — Маршрути профілю користувача
 *
 * GET /api/profile/me — отримати профіль + subscription_plan поточного юзера
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

// GET /api/profile/me
router.get("/profile/me", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, subscription_plan, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    // Якщо рядку ще немає (edge case до тригера) — повертаємо дефолт
    const profile = data ?? { id: userId, subscription_plan: "free" };

    return res.json(profile);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
