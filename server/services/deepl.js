/**
 * server/services/deepl.js — Сервіс перекладу через DeepL API
 * 
 * DeepL — один з найточніших сервісів перекладу,
 * особливо для європейських мов (включно з українською).
 * 
 * Free план: 500,000 символів/місяць безкоштовно.
 */

const axios = require('axios');

// DeepL API URL (для Free плану використовується api-free)
const DEEPL_TRANSLATE_URL = 'https://api-free.deepl.com/v2/translate';
const DEEPL_LANGUAGES_URL = 'https://api-free.deepl.com/v2/languages';

// In-memory cache for language lists (avoid hitting DeepL too often)
const _languagesCache = {
  source: { ts: 0, data: null },
  target: { ts: 0, data: null },
};

const LANG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function getApiKey() {
  const apiKey = (process.env.DEEPL_API_KEY || "").trim();
  console.log("DEEPL key present:", !!apiKey, "len:", apiKey.length, "suffix:", apiKey.slice(-3));
  if (!apiKey) {
    throw new Error('DEEPL_API_KEY не налаштовано в .env файлі');
  }
  return apiKey;
}

/**
 * Перекласти текст з англійської на українську
 * 
 * @param {string} text — текст для перекладу
 * @returns {Object} — { translation, detectedLanguage }
 */
async function translateText(text, { sourceLang = 'EN', targetLang = 'UK' } = {}) {
  const apiKey = getApiKey();

  try {
    const form = new URLSearchParams();
    form.append("text", text);
    if (sourceLang) form.append("source_lang", String(sourceLang).toUpperCase());
    form.append("target_lang", String(targetLang).toUpperCase());

    const response = await axios.post(DEEPL_TRANSLATE_URL, form, {
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 15000,
    });

    const result = response.data.translations[0];

    return {
      translation: result.text,
      detectedLanguage: result.detected_source_language,
    };
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error('Невірний DeepL API-ключ. Перевірте .env файл.');
    }
    if (error.response?.status === 456) {
      throw new Error('Вичерпано ліміт DeepL. Зачекайте до наступного місяця або оновіть план.');
    }
    throw new Error('Помилка DeepL API: ' + (error.response?.data?.message || error.message));
  }
}

/**
 * Отримати список підтримуваних мов DeepL
 * @param {'source'|'target'} type
 */
async function getLanguages(type = 'target') {
  const apiKey = getApiKey();
  const key = type === 'source' ? 'source' : 'target';

  const now = Date.now();
  const cached = _languagesCache[key];
  if (cached.data && now - cached.ts < LANG_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await axios.get(DEEPL_LANGUAGES_URL, {
      params: { type: key },
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
      },
      timeout: 15000,
    });

    const data = Array.isArray(response.data) ? response.data : [];
    _languagesCache[key] = { ts: now, data };
    return data;
  } catch (error) {
    if (error.response?.status === 403) {
      throw new Error('Невірний DeepL API-ключ. Перевірте .env файл.');
    }
    throw new Error('Помилка DeepL Languages API: ' + (error.response?.data?.message || error.message));
  }
}

module.exports = { translateText, getLanguages };
