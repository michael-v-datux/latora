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
const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

/**
 * Перекласти текст з англійської на українську
 * 
 * @param {string} text — текст для перекладу
 * @returns {Object} — { translation, detectedLanguage }
 */
async function translateText(text) {
  const apiKey = (process.env.DEEPL_API_KEY || "").trim();
  console.log("DEEPL key present:", !!apiKey, "len:", apiKey.length, "suffix:", apiKey.slice(-3));
  
  if (!apiKey) {
    throw new Error('DEEPL_API_KEY не налаштовано в .env файлі');
  }

    try {
      const form = new URLSearchParams();
      form.append("text", text);
      form.append("source_lang", "EN");
      form.append("target_lang", "UK");

      const response = await axios.post(DEEPL_API_URL, form, {
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

module.exports = { translateText };
