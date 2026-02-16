/**
 * utils/languagePairs.js — утиліти для мов перекладу (DeepL codes)
 */

export const DEFAULT_SOURCE_LANG = 'EN';
export const DEFAULT_TARGET_LANG = 'UK';

export function normalizeLang(code) {
  return (code || '').toString().trim().toUpperCase();
}

export function formatPair(sourceLang, targetLang) {
  const s = normalizeLang(sourceLang);
  const t = normalizeLang(targetLang);
  if (!s || !t) return '';
  return `${s} → ${t}`;
}

// Невеликий словник назв для UI (EN/UK). Для інших мов — fallback на DeepL name або код.
export const LANGUAGE_LABELS = {
  EN: { en: 'English', uk: 'Англійська' },
  'EN-GB': { en: 'English (UK)', uk: 'Англійська (UK)' },
  'EN-US': { en: 'English (US)', uk: 'Англійська (US)' },
  UK: { en: 'Ukrainian', uk: 'Українська' },
  PL: { en: 'Polish', uk: 'Польська' },
  DE: { en: 'German', uk: 'Німецька' },
  FR: { en: 'French', uk: 'Французька' },
  IT: { en: 'Italian', uk: 'Італійська' },
  ES: { en: 'Spanish', uk: 'Іспанська' },
  'ES-419': { en: 'Spanish (LatAm)', uk: 'Іспанська (LatAm)' },
  RO: { en: 'Romanian', uk: 'Румунська' },
  CS: { en: 'Czech', uk: 'Чеська' },
  LT: { en: 'Lithuanian', uk: 'Литовська' },
  LV: { en: 'Latvian', uk: 'Латвійська' },
  HU: { en: 'Hungarian', uk: 'Угорська' },
  ET: { en: 'Estonian', uk: 'Естонська' },
  SV: { en: 'Swedish', uk: 'Шведська' },
};

export function getLanguageLabel(code, uiLocale = 'en', deeplName = null) {
  const c = normalizeLang(code);
  const loc = (uiLocale || 'en').toLowerCase().startsWith('uk') ? 'uk' : 'en';
  return LANGUAGE_LABELS[c]?.[loc] || deeplName || c;
}

export function findDeepLName(list, code) {
  const c = normalizeLang(code);
  const item = (list || []).find((x) => normalizeLang(x.language) === c);
  return item?.name || null;
}
