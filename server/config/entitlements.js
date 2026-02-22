/**
 * server/config/entitlements.js — Centralized Free/Pro entitlements map
 *
 * Single source of truth for all subscription plan limits.
 * Used by routes to enforce limits server-side (tamper-proof).
 *
 * To add a new limit:
 *   1. Add the key here in both 'free' and 'pro'
 *   2. Use getEntitlements(plan).yourKey in the route
 *   3. No client-side enforcement needed — app just shows remaining quota
 */

const ENTITLEMENTS = {
  free: {
    // Lists & words
    maxLists:            3,       // max number of word lists
    maxTotalWords:       200,     // max total words across all lists
    maxSavesPerDay:      10,      // max words added to lists per day (UTC reset)

    // AI usage
    maxAiPerDay:         5,       // max translate calls per day (DeepL + Claude)
    maxAltCount:         3,       // max alternatives shown per translation

    // Input limits
    inputLimits:         { words: 6, chars: 80 },

    // Practice
    maxPracticeSessions: 3,       // max completed practice sessions per day

    // Features (boolean flags)
    analyticsLevel:      'basic', // 'basic' | 'full'
    srsMode:             'basic', // 'basic' | 'advanced'
    listFilters:         false,   // CEFR/state/due-only filters in list detail
  },

  pro: {
    // Lists & words
    maxLists:            50,
    maxTotalWords:       10000,
    maxSavesPerDay:      150,

    // AI usage
    maxAiPerDay:         200,
    maxAltCount:         7,

    // Input limits
    inputLimits:         { words: 8, chars: 120 },

    // Practice
    maxPracticeSessions: Infinity,

    // Features
    analyticsLevel:      'full',
    srsMode:             'advanced',
    listFilters:         true,
  },
};

/**
 * Returns the entitlements object for a given plan.
 * Defaults to 'free' for unknown/missing plans.
 */
function getEntitlements(plan) {
  return ENTITLEMENTS[plan] ?? ENTITLEMENTS.free;
}

module.exports = { ENTITLEMENTS, getEntitlements };
