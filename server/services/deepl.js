/**
 * server/services/deepl.js — Сервіс перекладу через DeepL API
 *
 * Підтримує:
 * - Переклад довільних пар мов (source_lang → target_lang)
 * - Отримання списку підтримуваних мов (source/target)
 * - In-memory кеш списку мов, щоб не бити DeepL зайвий раз
 *
 * Free план: 500,000 символів/місяць безкоштовно.
 */

const axios = require('axios');

// DeepL API URL (для Free плану використовується api-free)
const DEEPL_API_BASE = 'https://api-free.deepl.com/v2';
const DEEPL_TRANSLATE_URL = `${DEEPL_API_BASE}/translate`;
const DEEPL_LANGUAGES_URL = `${DEEPL_API_BASE}/languages`;

// Простий in-memory кеш мов (на бекенді)
const languagesCache = {
  source: { at: 0, data: null },
  target: { at: 0, data: null },
};
const LANG_CACHE_TTL_MS = 72 * 60 * 60 * 1000; // 72h

function getApiKey() {
  const apiKey = (process.env.DEEPL_API_KEY || "").trim();
  console.log("DEEPL key present:", !!apiKey, "len:", apiKey.length, "suffix:", apiKey.slice(-3));
  if (!apiKey) throw new Error('DEEPL_API_KEY не налаштовано в .env файлі');
  return apiKey;
}

function normalizeLang(code) {
  return (code || "").trim().toUpperCase();
}

/**
 * Перекласти текст
 *
 * @param {string} text
 * @param {string} sourceLang — наприклад EN, DE, FR (для source зазвичай без регіонів)
 * @param {string} targetLang — наприклад UK, PL, EN-GB, ES-419
 */
async function translateText(text, sourceLang = "EN", targetLang = "UK") {
  const apiKey = getApiKey();

  const src = normalizeLang(sourceLang) || "EN";
  const tgt = normalizeLang(targetLang) || "UK";

  try {
    const form = new URLSearchParams();
    form.append("text", text);
    form.append("source_lang", src);
    form.append("target_lang", tgt);

    const response = await axios.post(DEEPL_TRANSLATE_URL, form, {
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 25000,
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
      throw new Error('Перевищено ліміт DeepL (free). Спробуйте пізніше або перевірте тариф.');
    }
    if (error.code === "ECONNABORTED") {
      throw new Error('DeepL не відповідає (timeout). Спробуйте ще раз.');
    }
    throw new Error(`DeepL error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Отримати список мов від DeepL
 *
 * @param {"source"|"target"} type
 * @returns {Promise<Array<{language: string, name: string}>>}
 */
async function getLanguages(type = "target") {
  const apiKey = getApiKey();
  const t = (type === "source") ? "source" : "target";

  const cached = languagesCache[t];
  const now = Date.now();
  if (cached.data && (now - cached.at) < LANG_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const response = await axios.get(DEEPL_LANGUAGES_URL, {
      params: { type: t },
      headers: { "Authorization": `DeepL-Auth-Key ${apiKey}` },
      timeout: 25000,
    });

    const data = Array.isArray(response.data) ? response.data : [];
    languagesCache[t] = { at: now, data };
    return data;
  } catch (error) {
    // Якщо DeepL тимчасово недоступний — повертаємо кеш (навіть якщо прострочений),
    // або fallback список (щоб UI не ламався).
    if (cached.data) {
      return cached.data;
    }

    const FALLBACK = {
      source: [
        { language: 'EN', name: 'English' },
        { language: 'UK', name: 'Ukrainian' },
        { language: 'PL', name: 'Polish' },
        { language: 'DE', name: 'German' },
        { language: 'FR', name: 'French' },
        { language: 'IT', name: 'Italian' },
        { language: 'ES', name: 'Spanish' },
        { language: 'RO', name: 'Romanian' },
        { language: 'CS', name: 'Czech' },
        { language: 'HU', name: 'Hungarian' },
        { language: 'SV', name: 'Swedish' },
        { language: 'ET', name: 'Estonian' },
        { language: 'LV', name: 'Latvian' },
        { language: 'LT', name: 'Lithuanian' },
      ],
      target: [
        { language: 'EN', name: 'English' },
        { language: 'EN-GB', name: 'English (UK)' },
        { language: 'EN-US', name: 'English (US)' },
        { language: 'UK', name: 'Ukrainian' },
        { language: 'PL', name: 'Polish' },
        { language: 'DE', name: 'German' },
        { language: 'FR', name: 'French' },
        { language: 'IT', name: 'Italian' },
        { language: 'ES', name: 'Spanish' },
        { language: 'ES-419', name: 'Spanish (LatAm)' },
        { language: 'RO', name: 'Romanian' },
        { language: 'CS', name: 'Czech' },
        { language: 'HU', name: 'Hungarian' },
        { language: 'SV', name: 'Swedish' },
        { language: 'ET', name: 'Estonian' },
        { language: 'LV', name: 'Latvian' },
        { language: 'LT', name: 'Lithuanian' },
      ],
    };

    return FALLBACK[t];
  }
}

module.exports = {
  translateText,
  getLanguages,
};
