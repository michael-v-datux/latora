/**
 * practiceService.js — Сервіс для повторення слів
 *
 * API:
 * - GET    /practice/stats         — загальна статистика
 * - GET    /practice/:listId       — слова для повторення зі списку
 * - GET    /practice/:listId/all   — усі слова зі списку (для генерації варіантів)
 * - POST   /practice/result        — зберегти результат повторення
 */

import { api } from "./apiClient";

export async function fetchPracticeStats() {
  const res = await api.get("/practice/stats");
  return res.data;
}

export async function fetchPracticeWords(listId) {
  const res = await api.get(`/practice/${listId}`);
  return res.data;
}

export async function fetchAllListWords(listId) {
  const res = await api.get(`/practice/${listId}/all`);
  return res.data;
}

export async function submitPracticeResult(wordId, quality, newProgress) {
  const res = await api.post("/practice/result", {
    wordId,
    quality,
    newProgress,
  });
  return res.data;
}
