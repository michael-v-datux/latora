/**
 * profileService.js — Сервіс профілю користувача
 *
 * API:
 * - GET /profile/me — профіль + subscription_plan + streak + cefr_distribution
 */

import { api } from "./apiClient";

/**
 * Отримати профіль поточного користувача.
 * Повертає {
 *   id, subscription_plan, created_at, updated_at,
 *   streak: number,
 *   cefr_distribution: { A1, A2, B1, B2, C1, C2 }
 * }
 */
export async function fetchMyProfile() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const res = await api.get("/profile/me", { params: { tz } });
  return res.data;
}
