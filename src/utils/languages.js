/**
 * src/utils/languages.js
 *
 * UI helpers for language selection.
 * DeepL uses codes like: EN, DE, FR, IT, PL, RO, CS, HU, SV, ET, LV, LT, ES, ES-419.
 */

export const DEFAULT_PAIR = { sourceLang: 'EN', targetLang: 'UK' };

// Curated Europe-first list (no Asian languages as requested)
export const EUROPE_LANGUAGE_ALLOWLIST = new Set([
  'EN',
  'UK',
  'DE',
  'FR',
  'IT',
  'PL',
  'RO',
  'CS',
  'HU',
  'SV',
  'ET',
  'LV',
  'LT',
  'ES', 'ES-419',
  'NL',
  'DA',
  'FI',
  'PT', 'PT-PT', 'PT-BR',
  'SK',
  'SL',
  'BG',
  'EL',
]);

export function normalizeLangCode(code) {
  return String(code || '').trim().toUpperCase();
}

export function langLabel(code) {
  const c = normalizeLangCode(code);
  switch (c) {
    case 'EN':
    case 'EN-US':  // kept for legacy stored values
    case 'EN-GB':  // kept for legacy stored values
      return 'English';
    case 'UK':
      return 'Українська';
    case 'PL':
      return 'Polski';
    case 'IT':
      return 'Italiano';
    case 'FR':
      return 'Français';
    case 'DE':
      return 'Deutsch';
    case 'RO':
      return 'Română';
    case 'CS':
      return 'Čeština';
    case 'HU':
      return 'Magyar';
    case 'ET':
      return 'Eesti';
    case 'LV':
      return 'Latviešu';
    case 'LT':
      return 'Lietuvių';
    case 'SV':
      return 'Svenska';
    case 'ES':
      return 'Español';
    case 'ES-419':
      return 'Español (LatAm)';
    default:
      return c || '—';
  }
}

export function pairLabel(sourceLang, targetLang) {
  return `${normalizeLangCode(sourceLang)} → ${normalizeLangCode(targetLang)}`;
}

export function pairKey(sourceLang, targetLang) {
  return `${normalizeLangCode(sourceLang)}->${normalizeLangCode(targetLang)}`;
}
