/**
 * server/lib/langUtils.js — Спільні утиліти для нормалізації мовних кодів
 *
 * Використовується в: translate.js, practice.js, profile.js
 */

/**
 * Нормалізує мовний код до верхнього регістру та видаляє пробіли.
 * "en-gb" → "EN-GB"
 */
function normalizeLang(code) {
  return (code || '').trim().toUpperCase();
}

/**
 * Повертає базовий мовний код без регіону.
 * "EN-GB" → "EN", "PT-BR" → "PT", "ES-419" → "ES"
 */
function baseLang(code) {
  return normalizeLang(code).split('-')[0];
}

/**
 * Будує direction-agnostic ключ для мовної пари.
 * normalizePair("EN", "UK") === normalizePair("UK", "EN") === "EN|UK"
 *
 * Завжди: менший код | більший код (лексикографічно), тобто результат
 * не залежить від того, яка мова «джерело», яка «ціль».
 */
function normalizePair(langA, langB) {
  const a = baseLang(langA);
  const b = baseLang(langB);
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

module.exports = { normalizeLang, baseLang, normalizePair };
