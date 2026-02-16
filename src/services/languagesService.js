/**
 * languagesService.js — fetch DeepL supported languages from backend
 */

import { api } from './apiClient';

export async function fetchDeepLLanguages() {
  const res = await api.get('/languages');
  return res.data;
}
