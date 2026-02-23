/**
 * server/routes/settings.js — User settings sync
 *
 * GET  /api/settings       — read user settings from profile
 * PATCH /api/settings      — update one or more settings fields
 *
 * Settable fields:
 *   - ui_lang          (string: 'en' | 'uk')
 *   - source_lang      (string: language code, e.g. 'EN')
 *   - target_lang      (string: language code, e.g. 'UK')
 *   - difficulty_mode  (string: 'auto' | 'easy' | 'medium' | 'hard')
 *
 * Design: AsyncStorage is the instant local cache; server is the source of truth.
 * On app open → read from AsyncStorage first, then fetch from server and update cache.
 * On change → update AsyncStorage immediately + PATCH server in background.
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

const ALLOWED_FIELDS = ['ui_lang', 'source_lang', 'target_lang', 'difficulty_mode'];

// GET /api/settings — return current user settings
router.get("/settings", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;

    const { data, error } = await supabase
      .from("profiles")
      .select("ui_lang, source_lang, target_lang, difficulty_mode, settings_updated_at")
      .eq("id", userId)
      .single();

    if (error && error.code !== "PGRST116") throw error;

    // Return nulls for missing fields (profile might not exist yet)
    return res.json({
      ui_lang:          data?.ui_lang          ?? null,
      source_lang:      data?.source_lang      ?? null,
      target_lang:      data?.target_lang      ?? null,
      difficulty_mode:  data?.difficulty_mode  ?? null,
      settings_updated_at: data?.settings_updated_at ?? null,
    });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/settings — update one or more settings fields
router.patch("/settings", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;

    // Only pick allowed fields from the request body
    const updates = {};
    for (const field of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field] ?? null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid settings fields provided" });
    }

    // Validate difficulty_mode
    if (updates.difficulty_mode !== undefined && updates.difficulty_mode !== null) {
      if (!['auto', 'easy', 'medium', 'hard'].includes(updates.difficulty_mode)) {
        return res.status(400).json({ error: "Invalid difficulty_mode value" });
      }
    }

    updates.settings_updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select("ui_lang, source_lang, target_lang, difficulty_mode, settings_updated_at")
      .single();

    if (error) throw error;

    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
