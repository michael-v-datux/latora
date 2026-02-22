/**
 * purchaseService.js — Apple IAP via RevenueCat
 *
 * Architecture:
 *  - RevenueCat SDK (react-native-purchases) handles StoreKit communication
 *  - All money flows through Apple (70/30 standard split)
 *  - RevenueCat provides receipt validation + purchase status
 *  - On successful purchase, we call our backend to sync subscription_plan in DB
 *
 * Setup checklist (when Apple Developer Console is ready):
 *  1. Set REVENUECAT_API_KEY in .env (EXPO_PUBLIC_REVENUECAT_API_KEY)
 *  2. Create "pro_monthly" and/or "pro_yearly" products in App Store Connect
 *  3. Create an Offering in RevenueCat dashboard with those products
 *  4. Update PRODUCT_IDS below to match actual App Store product IDs
 *  5. Configure RevenueCat webhook → our /api/webhooks/revenuecat endpoint
 *
 * TestFlight notes:
 *  - Use Sandbox Apple ID for testing purchases
 *  - Purchases don't charge real money in TestFlight
 *  - RevenueCat dashboard shows sandbox purchases separately
 */

import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import { api } from './apiClient';

// ─── Config ──────────────────────────────────────────────────────────────────

// RevenueCat API key (iOS only for now)
// Get from: RevenueCat Dashboard → Project → API Keys → Public app-specific key
const REVENUECAT_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY || '';

// Product identifiers — must match App Store Connect product IDs exactly
export const PRODUCT_IDS = {
  PRO_MONTHLY: 'lexilevel_pro_monthly',  // e.g. $4.99/month
  PRO_YEARLY:  'lexilevel_pro_yearly',   // e.g. $29.99/year (save ~50%)
};

// RevenueCat Offering identifier (configured in RC dashboard)
const OFFERING_ID = 'default';

let _initialized = false;

// ─── Initialization ───────────────────────────────────────────────────────────

/**
 * Call once at app startup (e.g. in App.js after user is authenticated).
 * Safe to call multiple times — idempotent.
 *
 * @param {string|null} userId — Supabase user ID (for RevenueCat user linking)
 */
export async function initPurchases(userId = null) {
  if (!REVENUECAT_API_KEY) {
    // No key configured — purchases not available yet (pre-production state)
    console.log('[Purchases] No RevenueCat API key — purchases disabled');
    return false;
  }

  try {
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    Purchases.configure({ apiKey: REVENUECAT_API_KEY });

    // Link purchase history to our Supabase user ID
    // This ensures purchase history survives app reinstalls and device changes
    if (userId) {
      await Purchases.logIn(userId);
    }

    _initialized = true;
    console.log('[Purchases] RevenueCat initialized');
    return true;
  } catch (e) {
    console.warn('[Purchases] Init error:', e?.message);
    return false;
  }
}

// ─── Offerings ───────────────────────────────────────────────────────────────

/**
 * Fetch available packages from RevenueCat (monthly + yearly).
 * Returns null if not configured or network error.
 *
 * @returns {Promise<{monthly: Package|null, yearly: Package|null, raw: Offerings|null}>}
 */
export async function fetchOfferings() {
  if (!_initialized) {
    return { monthly: null, yearly: null, raw: null };
  }

  try {
    const offerings = await Purchases.getOfferings();
    const offering  = offerings.current ?? offerings.all[OFFERING_ID] ?? null;

    if (!offering) {
      return { monthly: null, yearly: null, raw: offerings };
    }

    // Map packages by identifier
    const monthly = offering.availablePackages.find(
      (p) => p.product.identifier === PRODUCT_IDS.PRO_MONTHLY
    ) ?? offering.monthly ?? null;

    const yearly = offering.availablePackages.find(
      (p) => p.product.identifier === PRODUCT_IDS.PRO_YEARLY
    ) ?? offering.annual ?? null;

    return { monthly, yearly, raw: offerings };
  } catch (e) {
    console.warn('[Purchases] fetchOfferings error:', e?.message);
    return { monthly: null, yearly: null, raw: null };
  }
}

