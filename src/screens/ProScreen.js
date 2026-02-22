/**
 * ProScreen.js — Paywall / Subscription upgrade screen
 *
 * Opened via: ProfileScreen → ProScreen (stack navigation)
 * Also opened from any "Unlock Pro" CTA button in the app.
 *
 * States:
 *  - loading: fetching offerings from RevenueCat
 *  - ready:   shows plan cards + purchase buttons
 *  - purchasing: spinner during Apple payment sheet
 *  - no_key: RevenueCat not configured yet (dev/pre-prod state) — shows info screen
 *
 * Apple IAP notes:
 *  - Prices shown are fetched live from App Store (localized automatically)
 *  - "Restore purchases" button is required by Apple Review Guidelines
 *  - TestFlight uses Sandbox — purchases don't charge real money
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { COLORS, BORDER_RADIUS, SPACING } from '../utils/constants';
import {
  fetchOfferings,
  purchasePackage,
  restorePurchases,
} from '../services/purchaseService';

// ─── Feature list (what Pro includes) ────────────────────────────────────────

const PRO_FEATURES = [
  {
    icon: 'layers-outline',
    titleKey: 'pro.feature_alts_title',
    descKey:  'pro.feature_alts_desc',
  },
  {
    icon: 'save-outline',
    titleKey: 'pro.feature_saves_title',
    descKey:  'pro.feature_saves_desc',
  },
  {
    icon: 'flash-outline',
    titleKey: 'pro.feature_ai_title',
    descKey:  'pro.feature_ai_desc',
  },
  {
    icon: 'folder-outline',
    titleKey: 'pro.feature_lists_title',
    descKey:  'pro.feature_lists_desc',
  },
  {
    icon: 'fitness-outline',
    titleKey: 'pro.feature_practice_title',
    descKey:  'pro.feature_practice_desc',
  },
  {
    icon: 'filter-outline',
    titleKey: 'pro.feature_filters_title',
    descKey:  'pro.feature_filters_desc',
  },
  {
    icon: 'analytics-outline',
    titleKey: 'pro.feature_analytics_title',
    descKey:  'pro.feature_analytics_desc',
  },
  {
    icon: 'shield-checkmark-outline',
    titleKey: 'pro.feature_difficulty_title',
    descKey:  'pro.feature_difficulty_desc',
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function FeatureRow({ icon, title, desc }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.featureIconWrap}>
        <Ionicons name={icon} size={20} color="#ca8a04" />
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{desc}</Text>
      </View>
    </View>
  );
}

function PlanCard({ pkg, selected, onSelect, t, badge }) {
  if (!pkg) return null;

  const price   = pkg.product.priceString;
  const period  = pkg.product.identifier.includes('yearly') ? t('pro.per_year') : t('pro.per_month');
  const isYearly = pkg.product.identifier.includes('yearly');

  return (
    <TouchableOpacity
      style={[styles.planCard, selected && styles.planCardSelected]}
      onPress={onSelect}
      activeOpacity={0.85}
    >
      {/* Popular badge */}
      {badge ? (
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>{badge}</Text>
        </View>
      ) : null}

      <View style={styles.planCardInner}>
        {/* Radio indicator */}
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected && <View style={styles.radioDot} />}
        </View>

        <View style={styles.planInfo}>
          <Text style={styles.planPeriodLabel}>
            {isYearly ? t('pro.plan_yearly') : t('pro.plan_monthly')}
          </Text>
          <View style={styles.planPriceRow}>
            <Text style={styles.planPrice}>{price}</Text>
            <Text style={styles.planPricePer}> / {period}</Text>
          </View>
          {isYearly && (
            <Text style={styles.planSavings}>{t('pro.yearly_savings')}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── No-key placeholder (pre-production) ─────────────────────────────────────

function NoKeyPlaceholder({ t, onBack }) {
  return (
    <View style={styles.noKeyWrap}>
      <Ionicons name="construct-outline" size={48} color={COLORS.textMuted} />
      <Text style={styles.noKeyTitle}>{t('pro.coming_soon_title')}</Text>
      <Text style={styles.noKeyDesc}>{t('pro.coming_soon_desc')}</Text>
      <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.backBtnText}>{t('pro.go_back')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ProScreen({ navigation }) {
  const { t } = useI18n();

  const [offerings, setOfferings]       = useState({ monthly: null, yearly: null });
  const [selectedPkg, setSelectedPkg]   = useState(null); // 'monthly' | 'yearly'
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [purchasing, setPurchasing]     = useState(false);
  const [restoring, setRestoring]       = useState(false);
  const [noKey, setNoKey]               = useState(false);

  // ── Load offerings ──────────────────────────────────────────────────────────
  const loadOfferings = useCallback(async () => {
    setLoadingOffers(true);
    try {
      const result = await fetchOfferings();

      // No RevenueCat key configured yet
      if (!result.monthly && !result.yearly && !result.raw) {
        setNoKey(true);
        return;
      }

      setOfferings(result);
      // Default: select yearly if available (better value)
      if (result.yearly) setSelectedPkg('yearly');
      else if (result.monthly) setSelectedPkg('monthly');
    } catch {
      setNoKey(true);
    } finally {
      setLoadingOffers(false);
    }
  }, []);

  useEffect(() => {
    loadOfferings();
  }, [loadOfferings]);

  // ── Purchase ────────────────────────────────────────────────────────────────
  const handlePurchase = useCallback(async () => {
    const pkg = selectedPkg === 'yearly' ? offerings.yearly : offerings.monthly;
    if (!pkg || purchasing) return;

    setPurchasing(true);
    try {
      const result = await purchasePackage(pkg);

      if (result.cancelled) {
        // User dismissed Apple payment sheet — do nothing
        return;
      }

      if (result.success && result.isPro) {
        // Success — navigate back and let ProfileScreen refresh
        Alert.alert(
          t('pro.success_title'),
          t('pro.success_body'),
          [{ text: t('common.done'), onPress: () => navigation.goBack() }]
        );
      } else if (!result.success) {
        Alert.alert(t('pro.error_title'), result.error || t('pro.error_body'));
      }
    } finally {
      setPurchasing(false);
    }
  }, [selectedPkg, offerings, purchasing, navigation, t]);

  // ── Restore ─────────────────────────────────────────────────────────────────
  const handleRestore = useCallback(async () => {
    if (restoring) return;
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result.isPro) {
        Alert.alert(
          t('pro.restore_success_title'),
          t('pro.restore_success_body'),
          [{ text: t('common.done'), onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert(t('pro.restore_none_title'), t('pro.restore_none_body'));
      }
    } finally {
      setRestoring(false);
    }
  }, [restoring, navigation, t]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={12}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('pro.screen_title')}</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>⭐ Lexum Pro</Text>
          </View>
          <Text style={styles.heroTitle}>{t('pro.hero_title')}</Text>
          <Text style={styles.heroSubtitle}>{t('pro.hero_subtitle')}</Text>
        </View>

        {/* ── Feature list ── */}
        <View style={styles.featuresCard}>
          <Text style={styles.featuresHeader}>{t('pro.features_title')}</Text>
          {PRO_FEATURES.map((f) => (
            <FeatureRow
              key={f.titleKey}
              icon={f.icon}
              title={t(f.titleKey)}
              desc={t(f.descKey)}
            />
          ))}
        </View>

        {/* ── Plan selector or loading ── */}
        {noKey ? (
          <NoKeyPlaceholder t={t} onBack={() => navigation.goBack()} />
        ) : loadingOffers ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={COLORS.primary} />
            <Text style={styles.loadingText}>{t('pro.loading_plans')}</Text>
          </View>
        ) : (
          <>
            <View style={styles.plansSection}>
              <Text style={styles.plansSectionTitle}>{t('pro.choose_plan')}</Text>

              <PlanCard
                pkg={offerings.yearly}
                selected={selectedPkg === 'yearly'}
                onSelect={() => setSelectedPkg('yearly')}
                t={t}
                badge={t('pro.badge_popular')}
              />
              <PlanCard
                pkg={offerings.monthly}
                selected={selectedPkg === 'monthly'}
                onSelect={() => setSelectedPkg('monthly')}
                t={t}
                badge={null}
              />
            </View>

            {/* ── CTA Button ── */}
            <TouchableOpacity
              style={[styles.ctaButton, (!selectedPkg || purchasing) && styles.ctaButtonDisabled]}
              onPress={handlePurchase}
              disabled={!selectedPkg || purchasing}
              activeOpacity={0.85}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>{t('pro.cta_button')}</Text>
              )}
            </TouchableOpacity>

            {/* Legal / disclaimer */}
            <Text style={styles.legal}>{t('pro.legal')}</Text>

            {/* Restore purchases — required by Apple */}
            <TouchableOpacity
              style={styles.restoreBtn}
              onPress={handleRestore}
              disabled={restoring}
              activeOpacity={0.7}
            >
              {restoring ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} />
              ) : (
                <Text style={styles.restoreText}>{t('pro.restore_purchases')}</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const GOLD = '#ca8a04';
const GOLD_BG = '#fefce8';
const GOLD_BORDER = '#fde68a';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BORDER_RADIUS.sm,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.primary,
  },
  headerRight: {
    width: 36,
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 48,
  },

  // ── Hero ──
  hero: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
  },
  heroBadge: {
    backgroundColor: GOLD_BG,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    marginBottom: SPACING.md,
  },
  heroBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: GOLD,
    letterSpacing: 0.3,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.primary,
    textAlign: 'center',
    lineHeight: 32,
    marginBottom: SPACING.sm,
  },
  heroSubtitle: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },

  // ── Features ──
  featuresCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
  },
  featuresHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  featureIconWrap: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: GOLD_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // ── Plans ──
  plansSection: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  plansSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },
  planCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    position: 'relative',
  },
  planCardSelected: {
    borderColor: GOLD,
    backgroundColor: GOLD_BG,
  },
  planBadge: {
    position: 'absolute',
    top: -10,
    right: SPACING.lg,
    backgroundColor: GOLD,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  planBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  planCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    flexShrink: 0,
  },
  radioSelected: {
    borderColor: GOLD,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  planInfo: {
    flex: 1,
  },
  planPeriodLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  planPriceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  planPrice: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
  },
  planPricePer: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  planSavings: {
    fontSize: 12,
    fontWeight: '600',
    color: '#16a34a',
    marginTop: 2,
  },

  // ── CTA ──
  ctaButton: {
    marginHorizontal: SPACING.lg,
    backgroundColor: GOLD,
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonDisabled: {
    opacity: 0.6,
    shadowOpacity: 0,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.2,
  },

  // ── Legal + Restore ──
  legal: {
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 16,
    marginHorizontal: SPACING.xl,
    marginTop: SPACING.md,
  },
  restoreBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    marginTop: SPACING.xs,
  },
  restoreText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    textDecorationLine: 'underline',
  },

  // ── Loading ──
  loadingWrap: {
    alignItems: 'center',
    padding: SPACING.xl,
    gap: SPACING.sm,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
  },

  // ── No Key / Coming Soon ──
  noKeyWrap: {
    alignItems: 'center',
    marginHorizontal: SPACING.xl,
    marginVertical: SPACING.xl,
    padding: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.md,
  },
  noKeyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
    textAlign: 'center',
  },
  noKeyDesc: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  backBtn: {
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
  },
  backBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
});
