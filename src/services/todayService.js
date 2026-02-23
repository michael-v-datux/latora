/**
 * todayService.js — Daily Plan / Today Queue service
 *
 * GET  /api/today              — fetch (or auto-generate) today's plan
 * POST /api/today/regen        — regenerate plan (Pro only)
 * PATCH /api/today/items/:id   — mark word as completed/skipped/pending
 */

import { api } from "./apiClient";

/**
 * Fetch today's plan. Server auto-generates one if it doesn't exist.
 * Returns:
 * {
 *   id, date, target_count, completed_count, generated_at,
 *   items: [{ id, word_id, list_id, order_index, status, completed_at, word: {...} }],
 *   can_regen, can_customize, plan_size_limit
 * }
 */
export async function fetchTodayPlan() {
  const res = await api.get("/today");
  return res.data;
}

/**
 * Regenerate today's plan (Pro only).
 * @param {number} [targetCount] — desired plan size (10–50), Pro only
 */
export async function regenTodayPlan(targetCount) {
  const res = await api.post("/today/regen", targetCount ? { targetCount } : {});
  return res.data;
}

/**
 * Mark a word in today's plan as completed, skipped, or pending.
 * @param {string} wordId
 * @param {'completed'|'skipped'|'pending'} status
 * @returns {{ item, completed_count, target_count }}
 */
export async function updateTodayItem(wordId, status) {
  const res = await api.patch(`/today/items/${wordId}`, { status });
  return res.data;
}

/**
 * Fetch per-word accuracy stats.
 * @param {string} wordId
 */
export async function fetchWordStats(wordId) {
  const res = await api.get(`/words/${wordId}/stats`);
  return res.data;
}
