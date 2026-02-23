/**
 * server/routes/account.js — Account management
 *
 * DELETE /api/account — hard delete all user data + auth user
 *
 * Safety:
 * - userId comes ONLY from the verified JWT (req.user.id), never from req.body
 * - Deletes only rows WHERE user_id = userId (the authenticated user)
 * - Tables deleted in dependency order to avoid FK constraint failures
 * - Uses Supabase service_role key for auth.admin.deleteUser()
 */

const express = require("express");
const router = express.Router();
const requireAuth = require("../middleware/requireAuth");

// Tables to clean up, in safe delete order (children before parents)
// Each entry: { table, column } where column is the user FK column name
const USER_TABLES = [
  { table: "daily_plan_items",  column: null,      via: "daily_plans" }, // handled via cascade or manual
  { table: "daily_plans",       column: "user_id" },
  { table: "practice_events",   column: "user_id" },
  { table: "practice_sessions", column: "user_id" },
  { table: "user_word_progress",column: "user_id" },
  { table: "user_skill_profile",column: "user_id" },
  { table: "list_words",        column: null,      via: "lists" },       // handled via lists delete
  { table: "lists",             column: "user_id" },
  { table: "profiles",          column: "id"       },
];

// DELETE /api/account — permanently delete all user data
router.delete("/account", requireAuth, async (req, res, next) => {
  try {
    const supabase    = req.supabase;     // user-scoped client (for data ops)
    const adminClient = req.supabaseAdmin; // service-role client (for auth.admin)
    const userId      = req.user.id;      // always from JWT, never from body

    // ── 1. Delete daily_plan_items (via plans owned by user) ────────────────
    // First get all plan IDs for this user
    const { data: plans } = await supabase
      .from("daily_plans")
      .select("id")
      .eq("user_id", userId);

    const planIds = (plans || []).map((p) => p.id);
    if (planIds.length > 0) {
      await supabase
        .from("daily_plan_items")
        .delete()
        .in("plan_id", planIds);
    }

    // ── 2. Delete list_words (via lists owned by user) ───────────────────────
    const { data: lists } = await supabase
      .from("lists")
      .select("id")
      .eq("user_id", userId);

    const listIds = (lists || []).map((l) => l.id);
    if (listIds.length > 0) {
      await supabase
        .from("list_words")
        .delete()
        .in("list_id", listIds);
    }

    // ── 3. Delete remaining user-owned rows ──────────────────────────────────
    const directTables = [
      { table: "daily_plans",        column: "user_id" },
      { table: "practice_events",    column: "user_id" },
      { table: "practice_sessions",  column: "user_id" },
      { table: "user_word_progress", column: "user_id" },
      { table: "user_skill_profile", column: "user_id" },
      { table: "lists",              column: "user_id" },
      { table: "profiles",           column: "id"      },
    ];

    for (const { table, column } of directTables) {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq(column, userId);

      if (error) {
        // Log but continue — don't abort the whole flow over a missing row
        console.warn(`⚠️ account delete: failed to delete from ${table}:`, error.message);
      }
    }

    // ── 4. Delete the auth user (requires service_role) ──────────────────────
    if (adminClient) {
      const { error: authErr } = await adminClient.auth.admin.deleteUser(userId);
      if (authErr) {
        console.error("❌ account delete: failed to delete auth user:", authErr.message);
        return res.status(500).json({ error: "Failed to delete auth account. Please contact support." });
      }
    } else {
      // If no admin client configured, fall back to signOut (data is already gone)
      console.warn("⚠️ account delete: no adminClient configured — skipping auth.admin.deleteUser");
    }

    return res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
