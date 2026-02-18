/**
 * profileService.js — Сервіс профілю користувача
 *
 * API:
 * - GET /profile/me — профіль + subscription_plan
 */

import api from "./api";

/**
 * Отримати профіль поточного користувача.
 * Повертає { id, subscription_plan, created_at, updated_at }
 */
export async function fetchMyProfile() {
  const res = await api.get("/profile/me");
  return res.data;
}
