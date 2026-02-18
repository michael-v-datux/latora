/**
 * src/config/languages.js
 *
 * Конфіг мов інтерфейсу додатку.
 *
 * status:
 *   'available' — повністю перекладено, можна вибрати
 *   'planned'   — ще не готово, показується як "Незабаром"
 *
 * Щоб увімкнути нову мову — змінити status на 'available'
 * і додати відповідний словник у src/i18n/locales/
 */

export const APP_LANGUAGES = [
  // ─── Available ───────────────────────────────────────────
  { code: "uk", flag: "🇺🇦", label: "Українська",  status: "available" },
  { code: "en", flag: "🇬🇧", label: "English",      status: "available" },

  // ─── Planned (feature-flagged) ────────────────────────────
  { code: "de", flag: "🇩🇪", label: "Deutsch",      status: "planned" },
  { code: "fr", flag: "🇫🇷", label: "Français",     status: "planned" },
  { code: "es", flag: "🇪🇸", label: "Español",      status: "planned" },
  { code: "it", flag: "🇮🇹", label: "Italiano",     status: "planned" },
  { code: "pl", flag: "🇵🇱", label: "Polski",       status: "planned" },
  { code: "nl", flag: "🇳🇱", label: "Nederlands",   status: "planned" },
  { code: "sv", flag: "🇸🇪", label: "Svenska",      status: "planned" },
  { code: "cs", flag: "🇨🇿", label: "Čeština",      status: "planned" },
  { code: "ro", flag: "🇷🇴", label: "Română",       status: "planned" },
  { code: "pt", flag: "🇵🇹", label: "Português",    status: "planned" },
  { code: "el", flag: "🇬🇷", label: "Ελληνικά",     status: "planned" },
  { code: "hu", flag: "🇭🇺", label: "Magyar",       status: "planned" },
];

export const AVAILABLE_LANGUAGES = APP_LANGUAGES.filter(l => l.status === "available");
export const PLANNED_LANGUAGES   = APP_LANGUAGES.filter(l => l.status === "planned");
