/**
 * recommendationsService.js — Lexum Recommendations API client
 */

import { api } from './apiClient';

/**
 * Generate vocabulary recommendations.
 * @param {object} params
 * @param {string} params.sourceLang
 * @param {string} params.targetLang
 * @param {string} params.mode - 'auto' | 'controlled'
 * @param {string} [params.intent] - 'focus' | 'expand' | 'explore' (controlled mode)
 * @param {string} [params.difficulty] - 'easier' | 'same' | 'harder' (controlled mode)
 * @param {string} [params.topic] - optional topic hint
 * @param {string} [params.format] - 'words' | 'phrases' | 'mixed'
 * @param {number} [params.count] - how many words to get (1–max)
 */
export async function generateRecommendations(params) {
  const res = await api.post('/recommendations/generate', params);
  return res.data;
}

/**
 * Record user action on a recommendation item.
 * @param {string} itemId - recommendation_items.id
 * @param {'added'|'hidden'|'skipped'} action
 * @param {string} [listId] - required when action === 'added'
 */
export async function recordRecommendationAction(itemId, action, listId = null) {
  const res = await api.post('/recommendations/action', { itemId, action, listId });
  return res.data;
}

/**
 * Get current quota state.
 */
export async function fetchRecQuota() {
  const res = await api.get('/recommendations/quota');
  return res.data;
}
