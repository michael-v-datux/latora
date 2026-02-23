/**
 * server/routes/today.js — Daily Plan / Today Queue
 *
 * GET  /api/today           — get (or generate) today's plan with words
 * POST /api/today/regen     — regenerate today's plan (Pro only)
 * PATCH /api/today/items/:wordId — mark a word complete / skipped
 *
 * Plan generation logic:
 *   1. Prioritize DUE words (next_review <= now), ordered by most overdue
 *   2. Fill remainder with NEW words (no progress record yet), ordered by difficulty_score asc
 *   3. If total words < dailyPlanSize, include all available words
 *   4. Words are drawn from ALL of the user's lists
 *
 * Plan is regenerated only if:
 *   - No plan exists for today
 *   - User explicitly requests regen (POST /api/today/regen) — Pro only
 */

const express = require("express");
const router = express.Router();

const requireAuth = require("../middleware/requireAuth");
const { getEntitlements } = require("../config/entitlements");

// ─── Helper: get today's date string in UTC (YYYY-MM-DD) ────────────────────
function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// ─── Helper: get subscription plan for user ──────────────────────────────────
async function getUserPlan(supabase, userId) {
  const { data } = await supabase
    .from("profiles")
    .select("subscription_plan")
    .eq("id", userId)
    .single();
  return data?.subscription_plan || "free";
}

// ─── Core: generate today's plan items ──────────────────────────────────────
// Returns array of { word_id, list_id, order_index } ready to insert into daily_plan_items
async function generatePlanItems(supabase, userId, targetCount) {
  // 1. Get all words the user has in their lists
  const { data: lists, error: listsErr } = await supabase
    .from("lists")
    .select("id")
    .eq("user_id", userId);

  if (listsErr) throw listsErr;

  const listIds = (lists || []).map((l) => l.id);
  if (listIds.length === 0) return [];

  // 2. Get all list_words with word data
  const { data: listWords, error: lwErr } = await supabase
    .from("list_words")
    .select("list_id, word_id, words(id, difficulty_score, cefr_level)")
    .in("list_id", listIds);

  if (lwErr) throw lwErr;

  // Deduplicate words (same word can be in multiple lists — use first list)
  const wordMap = new Map(); // word_id → { word_id, list_id, difficulty_score }
  for (const lw of listWords || []) {
    if (!lw.words) continue;
    if (!wordMap.has(lw.word_id)) {
      wordMap.set(lw.word_id, {
        word_id: lw.word_id,
        list_id: lw.list_id,
        difficulty_score: lw.words.difficulty_score ?? 50,
      });
    }
  }

  const allWordIds = [...wordMap.keys()];
  if (allWordIds.length === 0) return [];

  // 3. Get progress for all words
  const { data: progress, error: progErr } = await supabase
    .from("user_word_progress")
    .select("word_id, next_review, repetitions")
    .in("word_id", allWordIds);

  if (progErr) throw progErr;

  const progressMap = new Map((progress || []).map((p) => [p.word_id, p]));
  const now = new Date();

  // 4. Partition into due vs new
  const dueWords = [];
  const newWords = [];

  for (const wordId of allWordIds) {
    const p = progressMap.get(wordId);
    const wordInfo = wordMap.get(wordId);

    if (!p) {
      // No progress = new word
      newWords.push(wordInfo);
    } else if (new Date(p.next_review) <= now) {
      // Has progress but due
      const overdueDays = (now - new Date(p.next_review)) / (1000 * 60 * 60 * 24);
      dueWords.push({ ...wordInfo, overdueDays });
    }
    // else: scheduled for future → skip (not due today)
  }

  // 5. Sort: due by most overdue first, new by easiest first
  dueWords.sort((a, b) => b.overdueDays - a.overdueDays);
  newWords.sort((a, b) => a.difficulty_score - b.difficulty_score);

  // 6. Build the plan: fill up to targetCount
  const selected = [];
  const needed = Math.min(targetCount, allWordIds.length);

  for (const w of dueWords) {
    if (selected.length >= needed) break;
    selected.push(w);
  }
  for (const w of newWords) {
    if (selected.length >= needed) break;
    selected.push(w);
  }

  // 7. Map to plan items
  return selected.map((w, i) => ({
    word_id:     w.word_id,
    list_id:     w.list_id,
    order_index: i,
  }));
}

// ─── GET /api/today ──────────────────────────────────────────────────────────
// Returns today's plan. Generates one if it doesn't exist yet.
router.get("/today", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;
    const today = todayUTC();

    // Get plan
    const plan = await getEntitlements(await getUserPlan(supabase, userId));
    const targetCount = plan.dailyPlanSize;

    // 1. Look for existing plan for today
    const { data: existing, error: fetchErr } = await supabase
      .from("daily_plans")
      .select("*, daily_plan_items(*, words(*))")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (fetchErr && fetchErr.code !== "PGRST116") throw fetchErr; // PGRST116 = not found

    if (existing) {
      // Return existing plan
      return res.json(formatPlan(existing, plan));
    }

    // 2. No plan yet — generate one
    const items = await generatePlanItems(supabase, userId, targetCount);

    // 3. Insert daily_plan
    const { data: newPlan, error: planErr } = await supabase
      .from("daily_plans")
      .insert({
        user_id:    userId,
        date:       today,
        target_count: items.length,
        completed_count: 0,
      })
      .select()
      .single();

    if (planErr) throw planErr;

    // 4. Insert plan items
    if (items.length > 0) {
      const { error: itemsErr } = await supabase
        .from("daily_plan_items")
        .insert(items.map((item) => ({ ...item, plan_id: newPlan.id })));

      if (itemsErr) throw itemsErr;
    }

    // 5. Fetch full plan with words
    const { data: fullPlan, error: fullErr } = await supabase
      .from("daily_plans")
      .select("*, daily_plan_items(*, words(*))")
      .eq("id", newPlan.id)
      .single();

    if (fullErr) throw fullErr;

    return res.json(formatPlan(fullPlan, plan));
  } catch (error) {
    return next(error);
  }
});

