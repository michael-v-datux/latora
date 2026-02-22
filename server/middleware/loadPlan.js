/**
 * server/middleware/loadPlan.js — Load subscription plan + AI usage for authenticated user
 *
 * Must run AFTER requireAuth (needs req.user + req.supabase).
 *
 * Attaches to req:
 *   req.plan          — 'free' | 'pro'
 *   req.entitlements  — entitlements object from config/entitlements.js
 *   req.aiUsageToday  — number of AI requests made today (0 if reset needed)
 *   req.aiResetDate   — the stored reset date string (YYYY-MM-DD) or null
 *
 * Usage in a route:
 *   router.post('/something', requireAuth, loadPlan, async (req, res) => {
 *     const { maxLists } = req.entitlements;
 *   });
 */

const { getEntitlements } = require('../config/entitlements');

module.exports = async function loadPlan(req, res, next) {
  try {
    const supabase = req.supabase; // provided by requireAuth

    const { data, error } = await supabase
      .from('profiles')
      .select('subscription_plan, ai_requests_today, ai_reset_date')
      .eq('id', req.user.id)
      .single();

    if (error) {
      // Non-fatal: fall back to free plan defaults
      console.warn(`⚠️ [loadPlan] Could not load profile for ${req.user.id}: ${error.message}`);
    }

    const plan         = data?.subscription_plan || 'free';
    const todayUTC     = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    const resetNeeded  = !data?.ai_reset_date || data.ai_reset_date !== todayUTC;

    req.plan         = plan;
    req.entitlements = getEntitlements(plan);
    req.aiUsageToday = resetNeeded ? 0 : (data?.ai_requests_today ?? 0);
    req.aiResetDate  = data?.ai_reset_date ?? null;

    next();
  } catch (err) {
    // Always continue — limits enforcement should not break the app for infra errors
    console.warn(`⚠️ [loadPlan] Unexpected error: ${err.message}`);
    req.plan         = 'free';
    req.entitlements = getEntitlements('free');
    req.aiUsageToday = 0;
    req.aiResetDate  = null;
    next();
  }
};
