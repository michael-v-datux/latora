/**
 * server/routes/subscription.js — Subscription management routes
 *
 * POST /api/subscription/sync       — Immediate post-purchase sync (called by mobile after RC purchase)
 * POST /api/webhooks/revenuecat     — RevenueCat webhook (subscription lifecycle events)
 *
 * Architecture:
 *  - Primary path: RevenueCat webhook → /api/webhooks/revenuecat (reliable, async)
 *  - Immediate path: mobile → /api/subscription/sync after purchase (fast UI update)
 *  - Both paths update profiles.subscription_plan in DB
 *
 * RevenueCat webhook setup:
 *  1. RevenueCat Dashboard → Project → Integrations → Webhooks
 *  2. Add endpoint: https://your-server.com/api/webhooks/revenuecat
 *  3. Set REVENUECAT_WEBHOOK_AUTH_HEADER in .env to the Authorization value RC sends
 *
 * RevenueCat webhook docs: https://docs.revenuecat.com/docs/webhooks
 */

const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');
const requireAuth = require('../middleware/requireAuth');

// ─── Supabase service-role client (bypasses RLS for subscription updates) ────
// Service role is needed because webhooks don't have a user JWT.
const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RC_WEBHOOK_AUTH       = process.env.REVENUECAT_WEBHOOK_AUTH_HEADER || '';

function getServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Helper: determine plan from RC customerInfo entitlements ──────────────────

/**
 * Given a RevenueCat customerInfo object (from SDK or webhook event.subscriber),
 * return the subscription plan string for our DB.
 *
 * @param {object} subscriber — customerInfo or event.subscriber from RC
 * @returns {'pro' | 'free'}
 */
function planFromSubscriber(subscriber) {
  if (!subscriber) return 'free';
  // Check active entitlements
  const entitlements = subscriber.entitlements || {};
  const proEnt = entitlements.active?.pro || entitlements.pro;
  if (proEnt && proEnt.expires_date) {
    const expiresAt = new Date(proEnt.expires_date);
    if (expiresAt > new Date()) return 'pro';
  }
  return 'free';
}

// ─── POST /api/subscription/sync ─────────────────────────────────────────────
// Called immediately after successful purchase by the mobile app.
// The mobile sends the full customerInfo JSON for us to inspect.
// We verify via RC's entitlements structure (no additional API call needed).

router.post('/subscription/sync', requireAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { rcCustomerInfoJson } = req.body;

    if (!rcCustomerInfoJson || typeof rcCustomerInfoJson !== 'string') {
      return res.status(400).json({ error: 'rcCustomerInfoJson is required' });
    }

    let customerInfo;
    try {
      customerInfo = JSON.parse(rcCustomerInfoJson);
    } catch {
      return res.status(400).json({ error: 'rcCustomerInfoJson is not valid JSON' });
    }

    const plan = planFromSubscriber(customerInfo);

    const supabase = getServiceClient();
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, subscription_plan: plan }, { onConflict: 'id' });

    if (error) throw error;

    console.log(`[Subscription] Synced user ${userId} → ${plan}`);
    return res.json({ ok: true, plan });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/webhooks/revenuecat ───────────────────────────────────────────
// RevenueCat sends webhook events for all subscription lifecycle events:
//   INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION, BILLING_ISSUE, etc.
//
// We update subscription_plan in DB based on the event type and entitlement status.
// This is the primary/reliable sync path — it runs even if the mobile app is offline.

router.post('/webhooks/revenuecat', async (req, res, next) => {
  try {
    // ── Authorization check ──────────────────────────────────────────────────
    // RevenueCat sends a configurable Authorization header.
    // If not configured, we skip the check (dev mode).
    if (RC_WEBHOOK_AUTH) {
      const authHeader = req.headers.authorization || '';
      if (authHeader !== RC_WEBHOOK_AUTH) {
        console.warn('[RC Webhook] Unauthorized request rejected');
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const event = req.body;

    if (!event || !event.event) {
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    const eventType  = event.event.type;
    const appUserId  = event.event.app_user_id; // This is our Supabase user ID (set via RC.logIn)
    const subscriber = event.event.subscriber;

    if (!appUserId) {
      console.warn(`[RC Webhook] Event ${eventType} has no app_user_id — skipping`);
      return res.json({ ok: true, skipped: true });
    }

    // ── Determine new plan from event type ───────────────────────────────────
    let plan;

    // Events that indicate an active Pro subscription
    const PRO_EVENTS = new Set([
      'INITIAL_PURCHASE',
      'RENEWAL',
      'PRODUCT_CHANGE',
      'TRANSFER',
      'SUBSCRIBER_ALIAS',
    ]);

    // Events that indicate Pro has ended
    const FREE_EVENTS = new Set([
      'CANCELLATION',
      'EXPIRATION',
      'BILLING_ISSUE',
      'SUBSCRIPTION_PAUSED',
    ]);

    if (PRO_EVENTS.has(eventType)) {
      // Double-check via entitlements in subscriber object
      plan = planFromSubscriber(subscriber);
    } else if (FREE_EVENTS.has(eventType)) {
      plan = 'free';
    } else {
      // Unknown event type — inspect entitlements
      plan = planFromSubscriber(subscriber);
    }

    // ── Update DB ────────────────────────────────────────────────────────────
    const supabase = getServiceClient();
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: appUserId, subscription_plan: plan }, { onConflict: 'id' });

    if (error) throw error;

    console.log(`[RC Webhook] ${eventType} → user ${appUserId} → ${plan}`);
    return res.json({ ok: true, plan });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
