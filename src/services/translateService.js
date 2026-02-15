/**
 * translateService.js — Сервіс перекладу
 * 
 * Відповідає за:
 * - відправку слова на сервер для перекладу (DeepL API)
 * - отримання оцінки складності (Claude AI)
 * - кешування результатів (щоб не перекладати одне слово двічі)
 * 
 * На поточному етапі звертається до нашого бекенд-сервера,
 * який вже обробляє запити до DeepL та Claude.
 */

import axios from 'axios';
import { API_BASE_URL } from '../utils/constants';

/**
 * Перекласти слово з англійської на українську + отримати оцінку складності
 * 
 * @param {string} word — англійське слово або словосполучення
 * @returns {Object} — результат { original, translation, transcription, cefr_level, difficulty_score, example_sentence, part_of_speech }
 * 
 * Приклад:
 *   const result = await translateWord('serendipity');
 *   console.log(result.translation); // "щаслива випадковість"
 *   console.log(result.cefr_level);  // "C1"
 */
export async function translateWord(word) {
  try {
    // Відправляємо POST-запит на наш сервер
    const response = await axios.post(`${API_BASE_URL}/translate`, {
      word: word.trim().toLowerCase(),
    });

    return response.data;
  } catch (error) {
    // Обробляємо різні типи помилок
    if (error.response) {
      // Сервер відповів з помилкою (наприклад, 404, 500)
      throw new Error(error.response.data.error || 'Помилка перекладу');
    } else if (error.request) {
      // Запит було відправлено, але відповіді не отримано (немає інтернету?)
      throw new Error('Немає з\'єднання з сервером. Перевірте інтернет.');
    } else {
      // Щось інше пішло не так
      throw new Error('Невідома помилка: ' + error.message);
    }
  }
}

/**
 * Отримати AI-рекомендацію списку для слова
 * 
 * @param {string} wordId — ID слова
 * @param {string} userId — ID користувача
 * @returns {Object} — { suggested_list_id, suggested_list_name, reason }
 */
export async function suggestList(wordId, userId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/suggest-list`, {
      params: { wordId, userId },
    });
    return response.data;
  } catch (error) {
    // Якщо рекомендація не вдалась — не критично, повертаємо null
    console.warn('Не вдалось отримати рекомендацію списку:', error.message);
    return null;
  }
}
