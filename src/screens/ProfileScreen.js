/**
 * ProfileScreen.js — Екран профілю та статистики
 *
 * Показує: профіль (email/provider), стрік, розподіл слів за CEFR-рівнями, налаштування.
 */

import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../hooks/useAuth";
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";

// Тимчасові дані
const STREAK = 12;
const LEVELS = { A1: 0, A2: 1, B1: 1, B2: 3, C1: 2, C2: 1 };

const SETTINGS = [
  { label: "Notifications", icon: "notifications-outline" },
  { label: "Export data", icon: "download-outline" },
  { label: "Language pair", icon: "language-outline" },
  { label: "About LexiLevel", icon: "information-circle-outline" },
];

export default function ProfileScreen() {
  const { user, signOut } = useAuth();

  const profile = useMemo(() => {
    const email = user?.email || user?.user_metadata?.email || null;

    // Supabase часто кладе провайдера в app_metadata.providers
    const providers = user?.app_metadata?.providers || [];
    const provider =
      (Array.isArray(providers) && providers[0]) ||
      user?.app_metadata?.provider ||
      user?.user_metadata?.provider ||
      null;

    const fullName =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.user_metadata?.preferred_username ||
      null;

    const avatarUrl =
      user?.user_metadata?.avatar_url ||
      user?.user_metadata?.picture ||
      null;

    return {
      email,
      provider,
      fullName,
      avatarUrl,
    };
  }, [user]);

  const providerLabel = profile.provider
    ? profile.provider.charAt(0).toUpperCase() + profile.provider.slice(1)
    : "Email";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* Профіль (email/provider) */}
        <View style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.avatarWrap}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImg} />
              ) : (
                <Ionicons name="person-circle-outline" size={42} color={COLORS.textHint} />
              )}
            </View>

            <View style={styles.profileText}>
              <Text style={styles.profileName} numberOfLines={1}>
                {profile.fullName || "Signed in"}
              </Text>

              <Text style={styles.profileEmail} numberOfLines={1}>
                {profile.email || "—"}
              </Text>
            </View>

            <View style={styles.providerPill}>
              <Ionicons
                name={profile.provider === "google" ? "logo-google" : "mail-outline"}
                size={14}
                color={COLORS.textSecondary}
              />
              <Text style={styles.providerText}>{providerLabel}</Text>
            </View>
          </View>

          {/* Якщо раптом треба дебаг/перевірка */}
          {/* <Text style={{ marginTop: 8, fontSize: 12, color: COLORS.textMuted }}>
            {user?.id}
          </Text> */}
        </View>

        {/* Стрік */}
        <View style={styles.streakCard}>
          <Text style={styles.streakNumber}>{STREAK}</Text>
          <Text style={styles.streakLabel}>day streak 🔥</Text>
        </View>

        {/* Розподіл за рівнями */}
        <View style={styles.levelsCard}>
          <Text style={styles.sectionLabel}>WORDS BY LEVEL</Text>
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
                        count > 0 ? (CEFR_COLORS[level] || "#94a3b8") + "20" : COLORS.borderLight,
                      borderWidth: 1,
                    },
                  ]}
                >
                  {count > 0 && (
                    <Text style={[styles.levelCount, { color: CEFR_COLORS[level] }]}>{count}</Text>
                  )}
                </View>
                <Text style={styles.levelLabel}>{level}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Налаштування */}
        {SETTINGS.map((item, index) => (
          <TouchableOpacity
            key={item.label}
            style={[styles.settingItem, index < SETTINGS.length - 1 && styles.settingBorder]}
            activeOpacity={0.6}
          >
            <View style={styles.settingLeft}>
              <Ionicons name={item.icon} size={20} color={COLORS.textSecondary} />
              <Text style={styles.settingLabel}>{item.label}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textHint} />
          </TouchableOpacity>
        ))}

        {/* Кнопка виходу */}
        <TouchableOpacity style={styles.signOutButton} onPress={signOut} activeOpacity={0.6}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: "400", color: COLORS.primary },

  // Профіль
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
  profileRow: { flexDirection: "row", alignItems: "center" },
  avatarWrap: { width: 46, height: 46, justifyContent: "center", alignItems: "center" },
  avatarImg: { width: 42, height: 42, borderRadius: 21 },
  profileText: { flex: 1, paddingHorizontal: 10 },
  profileName: { fontSize: 15, color: COLORS.textSecondary, fontWeight: "600" },
  profileEmail: { marginTop: 2, fontSize: 12, color: COLORS.textMuted },

  providerPill: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: COLORS.background,
  },
  providerText: { fontSize: 12, color: COLORS.textSecondary, fontWeight: "500" },

  // Стрік
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
  streakLabel: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },

  // Рівні
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
  sectionLabel: { fontSize: 11, color: COLORS.textMuted, letterSpacing: 0.8, fontWeight: "500", marginBottom: 14 },
  levelsChart: { flexDirection: "row", gap: 8, alignItems: "flex-end", height: 80 },
  levelColumn: { flex: 1, alignItems: "center" },
  levelBar: { width: "100%", borderRadius: 6, justifyContent: "center", alignItems: "center" },
  levelCount: { fontSize: 11, fontWeight: "700", fontFamily: "Courier" },
  levelLabel: { fontSize: 10, color: COLORS.textMuted, fontFamily: "Courier", marginTop: 6 },

  // Налаштування
  settingItem: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 14 },
  settingBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  settingLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  settingLabel: { fontSize: 14, color: COLORS.textSecondary },

  // Вихід
  signOutButton: {
    marginTop: SPACING.xxl,
    paddingVertical: 14,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    alignItems: "center",
  },
  signOutText: { fontSize: 14, fontWeight: "500", color: "#dc2626" },
});