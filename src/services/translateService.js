/**
 * translateService.js — Сервіс перекладу
 *
 * Відповідає за:
 * - відправку слова на сервер для перекладу (DeepL API)
 * - отримання оцінки складності (Claude AI)
 * - кешування результатів (на сервері, через Supabase)
 */

import { api } from "./apiClient";

/**
 * Перекласти слово з англійської на українську + отримати оцінку складності
 */
export async function translateWord(word, sourceLang = 'EN', targetLang = 'UK') {
  try {
    const response = await api.post("/translate", {
      word: word.trim(),
      source_lang: sourceLang,
      target_lang: targetLang,
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(error.response.data.error || "Помилка перекладу");
    }
    if (error.request) {
      throw new Error("Немає з'єднання з сервером. Перевірте інтернет.");
    }
    throw new Error("Невідома помилка: " + error.message);
  }
}

/**
 * Рекомендація списку для слова (без userId у параметрах — сервер бере його з JWT)
 *
 * @param {string} wordId — ID слова
 * @returns {Object|null} — { suggested_list_id, suggested_list_name, reason }
 */
export async function suggestList(wordId) {
  try {
    const response = await api.get("/suggest-list", {
      params: { wordId },
    });
    return response.data;
  } catch (error) {
    console.warn("Не вдалось отримати рекомендацію списку:", error.message);
    return null;
  }
}


/**
 * Отримати підтримувані мови з бекенду (DeepL /languages)
 * @returns {{source: Array, target: Array}}
 */
export async function fetchLanguages() {
  const res = await api.get("/languages");
  return res.data;
}
