/**
 * settingsService.js — User settings sync service
 *
 * Strategy:
 * 1. AsyncStorage = instant local cache (always read first)
 * 2. Server = source of truth (fetch on app open, update in background on change)
 *
 * Usage:
 *   const settings = await loadSettings(userId);            // reads cache + syncs from server
 *   await saveSettings(userId, { daily_goal: 10 });         // writes cache + patches server
 *   await deleteAccount();                                  // DELETE /api/account
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './apiClient';

const SETTINGS_KEY = (userId) => `user_settings_${userId}`;

export const DEFAULT_SETTINGS = {
  ui_lang:               null,
  source_lang:           null,
  target_lang:           null,
  difficulty_mode:       null,
  daily_goal:            10,
  reminders_enabled:     false,
  reminder_practice:     false,
  reminder_today:        false,
  translation_direction: 'auto',
};

/**
 * Load settings for a user.
 * Returns cached settings immediately; syncs from server in background.
 * @param {string} userId
 * @returns {Promise<object>} — settings object
 */
export async function loadSettings(userId) {
  if (!userId) return { ...DEFAULT_SETTINGS };

  const key = SETTINGS_KEY(userId);

  // 1. Try local cache first
  let cached = { ...DEFAULT_SETTINGS };
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) cached = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }

  // 2. Fetch from server (non-blocking — update cache in background)
  fetchAndCacheSettings(userId).catch(() => {});

  return cached;
}

/**
 * Fetch settings from server and update local cache.
 * @param {string} userId
 * @returns {Promise<object>} fresh settings
 */
export async function fetchAndCacheSettings(userId) {
  if (!userId) return { ...DEFAULT_SETTINGS };

  try {
    const res = await api.get('/settings');
    const serverSettings = {
      ui_lang:               res.data.ui_lang               ?? null,
      source_lang:           res.data.source_lang           ?? null,
      target_lang:           res.data.target_lang           ?? null,
      difficulty_mode:       res.data.difficulty_mode       ?? null,
      daily_goal:            res.data.daily_goal            ?? 10,
      reminders_enabled:     res.data.reminders_enabled     ?? false,
      reminder_practice:     res.data.reminder_practice     ?? false,
      reminder_today:        res.data.reminder_today        ?? false,
      translation_direction: res.data.translation_direction ?? 'auto',
    };

    // Update cache
    await AsyncStorage.setItem(SETTINGS_KEY(userId), JSON.stringify(serverSettings));
    return serverSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings for a user (writes cache + patches server).
 * @param {string} userId
 * @param {object} updates — partial settings to update
 * @returns {Promise<object>} updated settings
 */
export async function saveSettings(userId, updates) {
  if (!userId) return { ...DEFAULT_SETTINGS };

  const key = SETTINGS_KEY(userId);

  // 1. Read current cached settings
  let current = { ...DEFAULT_SETTINGS };
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) current = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}

  // 2. Merge updates
  const merged = { ...current, ...updates };

  // 3. Write to cache immediately (optimistic)
  try {
    await AsyncStorage.setItem(key, JSON.stringify(merged));
  } catch {}

  // 4. Patch server (fire-and-forget)
  api.patch('/settings', updates).catch((e) => {
    console.warn('[settingsService] Failed to sync settings to server:', e?.message);
  });

  return merged;
}

/**
 * Clear settings cache for a user (call on sign-out).
 * @param {string} userId
 */
export async function clearSettingsCache(userId) {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(SETTINGS_KEY(userId));
  } catch {}
}

/**
 * Delete the current user's account and all associated data.
 * Calls DELETE /api/account — server handles data cleanup + auth.admin.deleteUser().
 * @returns {Promise<void>}
 * @throws if server returns an error
 */
export async function deleteAccount() {
  const res = await api.delete('/account');
  return res.data;
}
