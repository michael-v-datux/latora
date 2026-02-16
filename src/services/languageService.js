/**
 * languageService.js — список мов перекладу (DeepL) + кеш
 *
 * UI (i18n) і Translation Languages (DeepL) — це різні речі.
 * Тут тільки про мови перекладу.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './apiClient';

const CACHE_KEY = 'DEEPL_LANGUAGES_CACHE_V1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function fetchTranslationLanguages({ force = false } = {}) {
  try {
    if (!force) {
      const raw = await AsyncStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.ts && Date.now() - cached.ts < CACHE_TTL_MS && cached?.data) {
          return cached.data;
        }
      }
    }

    const res = await api.get('/languages');
    const data = res.data;

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
    return data;
  } catch (e) {
    // fallback to stale cache if exists
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (raw) {
      try {
        const cached = JSON.parse(raw);
        if (cached?.data) return cached.data;
      } catch {}
    }
    throw e;
  }
}
