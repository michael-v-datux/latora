/**
 * ProfileScreen.js — Екран профілю
 *
 * Секції (зверху вниз):
 *  1. Plan badge (Free / Pro) — з БД
 *  2. Картка профілю (аватар, ім'я, email) + кнопка Вийти
 *  3. Стрік — реальний (з practice_sessions через сервер)
 *  4. Розподіл слів за CEFR — реальний (з list_words+words через сервер)
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
  Modal,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth }  from "../hooks/useAuth";
import { useI18n } from "../i18n";
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";
import { fetchMyProfile } from "../services/profileService";
import { AVAILABLE_LANGUAGES, PLANNED_LANGUAGES } from "../config/languages";

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

const SETTINGS = [
  { key: "profile.settings.notifications", icon: "notifications-outline" },
  { key: "profile.settings.export",        icon: "download-outline"       },
  { key: "profile.settings.language_pair", icon: "language-outline"       },
  { key: "profile.settings.about",         icon: "information-circle-outline" },
];

// ─── Компонент ───────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut }        = useAuth();
  const insets                   = useSafeAreaInsets();

  const [profileData, setProfileData]   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [langModalVisible, setLangModalVisible] = useState(false);

  // Поточна мова для відображення у рядку-тригері
  const currentLang = [...AVAILABLE_LANGUAGES, ...PLANNED_LANGUAGES].find(l => l.code === locale);

  // Завантажуємо профіль (план + стрік + CEFR)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await fetchMyProfile();
        if (mounted) setProfileData(data);
      } catch {
        if (mounted) setProfileData({ subscription_plan: "free", streak: 0, cefr_distribution: {} });
      } finally {
        if (mounted) setLoading(false);
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

  // Розраховуємо похідні дані
  const plan        = profileData?.subscription_plan ?? "free";
  const streak      = profileData?.streak ?? 0;
  const cefrRaw     = profileData?.cefr_distribution ?? {};
  const cefrDist    = CEFR_ORDER.reduce((acc, lvl) => {
    acc[lvl] = cefrRaw[lvl] ?? 0;
    return acc;
  }, {});
  const totalWords  = Object.values(cefrDist).reduce((s, n) => s + n, 0);
  const maxCount    = Math.max(...Object.values(cefrDist), 1); // щоб уникнути ділення на 0

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
          {loading ? (
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

            {/* Кнопка Вийти */}
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
          <Text style={styles.sectionLabel}>{t("profile.streak_section")}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
          ) : streak > 0 ? (
            /* Є активний стрік */
            <View style={styles.streakContent}>
              <Text style={styles.streakNumber}>{streak}</Text>
              <Text style={styles.streakLabel}>{t("profile.streak", { count: streak })} 🔥</Text>
            </View>
          ) : (
            /* Стрік = 0 або згорів */
            <View style={styles.streakEmpty}>
              <Text style={styles.streakEmptyIcon}>🌱</Text>
              <Text style={styles.streakEmptyText}>{t("profile.streak_empty_title")}</Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => navigation.navigate("Practice")}
                activeOpacity={0.7}
              >
                <Text style={styles.emptyBtnText}>{t("profile.streak_empty_btn")}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── 4. Розподіл за рівнями ── */}
        <View style={styles.levelsCard}>
          <Text style={styles.sectionLabel}>{t("profile.words_by_level")}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
          ) : totalWords === 0 ? (
            /* Немає доданих слів */
            <View style={styles.cefrEmpty}>
              <Text style={styles.cefrEmptyIcon}>📚</Text>
              <Text style={styles.cefrEmptyText}>{t("profile.cefr_empty_title")}</Text>
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => navigation.navigate("Translate")}
                activeOpacity={0.7}
              >
                <Text style={styles.emptyBtnText}>{t("profile.cefr_empty_btn")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Бар-чарт CEFR */
            <View style={styles.levelsChart}>
              {CEFR_ORDER.map((level) => {
                const count = cefrDist[level] ?? 0;
                // Висота відносна до максимального рівня, мін 4px
                const barH = count > 0 ? Math.max(Math.round((count / maxCount) * 72), 8) : 4;
                return (
                  <View key={level} style={styles.levelColumn}>
                    <View
                      style={[
                        styles.levelBar,
                        {
                          height: barH,
                          backgroundColor:
                            count > 0
                              ? (CEFR_COLORS[level] || "#94a3b8") + "22"
                              : COLORS.borderLight,
                          borderColor:
                            count > 0
                              ? (CEFR_COLORS[level] || "#94a3b8") + "44"
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
                );
              })}
            </View>
          )}
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

        {/* ── 6. Рядок-тригер мови ── */}
        <View style={styles.settingsCard}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => setLangModalVisible(true)}
            activeOpacity={0.6}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="globe-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.settingLabel}>{t("profile.language_section")}</Text>
            </View>
            <View style={styles.langTriggerRight}>
              <Text style={styles.langTriggerValue}>
                {currentLang ? `${currentLang.flag} ${currentLang.label}` : locale}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textHint} />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Modal вибору мови ── */}
        <Modal
          visible={langModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setLangModalVisible(false)}
        >
          <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16 }]}>
            {/* Хедер модалки */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("profile.language_section")}</Text>
              <TouchableOpacity onPress={() => setLangModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Available */}
              <Text style={styles.langGroupLabel}>{t("profile.language_available")}</Text>
              <View style={styles.langGroup}>
                {AVAILABLE_LANGUAGES.map((lang, index) => {
                  const isActive = locale === lang.code;
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[
                        styles.langItem,
                        index < AVAILABLE_LANGUAGES.length - 1 && styles.langItemBorder,
                      ]}
                      onPress={() => { setLocale(lang.code); setLangModalVisible(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.langFlag}>{lang.flag}</Text>
                      <Text style={[styles.langLabel, isActive && styles.langLabelActive]}>
                        {lang.label}
                      </Text>
                      {isActive && (
                        <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Upcoming */}
              <Text style={[styles.langGroupLabel, { marginTop: 24 }]}>
                {t("profile.language_upcoming")}
              </Text>
              <View style={styles.langGroup}>
                {PLANNED_LANGUAGES.map((lang, index) => (
                  <View
                    key={lang.code}
                    style={[
                      styles.langItem,
                      styles.langItemDisabled,
                      index < PLANNED_LANGUAGES.length - 1 && styles.langItemBorder,
                    ]}
                  >
                    <Text style={styles.langFlag}>{lang.flag}</Text>
                    <Text style={[styles.langLabel, styles.langLabelDisabled]}>{lang.label}</Text>
                    <Text style={styles.langComingSoon}>{t("profile.language_coming_soon")}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </Modal>

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
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },
  streakContent: { alignItems: "center", paddingTop: 4 },
  streakNumber:  { fontSize: 42, fontWeight: "300", color: "#ea580c", fontFamily: "Courier" },
  streakLabel:   { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },

  streakEmpty: { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
  streakEmptyIcon: { fontSize: 28, marginBottom: 6 },
  streakEmptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginBottom: 12 },

  // ── Empty state кнопка (shared) ──
  emptyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.primary,
  },
  emptyBtnText: { fontSize: 13, color: "#ffffff", fontWeight: "600" },

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
  levelsChart:   { flexDirection: "row", gap: 8, alignItems: "flex-end", height: 88 },
  levelColumn:   { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  levelBar:      { width: "100%", borderRadius: 6, justifyContent: "center", alignItems: "center" },
  levelCount:    { fontSize: 11, fontWeight: "700", fontFamily: "Courier" },
  levelLabel:    { fontSize: 10, color: COLORS.textMuted, fontFamily: "Courier", marginTop: 6 },

  cefrEmpty: { alignItems: "center", paddingTop: 4, paddingBottom: 4 },
  cefrEmptyIcon: { fontSize: 28, marginBottom: 6 },
  cefrEmptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginBottom: 12 },

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

  // ── Тригер мови (правий бік рядка) ──
  langTriggerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  langTriggerValue: {
    fontSize: 14,
    color: COLORS.textMuted,
  },

  // ── Modal ──
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.primary,
  },
  langGroupLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: "500",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  langGroup: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  langItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    gap: 12,
  },
  langItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderLight,
  },
  langItemDisabled: {
    opacity: 0.4,
  },
  langFlag: { fontSize: 20 },
  langLabel: {
    flex: 1,
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: "400",
  },
  langLabelActive:   { color: COLORS.primary, fontWeight: "600" },
  langLabelDisabled: { color: COLORS.textMuted },
  langComingSoon: {
    fontSize: 12,
    color: COLORS.textHint,
    fontStyle: "italic",
  },
});
