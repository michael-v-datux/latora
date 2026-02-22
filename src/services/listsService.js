/**
 * listsService.js — Сервіс для роботи зі списками
 *
 * API:
 * - GET    /lists
 * - POST   /lists
 * - GET    /lists/:id
 * - POST   /lists/:id/words   { wordId }
 * - DELETE /lists/:id/words/:wordId
 */

import { api } from "./apiClient";

/**
 * Returns { lists: [...], usage: { listCount, maxLists, plan } }
 * For backwards compat, also exposes the raw response as-is.
 */
export async function fetchLists() {
  const res = await api.get("/lists");
  // Server now returns { lists, usage } instead of a bare array
  if (res.data && Array.isArray(res.data.lists)) {
    return res.data; // { lists, usage }
  }
  // Fallback: old shape (bare array) — shouldn't happen after server update
  return { lists: Array.isArray(res.data) ? res.data : [], usage: null };
}

export async function fetchListDetails(listId) {
  const res = await api.get(`/lists/${listId}`);
  return res.data;
}

export async function createList({ name, emoji = "📚", description = "" }) {
  const res = await api.post("/lists", { name, emoji, description });
  return res.data;
}

export async function addWordToList(listId, wordId, opts = {}) {
  try {
    const res = await api.post(`/lists/${listId}/words`, {
      wordId,
      forceMix: !!opts.forceMix,
      rememberChoice: !!opts.rememberChoice,
    });
    return res.data;
  } catch (e) {
    // bubble structured errors to UI
    const status = e?.response?.status;
    const data = e?.response?.data;
    const err = new Error(data?.error || data?.message || e.message || 'Request failed');
    err.status = status;
    err.data = data;
    throw err;
  }
}

export async function removeWordFromList(listId, wordId) {
  const res = await api.delete(`/lists/${listId}/words/${wordId}`);
  return res.data;
}

export async function deleteList(listId) {
  const res = await api.delete(`/lists/${listId}`);
  return res.data;
}

export async function bulkDeleteWords(listId, wordIds) {
  const res = await api.post(`/lists/${listId}/words/bulk-delete`, { wordIds });
  return res.data;
}

export async function moveWords({ fromListId, toListId, wordIds }) {
  const res = await api.post(`/lists/move-words`, { fromListId, toListId, wordIds });
  return res.data;
}
