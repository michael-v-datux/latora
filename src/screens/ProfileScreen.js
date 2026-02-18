/**
 * ProfileScreen.js — Екран профілю
 *
 * Секції (зверху вниз):
 *  1. Plan badge (Free / Pro) — з БД
 *  2. Картка профілю (аватар, ім'я, email) + кнопка Вийти
 *  3. Стрік (тимчасові дані)
 *  4. Розподіл слів за CEFR (тимчасові дані)
 *  5. Налаштування (тимчасові плейсхолдери)
 *  6. Селектор мови (Available / Upcoming)
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth }  from "../hooks/useAuth";
import { useI18n } from "../i18n";
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";
import { fetchMyProfile } from "../services/profileService";
import { AVAILABLE_LANGUAGES, PLANNED_LANGUAGES } from "../config/languages";

// ─── Тимчасові дані ──────────────────────────────────────────────────────────
const STREAK = 12;
const LEVELS  = { A1: 0, A2: 1, B1: 1, B2: 3, C1: 2, C2: 1 };

const SETTINGS = [
  { key: "profile.settings.notifications", icon: "notifications-outline" },
  { key: "profile.settings.export",        icon: "download-outline"       },
  { key: "profile.settings.language_pair", icon: "language-outline"       },
  { key: "profile.settings.about",         icon: "information-circle-outline" },
];

// ─── Компонент ───────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut }        = useAuth();

  const [plan, setPlan]         = useState(null);   // 'free' | 'pro'
  const [planLoading, setPlanLoading] = useState(true);

  // Завантажуємо план підписки
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const profile = await fetchMyProfile();
        if (mounted) setPlan(profile.subscription_plan ?? "free");
      } catch {
        if (mounted) setPlan("free");
      } finally {
        if (mounted) setPlanLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Витягуємо дані профілю з об'єкту user
  const profile = useMemo(() => {
    const email = user?.email || user?.user_metadata?.email || null;

    const providers = user?.app_metadata?.providers || [];
    const provider  =
      (Array.isArray(providers) && providers[0]) ||
      user?.app_metadata?.provider ||
      user?.user_metadata?.provider ||
      null;

    const fullName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name     ||
      user?.user_metadata?.preferred_username ||
      null;

    const avatarUrl =
      user?.user_metadata?.avatar_url ||
      user?.user_metadata?.picture    ||
      null;

    return { email, provider, fullName, avatarUrl };
  }, [user]);

  const providerLabel = profile.provider
    ? profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1)
    : t("profile.provider_email");

  // ─── Plan badge config ──────────────────────────────────────────────────
  const PLAN_CONFIG = {
    free: {
      emoji: t("profile.plan_free_emoji"),
      label: t("profile.plan_free"),
      color: "#2563eb",
      bg:    "#eff6ff",
      border:"#bfdbfe",
    },
    pro: {
      emoji: t("profile.plan_pro_emoji"),
      label: t("profile.plan_pro"),
      color: "#ca8a04",
      bg:    "#fefce8",
      border:"#fde68a",
    },
  };
  const planCfg = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t("profile.title")}</Text>
        </View>

        {/* ── 1. Plan badge ── */}
        <View style={[styles.planCard, { backgroundColor: planCfg.bg, borderColor: planCfg.border }]}>
          {planLoading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} />
          ) : (
            <View style={styles.planRow}>
              <Text style={styles.planEmoji}>{planCfg.emoji}</Text>
              <View style={styles.planTextWrap}>
                <Text style={styles.planSublabel}>{t("profile.plan_label")}</Text>
                <Text style={[styles.planName, { color: planCfg.color }]}>{planCfg.label}</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── 2. Картка профілю + кнопка Вийти ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            {/* Аватар */}
            <View style={styles.avatarWrap}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Ionicons name="person-circle-outline" size={42} color={COLORS.textHint} />
              )}
            </View>

            {/* Ім'я + email */}
            <View style={styles.profileText}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile.fullName || t("profile.signed_in")}
              </Text>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {profile.email || "—"}
              </Text>
            </View>

            {/* Кнопка Вийти (замість тега провайдера) */}
            <TouchableOpacity
              style={styles.signOutPill}
              onPress={signOut}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={14} color="#dc2626" />
              <Text style={styles.signOutPillText}>{t("profile.sign_out")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 3. Стрік ── */}
        <View style={styles.streakCard}>
          <Text style={styles.streakNumber}>{STREAK}</Text>
          <Text style={styles.streakLabel}>{t("profile.streak", { count: STREAK })} 🔥</Text>
        </View>

        {/* ── 4. Розподіл за рівнями ── */}
        <View style={styles.levelsCard}>
          <Text style={styles.sectionLabel}>{t("profile.words_by_level")}</Text>
          <View style={styles.levelsChart}>
            {Object.entries(LEVELS).map(([level, count]) => (
              <View key={level} style={styles.levelColumn}>
                <View
                  style={[
                    styles.levelBar,
                    {
                      height: Math.max(count * 20, 6),
                      backgroundColor: (CEFR_COLORS[level] || "#94a3b8") + "15",
                      borderColor:
                        count > 0
                          ? (CEFR_COLORS[level] || "#94a3b8") + "20"
                          : COLORS.borderLight,
                      borderWidth: 1,
                    },
                  ]}
                >
                  {count > 0 && (
                    <Text style={[styles.levelCount, { color: CEFR_COLORS[level] }]}>
                      {count}
                    </Text>
                  )}
                </View>
                <Text style={styles.levelLabel}>{level}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── 5. Налаштування ── */}
        <View style={styles.settingsCard}>
          {SETTINGS.map((item, index) => (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.settingItem,
                index < SETTINGS.length - 1 && styles.settingBorder,
              ]}
              activeOpacity={0.6}
            >
              <View style={styles.settingLeft}>
                <Ionicons name={item.icon} size={20} color={COLORS.textSecondary} />
                <Text style={styles.settingLabel}>{t(item.key)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textHint} />
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 6. Селектор мови ── */}
        <View style={styles.languageCard}>
          {/* Заголовок секції */}
          <View style={styles.langHeader}>
            <Ionicons name="globe-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.langHeaderText}>{t("profile.language_section")}</Text>
          </View>

          {/* Available */}
          <Text style={styles.langGroupLabel}>{t("profile.language_available")}</Text>
          {AVAILABLE_LANGUAGES.map((lang, index) => {
            const isActive = locale === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.langItem,
                  index < AVAILABLE_LANGUAGES.length - 1 && styles.langItemBorder,
                  isActive && styles.langItemActive,
                ]}
                onPress={() => setLocale(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>
                  {lang.label}
                </Text>
                {isActive && (
                  <Ionicons name="checkmark" size={16} color={COLORS.primary} style={styles.langCheck} />
                )}
              </TouchableOpacity>
            );
          })}

          {/* Upcoming */}
          <Text style={[styles.langGroupLabel, { marginTop: 16 }]}>
            {t("profile.language_upcoming")}
          </Text>
          {PLANNED_LANGUAGES.map((lang, index) => (
            <View
              key={lang.code}
              style={[
                styles.langItem,
                styles.langItemDisabled,
                index < PLANNED_LANGUAGES.length - 1 && styles.langItemBorder,
              ]}
            >
              <Text style={[styles.langFlag, styles.langFlagDisabled]}>{lang.flag}</Text>
              <Text style={[styles.langLabel, styles.langLabelDisabled]}>{lang.label}</Text>
              <Text style={styles.langComingSoon}>{t("profile.language_coming_soon")}</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea:  { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },
  header:    { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title:     { fontSize: 28, fontWeight: "400", color: COLORS.primary },

  // ── Plan badge ──
  planCard: {
    borderRadius: BORDER_RADIUS.lg,
    paddingVertical: 14,
    paddingHorizontal: SPACING.xl,
    marginBottom: 10,
    borderWidth: 1,
  },
  planRow:      { flexDirection: "row", alignItems: "center", gap: 12 },
  planEmoji:    { fontSize: 28 },
  planTextWrap: { flex: 1 },
  planSublabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", letterSpacing: 0.5 },
  planName:     { fontSize: 18, fontWeight: "700", marginTop: 1 },

  // ── Профіль ──
  profileCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  profileRow:   { flexDirection: "row", alignItems: "center" },
  avatarWrap:   { width: 46, height: 46, justifyContent: "center", alignItems: "center" },
  avatarImg:    { width: 42, height: 42, borderRadius: 21 },
  profileText:  { flex: 1, paddingHorizontal: 10 },
  profileName:  { fontSize: 15, color: COLORS.textSecondary, fontWeight: "600" },
  profileEmail: { marginTop: 2, fontSize: 12, color: COLORS.textMuted },

  signOutPill: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
  },
  signOutPillText: { fontSize: 12, color: "#dc2626", fontWeight: "500" },

  // ── Стрік ──
  streakCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  streakNumber: { fontSize: 42, fontWeight: "300", color: "#ea580c", fontFamily: "Courier" },
  streakLabel:  { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },

  // ── Рівні ──
  levelsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  sectionLabel:  { fontSize: 11, color: COLORS.textMuted, letterSpacing: 0.8, fontWeight: "500", marginBottom: 14 },
  levelsChart:   { flexDirection: "row", gap: 8, alignItems: "flex-end", height: 80 },
  levelColumn:   { flex: 1, alignItems: "center" },
  levelBar:      { width: "100%", borderRadius: 6, justifyContent: "center", alignItems: "center" },
  levelCount:    { fontSize: 11, fontWeight: "700", fontFamily: "Courier" },
  levelLabel:    { fontSize: 10, color: COLORS.textMuted, fontFamily: "Courier", marginTop: 6 },

  // ── Налаштування ──
  settingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.xl,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  settingItem:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 },
  settingBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  settingLeft:   { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel:  { fontSize: 14, color: COLORS.textSecondary },

  // ── Мова ──
  languageCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  langHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  langHeaderText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
  langGroupLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: "500",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    gap: 12,
  },
  langItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  langItemActive: {
    // Активний рядок — без окремого фону, лише чекмарк
  },
  langItemDisabled: {
    opacity: 0.45,
  },
  langFlag:         { fontSize: 20 },
  langFlagDisabled: {},
  langLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "400",
  },
  langLabelActive:   { color: COLORS.primary, fontWeight: "600" },
  langLabelDisabled: { color: COLORS.textMuted },
  langCheck:         { marginLeft: "auto" },
  langComingSoon: {
    fontSize: 11,
    color: COLORS.textHint,
    fontStyle: "italic",
  },
});
