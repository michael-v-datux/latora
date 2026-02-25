/**
 * analytics.js — Centralized analytics module
 *
 * Wraps two services:
 *   Sentry      — crash / error reporting
 *   PostHog     — product analytics & event tracking
 *
 * Usage:
 *   1. Call initSentry() and initPostHog() once at app startup (App.js module level)
 *   2. Call identifyUser(user) after login, clearUser() after logout (useAuth.js)
 *   3. Call trackEvent(Events.XYZ, { ...props }) on key user actions
 *   4. Screen tracking happens automatically via NavigationContainer.onStateChange
 *
 * Note: Both services are DISABLED in __DEV__ by default to keep data clean.
 * Set ANALYTICS_IN_DEV=true in .env to enable during development.
 */

import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';

const SENTRY_DSN  = process.env.EXPO_PUBLIC_SENTRY_DSN;
const PH_API_KEY  = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const PH_HOST     = process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';

// Disable in development to keep analytics data clean.
// Override by setting EXPO_PUBLIC_ANALYTICS_IN_DEV=true in .env.
const ANALYTICS_ENABLED = !__DEV__ || process.env.EXPO_PUBLIC_ANALYTICS_IN_DEV === 'true';

let _posthog = null;

// ─── Init ──────────────────────────────────────────────────────────────────────

export function initSentry() {
  if (!SENTRY_DSN) return;
  Sentry.init({
    dsn:              SENTRY_DSN,
    enabled:          ANALYTICS_ENABLED,
    tracesSampleRate: 0,           // disable perf tracing — error reporting only
    environment:      __DEV__ ? 'development' : 'production',
    attachStacktrace: true,
  });
}

export function initPostHog() {
  if (!PH_API_KEY) return;
  _posthog = new PostHog(PH_API_KEY, {
    host:     PH_HOST,
    disabled: !ANALYTICS_ENABLED,
  });
}

// ─── Event names ───────────────────────────────────────────────────────────────

export const Events = {
  // Auth
  AUTH_SIGNIN:                'auth_signin',
  AUTH_SIGNUP:                'auth_signup',

  // Core translate flow
  WORD_TRANSLATED:            'word_translated',  // { lang_pair, is_phrase }
  WORD_SAVED_TO_LIST:         'word_saved_to_list', // { lang_pair, source }

  // Lists
  LIST_CREATED:               'list_created',

  // Practice
  PRACTICE_SESSION_COMPLETED: 'practice_session_completed', // { word_count, score_pct }

  // Recommendations
  RECOMMENDATION_GENERATED:   'recommendation_generated',  // { strategy, count, mode }
  RECOMMENDATION_WORD_ADDED:  'recommendation_word_added', // { lang_pair }

  // Monetisation
  PRO_SCREEN_VIEWED:          'pro_screen_viewed',          // { source? }
  SUBSCRIPTION_CONVERTED:     'subscription_converted',     // { product_id, plan }
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Track a product analytics event.
 * Safe to call even before initPostHog() — silently no-ops.
 */
export function trackEvent(name, props = {}) {
  try { _posthog?.capture(name, props); } catch {}
}

/**
 * Track a screen view. Called automatically via NavigationContainer.onStateChange.
 * Also adds a Sentry breadcrumb for crash context.
 */
export function trackScreen(name) {
  if (!name) return;
  try {
    _posthog?.screen(name);
    Sentry.addBreadcrumb({ category: 'navigation', message: name, level: 'info' });
  } catch {}
}

/**
 * Identify the logged-in user in both Sentry and PostHog.
 * Call after a successful login / on app resume with existing session.
 */
export function identifyUser(user) {
  if (!user?.id) return;
  try {
    Sentry.setUser({ id: user.id, email: user.email });
    _posthog?.identify(user.id, { email: user.email });
  } catch {}
}

/**
 * Clear user identity. Call on logout.
 */
export function clearUser() {
  try {
    Sentry.setUser(null);
    _posthog?.reset();
  } catch {}
}

/**
 * Capture an error in Sentry with optional extra context.
 * For unexpected errors that don't crash the app (e.g. API failures).
 */
export function captureError(error, context = {}) {
  try { Sentry.captureException(error, { extra: context }); } catch {}
}