// ─── Purchase ─────────────────────────────────────────────────────────────────

/**
 * Initiate a purchase flow for a given package.
 * On success, syncs subscription with our backend.
 *
 * @param {Package} pkg — RevenueCat Package object (from fetchOfferings)
 * @returns {Promise<{ success: boolean, customerInfo?: CustomerInfo, error?: string, cancelled?: boolean }>}
 */
export async function purchasePackage(pkg) {
  if (!_initialized) {
    return { success: false, error: 'Purchases not initialized' };
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);

    // Check entitlements — "pro" must be configured in RevenueCat dashboard
    const isNowPro = !!customerInfo.entitlements.active['pro'];

    if (isNowPro) {
      // Sync with our backend so subscription_plan in DB gets updated
      await syncSubscriptionWithBackend(customerInfo);
    }

    return { success: true, customerInfo, isPro: isNowPro };
  } catch (e) {
    // User cancelled — not an error
    if (e.userCancelled) {
      return { success: false, cancelled: true };
    }
    console.warn('[Purchases] purchasePackage error:', e?.message);
    return { success: false, error: e?.message || 'Purchase failed' };
  }
}

// ─── Restore ─────────────────────────────────────────────────────────────────

/**
 * Restore previous purchases (required by Apple guidelines — must have a button).
 * Also syncs with backend.
 *
 * @returns {Promise<{ success: boolean, isPro: boolean, error?: string }>}
 */
export async function restorePurchases() {
  if (!_initialized) {
    return { success: false, isPro: false, error: 'Purchases not initialized' };
  }

  try {
    const customerInfo = await Purchases.restorePurchases();
    const isNowPro     = !!customerInfo.entitlements.active['pro'];

    if (isNowPro) {
      await syncSubscriptionWithBackend(customerInfo);
    }

    return { success: true, isPro: isNowPro, customerInfo };
  } catch (e) {
    console.warn('[Purchases] restorePurchases error:', e?.message);
    return { success: false, isPro: false, error: e?.message || 'Restore failed' };
  }
}

// ─── Customer Info ────────────────────────────────────────────────────────────

/**
 * Get current customer info (cached, fast).
 * Use this to check current subscription status without a network call.
 *
 * @returns {Promise<{ isPro: boolean, expiresAt: Date|null }>}
 */
export async function getCustomerInfo() {
  if (!_initialized) {
    return { isPro: false, expiresAt: null };
  }

  try {
    const customerInfo = await Purchases.getCustomerInfo();
    const proEntitlement = customerInfo.entitlements.active['pro'];
    const isPro      = !!proEntitlement;
    const expiresAt  = proEntitlement?.expirationDate
      ? new Date(proEntitlement.expirationDate)
      : null;

    return { isPro, expiresAt, customerInfo };
  } catch (e) {
    console.warn('[Purchases] getCustomerInfo error:', e?.message);
    return { isPro: false, expiresAt: null };
  }
}

// ─── Backend sync ─────────────────────────────────────────────────────────────

/**
 * Tell our Express backend to update subscription_plan in the profiles table.
 * Called after successful purchase or restore.
 * Backend verifies with RevenueCat independently (webhook is the primary path,
 * this is the immediate sync so UI updates without waiting for webhook).
 *
 * @param {CustomerInfo} customerInfo — from RevenueCat SDK
 */
async function syncSubscriptionWithBackend(customerInfo) {
  try {
    await api.post('/subscription/sync', {
      rcCustomerInfoJson: JSON.stringify(customerInfo),
    });
  } catch (e) {
    // Non-fatal: webhook will eventually sync anyway
    console.warn('[Purchases] Backend sync error (non-fatal):', e?.message);
  }
}
