/**
 * practiceService.js — Сервіс для повторення слів
 *
 * API:
 * - GET    /practice/stats           — загальна статистика
 * - GET    /practice/list-statuses   — стан повторення кожного списку
 * - GET    /practice/session-counts  — кількість завершених сесій (lifetime)
 * - GET    /practice/:listId         — слова для повторення зі списку (?force=true для всіх)
 * - GET    /practice/:listId/all     — усі слова зі списку (для генерації варіантів)
 * - POST   /practice/result          — зберегти результат повторення
 * - POST   /practice/session         — зберегти завершену сесію
 */

import { api } from "./apiClient";

export async function fetchPracticeStats() {
  const res = await api.get("/practice/stats");
  return res.data;
}

export async function fetchListStatuses() {
  // Передаємо таймзону клієнта, щоб сервер правильно рахував "сьогодні"
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; // e.g. "Europe/Kyiv"
  const res = await api.get("/practice/list-statuses", { params: { tz } });
  return res.data;
}

export async function fetchPracticeWords(listId, force = false) {
  const params = force ? { force: "true" } : {};
  const res = await api.get(`/practice/${listId}`, { params });
  return res.data;
}

export async function fetchAllListWords(listId) {
  const res = await api.get(`/practice/${listId}/all`);
  return res.data;
}

export async function submitPracticeResult(wordId, quality, newProgress, opts = {}) {
  const res = await api.post("/practice/result", {
    wordId,
    quality,
    newProgress,
    sessionId:    opts.sessionId    ?? null,
    listId:       opts.listId       ?? null,
    answerTimeMs: opts.answerTimeMs ?? null,
    sourceLang:   opts.sourceLang   ?? null,
    targetLang:   opts.targetLang   ?? null,
    promptSide:   opts.promptSide   ?? null,
  });
  return res.data;
}

export async function logPracticeSession(listId, wordCount, correctCount) {
  const res = await api.post("/practice/session", {
    listId,
    wordCount,
    correctCount,
  });
  return res.data;
}

export async function fetchSessionCounts(listIds) {
  const params = listIds ? { listIds: listIds.join(",") } : {};
  const res = await api.get("/practice/session-counts", { params });
  return res.data;
}