// ─── POST /api/today/regen ───────────────────────────────────────────────────
// Pro only: regenerate today's plan (delete existing items + regenerate)
router.post("/today/regen", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;
    const today = todayUTC();

    const userPlan = await getUserPlan(supabase, userId);
    const ent = getEntitlements(userPlan);

    if (!ent.canRegenPlan) {
      return res.status(403).json({
        error: "Plan regeneration requires Pro subscription",
        code: "REGEN_PRO_ONLY",
      });
    }

    const targetCount = req.body?.targetCount
      ? Math.max(10, Math.min(50, parseInt(req.body.targetCount, 10) || ent.dailyPlanSize))
      : ent.dailyPlanSize;

    // Find or create plan record
    let planId;
    const { data: existing } = await supabase
      .from("daily_plans")
      .select("id")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (existing) {
      planId = existing.id;
      // Delete existing items
      await supabase.from("daily_plan_items").delete().eq("plan_id", planId);
      // Reset completed count
      await supabase
        .from("daily_plans")
        .update({ completed_count: 0, target_count: targetCount, generated_at: new Date().toISOString() })
        .eq("id", planId);
    } else {
      const { data: newPlan, error: planErr } = await supabase
        .from("daily_plans")
        .insert({ user_id: userId, date: today, target_count: targetCount, completed_count: 0 })
        .select()
        .single();
      if (planErr) throw planErr;
      planId = newPlan.id;
    }

    // Generate new items
    const items = await generatePlanItems(supabase, userId, targetCount);
    if (items.length > 0) {
      await supabase
        .from("daily_plan_items")
        .insert(items.map((item) => ({ ...item, plan_id: planId })));
    }

    // Update target to actual count
    await supabase
      .from("daily_plans")
      .update({ target_count: items.length })
      .eq("id", planId);

    // Fetch full plan
    const { data: fullPlan, error: fullErr } = await supabase
      .from("daily_plans")
      .select("*, daily_plan_items(*, words(*))")
      .eq("id", planId)
      .single();

    if (fullErr) throw fullErr;

    return res.json(formatPlan(fullPlan, getEntitlements(userPlan)));
  } catch (error) {
    return next(error);
  }
});

// ─── PATCH /api/today/items/:wordId ─────────────────────────────────────────
// Mark a word as completed or skipped in today's plan
router.patch("/today/items/:wordId", requireAuth, async (req, res, next) => {
  try {
    const supabase = req.supabase;
    const userId = req.user.id;
    const { wordId } = req.params;
    const { status } = req.body; // 'completed' | 'skipped' | 'pending'

    if (!["completed", "skipped", "pending"].includes(status)) {
      return res.status(400).json({ error: "status must be completed, skipped, or pending" });
    }

    const today = todayUTC();

    // Find today's plan
    const { data: todayPlan, error: planErr } = await supabase
      .from("daily_plans")
      .select("id, completed_count, target_count")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (planErr || !todayPlan) {
      return res.status(404).json({ error: "No plan found for today" });
    }

    // Update the item
    const updateData = {
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    };

    const { data: updatedItem, error: itemErr } = await supabase
      .from("daily_plan_items")
      .update(updateData)
      .eq("plan_id", todayPlan.id)
      .eq("word_id", wordId)
      .select()
      .single();

    if (itemErr) throw itemErr;

    // Recount completed items and update the plan
    const { count: completedCount } = await supabase
      .from("daily_plan_items")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", todayPlan.id)
      .eq("status", "completed");

    await supabase
      .from("daily_plans")
      .update({ completed_count: completedCount ?? 0 })
      .eq("id", todayPlan.id);

    return res.json({
      item: updatedItem,
      completed_count: completedCount ?? 0,
      target_count: todayPlan.target_count,
    });
  } catch (error) {
    return next(error);
  }
});

// ─── Helper: format plan response ────────────────────────────────────────────
function formatPlan(plan, ent) {
  const items = (plan.daily_plan_items || [])
    .sort((a, b) => a.order_index - b.order_index)
    .map((item) => ({
      id:           item.id,
      word_id:      item.word_id,
      list_id:      item.list_id,
      order_index:  item.order_index,
      status:       item.status,
      completed_at: item.completed_at,
      word:         item.words || null,
    }));

  return {
    id:              plan.id,
    date:            plan.date,
    target_count:    plan.target_count,
    completed_count: plan.completed_count,
    generated_at:    plan.generated_at,
    items,
    // Entitlement info for the client
    can_regen:       ent.canRegenPlan,
    can_customize:   ent.canCustomizePlan,
    plan_size_limit: ent.dailyPlanSize,
  };
}

module.exports = router;
