/**
 * SettingsScreen.js — Full Settings (4 sections + sub-screens)
 *
 * Screens exported:
 *   - SettingsScreen      — main list (Learning / Account / App / Data)
 *   - NotificationsScreen — per-type toggles + permission flow
 *   - AboutScreen         — static version info + support email
 *   - DeleteAccountScreen — checkbox + double-confirm hard delete
 *
 * Navigation (all inside ProfileStack):
 *   ProfileMain → Settings → Notifications
 *                          → About
 *                          → DeleteAccount
 *   (App Language reuses existing Language modal logic — now a dedicated sub-screen here)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  Clipboard,
  Linking,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { useAuth }  from "../hooks/useAuth";
import { useI18n } from "../i18n";
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
} from "../utils/constants";
import {
  loadSettings,
  saveSettings,
  deleteAccount,
  DEFAULT_SETTINGS,
} from "../services/settingsService";
import { AVAILABLE_LANGUAGES, PLANNED_LANGUAGES } from "../config/languages";

// App version from expo-constants (graceful fallback)
let APP_VERSION = "1.0.0";
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Constants = require("expo-constants").default;
  APP_VERSION =
    Constants?.expoConfig?.version ??
    Constants?.manifest?.version ??
    Constants?.manifest2?.runtimeVersion ??
    "1.0.0";
} catch {}

// ─── Notification helpers (lazy-loaded — expo-notifications needs native build) ─

const PRACTICE_NOTIF_ID = "lexum_practice_reminder";
const TODAY_NOTIF_ID    = "lexum_today_reminder";

// Default times (hour:minute)
const DEFAULT_PRACTICE_HOUR = 19; // 7 PM
const DEFAULT_TODAY_HOUR    = 20; // 8 PM

// Lazily require expo-notifications so the app doesn't crash in Expo Go
// where ExpoPushTokenManager native module is unavailable.
function getNotifications() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-notifications");
  } catch {
    return null;
  }
}

// Returns 'granted' | 'denied' | 'unavailable'
async function requestNotifPermission() {
  const Notifications = getNotifications();
  if (!Notifications) return "unavailable";
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return "granted";
    if (existing === "denied")  return "denied";
    const { status } = await Notifications.requestPermissionsAsync();
    return status; // 'granted' | 'denied'
  } catch {
    return "unavailable";
  }
}

// Returns current permission status without prompting
async function getNotifPermissionStatus() {
  const Notifications = getNotifications();
  if (!Notifications) return "unavailable";
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status; // 'granted' | 'denied' | 'undetermined'
  } catch {
    return "unavailable";
  }
}

async function scheduleNotif(id, hour, titleKey, bodyKey, t) {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        title: t(titleKey),
        body:  t(bodyKey),
        sound: true,
      },
      trigger: {
        hour,
        minute: 0,
        repeats: true,
      },
    });
  } catch (e) {
    console.warn("[Notifications] scheduleNotif failed:", e?.message);
  }
}

async function cancelNotif(id) {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  } catch {}
}

// ─── Shared sub-components ────────────────────────────────────────────────────

/** Settings row: icon · label · (value text) · chevron */
function SettingRow({ icon, label, value, onPress, chevron = true, danger = false, disabled = false }) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, disabled && styles.settingRowDisabled]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={disabled ? 1 : 0.65}
    >
      <View style={styles.settingLeft}>
        <Ionicons
          name={icon}
          size={20}
          color={danger ? COLORS.error : disabled ? COLORS.textHint : COLORS.textSecondary}
        />
        <Text style={[
          styles.settingLabel,
          danger && styles.settingLabelDanger,
          disabled && styles.settingLabelDisabled,
        ]}>
          {label}
        </Text>
      </View>
      <View style={styles.settingRight}>
        {value ? <Text style={styles.settingValue} numberOfLines={1}>{value}</Text> : null}
        {chevron && (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={disabled ? COLORS.borderLight : COLORS.textHint}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

/** Settings row with a Switch on the right */
function SettingToggleRow({ icon, label, hint, value, onToggle, disabled = false }) {
  return (
    <View style={styles.settingRow}>
      <View style={[styles.settingLeft, { flex: 1 }]}>
        <Ionicons name={icon} size={20} color={disabled ? COLORS.textHint : COLORS.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingLabel, disabled && styles.settingLabelDisabled]}>
            {label}
          </Text>
          {hint ? (
            <Text style={styles.settingHint} numberOfLines={2}>{hint}</Text>
          ) : null}
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: COLORS.border, true: COLORS.primary + "44" }}
        thumbColor={value ? COLORS.primary : COLORS.textMuted}
        ios_backgroundColor={COLORS.border}
      />
    </View>
  );
}

/** Thin divider between rows in the same card */
function RowDivider() {
  return <View style={styles.rowDivider} />;
}

/** Section header ("LEARNING", "ACCOUNT", etc.) */
function SectionHeader({ label }) {
  return <Text style={styles.sectionHeader}>{label}</Text>;
}

// ─── Daily Goal picker modal ──────────────────────────────────────────────────

const GOAL_OPTIONS = [5, 10, 20, 30];

function DailyGoalModal({ visible, current, onSelect, onClose, t }) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.goalModalCard}>
          <Text style={styles.goalModalTitle}>{t("settings.daily_goal_label")}</Text>
          <Text style={styles.goalModalHint}>{t("settings.daily_goal_hint")}</Text>
          {GOAL_OPTIONS.map((g) => (
            <TouchableOpacity
              key={g}
              style={[styles.goalOption, current === g && styles.goalOptionActive]}
              onPress={() => onSelect(g)}
              activeOpacity={0.7}
            >
              <Text style={[styles.goalOptionText, current === g && styles.goalOptionTextActive]}>
                {t("settings.daily_goal_words", { count: g })}
              </Text>
              {current === g && (
                <Ionicons name="checkmark" size={18} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.goalCancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.goalCancelText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Translation Direction picker modal ───────────────────────────────────────

const DIRECTION_OPTIONS = [
  { value: "auto",      labelKey: "settings.translation_dir_auto" },
  { value: "last_used", labelKey: "settings.translation_dir_last" },
  { value: "fixed",     labelKey: "settings.translation_dir_fixed" },
];

function DirectionModal({ visible, current, onSelect, onClose, t }) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={onClose}>
        <View style={styles.goalModalCard}>
          <Text style={styles.goalModalTitle}>{t("settings.translation_dir_label")}</Text>
          <Text style={styles.goalModalHint}>{t("settings.translation_dir_hint")}</Text>
          {DIRECTION_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.goalOption, current === opt.value && styles.goalOptionActive]}
              onPress={() => onSelect(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.goalOptionText, current === opt.value && styles.goalOptionTextActive]}>
                {t(opt.labelKey)}
              </Text>
              {current === opt.value && (
                <Ionicons name="checkmark" size={18} color={COLORS.primary} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.goalCancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.goalCancelText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN SETTINGS SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsScreen({ navigation }) {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut }        = useAuth();
  const insets                   = useSafeAreaInsets();

  const [settings, setSettings]     = useState({ ...DEFAULT_SETTINGS });
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [showGoalModal, setShowGoalModal]      = useState(false);
  const [showDirModal, setShowDirModal]        = useState(false);
  const [signOutConfirm, setSignOutConfirm]    = useState(false);

  const userId = user?.id;

  // Load settings on mount
  useEffect(() => {
    if (!userId) { setLoadingSettings(false); return; }
    loadSettings(userId).then((s) => {
      setSettings({ ...DEFAULT_SETTINGS, ...s });
      setLoadingSettings(false);
    });
  }, [userId]);

  // Persist a partial update
  const patch = useCallback(async (updates) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    if (userId) {
      await saveSettings(userId, updates).catch((e) =>
        console.warn("[SettingsScreen] patch failed:", e?.message)
      );
    }
  }, [userId]);

  // Email copy
  const email = user?.email || user?.user_metadata?.email || null;

  const handleCopyEmail = useCallback(() => {
    if (!email) return;
    Clipboard.setString(email);
    Alert.alert("", t("settings.email_copied"), [{ text: "OK" }]);
  }, [email, t]);

  // Sign out with confirm
  const handleSignOut = useCallback(() => {
    setSignOutConfirm(true);
  }, []);

  const confirmSignOut = useCallback(async () => {
    setSignOutConfirm(false);
    try {
      await signOut();
    } catch (e) {
      Alert.alert(t("common.error"), e?.message);
    }
  }, [signOut, t]);

  // Current language label
  const currentLang = useMemo(
    () => [...AVAILABLE_LANGUAGES, ...PLANNED_LANGUAGES].find((l) => l.code === locale),
    [locale]
  );

  // Direction label
  const dirLabel = useMemo(() => {
    const opt = DIRECTION_OPTIONS.find((o) => o.value === settings.translation_direction);
    return opt ? t(opt.labelKey) : t("settings.translation_dir_auto");
  }, [settings.translation_direction, t]);

  if (loadingSettings) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color={COLORS.textMuted} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.title")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── SECTION 1: LEARNING ── */}
        <SectionHeader label={t("settings.section_learning")} />
        <View style={styles.card}>
          {/* Translation Direction */}
          <SettingRow
            icon="swap-horizontal-outline"
            label={t("settings.translation_dir_label")}
            value={dirLabel}
            onPress={() => setShowDirModal(true)}
          />
          <RowDivider />
          {/* Daily Goal */}
          <SettingRow
            icon="flag-outline"
            label={t("settings.daily_goal_label")}
            value={t("settings.daily_goal_words", { count: settings.daily_goal ?? 10 })}
            onPress={() => setShowGoalModal(true)}
          />
          <RowDivider />
          {/* Notifications */}
          <SettingRow
            icon="notifications-outline"
            label={t("settings.notifications_label")}
            onPress={() => navigation.navigate("Notifications", { settings, onUpdate: patch })}
          />
        </View>

        {/* ── SECTION 2: ACCOUNT ── */}
        <SectionHeader label={t("settings.section_account")} />
        <View style={styles.card}>
          {/* Email */}
          <SettingRow
            icon="mail-outline"
            label={t("settings.email_label")}
            value={email || "—"}
            onPress={email ? handleCopyEmail : undefined}
            chevron={false}
          />
          <RowDivider />
          {/* Sign Out */}
          <SettingRow
            icon="log-out-outline"
            label={t("settings.sign_out_label")}
            onPress={handleSignOut}
            chevron={false}
            danger
          />
          <RowDivider />
          {/* Delete Account */}
          <SettingRow
            icon="trash-outline"
            label={t("settings.delete_account_label")}
            onPress={() => navigation.navigate("DeleteAccount")}
            chevron
            danger
          />
        </View>

        {/* ── SECTION 3: APP ── */}
        <SectionHeader label={t("settings.section_app")} />
        <View style={styles.card}>
          {/* App Language */}
          <SettingRow
            icon="globe-outline"
            label={t("settings.app_language_label")}
            value={currentLang ? `${currentLang.flag} ${currentLang.label}` : locale}
            onPress={() => navigation.navigate("AppLanguage")}
          />
          <RowDivider />
          {/* About */}
          <SettingRow
            icon="information-circle-outline"
            label={t("settings.about_label")}
            onPress={() => navigation.navigate("About")}
          />
          <RowDivider />
          {/* Privacy Policy */}
          <SettingRow
            icon="shield-outline"
            label={t("settings.privacy_label")}
            onPress={() => Linking.openURL("https://lexum.app/privacy")}
          />
          <RowDivider />
          {/* Terms of Use */}
          <SettingRow
            icon="document-text-outline"
            label={t("settings.terms_label")}
            onPress={() => Linking.openURL("https://lexum.app/terms")}
          />
        </View>

        {/* ── SECTION 4: DATA ── */}
        <SectionHeader label={t("settings.section_data")} />
        <View style={styles.card}>
          {/* Export Data (Pro only — disabled for Free) */}
          <SettingRow
            icon="download-outline"
            label={t("settings.export_label")}
            value={t("settings.export_pro_hint")}
            onPress={undefined}
            chevron={false}
            disabled
          />
        </View>
      </ScrollView>

      {/* Daily Goal modal */}
      <DailyGoalModal
        visible={showGoalModal}
        current={settings.daily_goal ?? 10}
        onSelect={(g) => { patch({ daily_goal: g }); setShowGoalModal(false); }}
        onClose={() => setShowGoalModal(false)}
        t={t}
      />

      {/* Translation Direction modal */}
      <DirectionModal
        visible={showDirModal}
        current={settings.translation_direction ?? "auto"}
        onSelect={(v) => { patch({ translation_direction: v }); setShowDirModal(false); }}
        onClose={() => setShowDirModal(false)}
        t={t}
      />

      {/* Sign Out confirm modal */}
      <Modal
        visible={signOutConfirm}
        animationType="fade"
        transparent
        onRequestClose={() => setSignOutConfirm(false)}
      >
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={() => setSignOutConfirm(false)}
        >
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>{t("settings.sign_out_confirm_title")}</Text>
            <Text style={styles.confirmBody}>{t("settings.sign_out_confirm_body")}</Text>
            <TouchableOpacity style={styles.confirmDangerBtn} onPress={confirmSignOut} activeOpacity={0.8}>
              <Text style={styles.confirmDangerText}>{t("settings.sign_out_confirm_btn")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setSignOutConfirm(false)} activeOpacity={0.7}>
              <Text style={styles.confirmCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS SUB-SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export function NotificationsScreen({ navigation, route }) {
  const { t }     = useI18n();
  const { user }  = useAuth();
  const insets    = useSafeAreaInsets();

  // Initialise from passed settings
  const passedSettings = route?.params?.settings ?? {};
  const onUpdate       = route?.params?.onUpdate;

  const [permStatus, setPermStatus]           = useState(null); // 'granted' | 'denied' | 'undetermined'
  const [remindersEnabled, setRemindersEnabled] = useState(passedSettings.reminders_enabled ?? false);
  const [practiceOn, setPracticeOn]           = useState(passedSettings.reminder_practice  ?? false);
  const [todayOn, setTodayOn]                 = useState(passedSettings.reminder_today     ?? false);
  const [saving, setSaving]                   = useState(false);

  // Check permission on mount (safe — won't crash in Expo Go)
  useEffect(() => {
    getNotifPermissionStatus().then((status) => setPermStatus(status));
  }, []);

  const isDenied       = permStatus === "denied";
  const isUnavailable  = permStatus === "unavailable";

  // Toggle master switch
  const handleMasterToggle = useCallback(async (val) => {
    if (val && !isDenied) {
      const result = await requestNotifPermission();
      if (result === "denied") {
        setPermStatus("denied");
        return;
      }
      if (result === "unavailable") {
        // Native module not available (Expo Go) — allow toggling UI only, no real notifications
      } else {
        setPermStatus("granted");
      }
    }
    setRemindersEnabled(val);
    if (!val) {
      // Cancel all when master is off
      await cancelNotif(PRACTICE_NOTIF_ID);
      await cancelNotif(TODAY_NOTIF_ID);
    }
    await _persist({ reminders_enabled: val });
  }, [isDenied]);

  // Toggle individual type
  const handleTypeToggle = useCallback(async (type, val) => {
    if (type === "practice") {
      setPracticeOn(val);
      if (val && remindersEnabled) {
        await scheduleNotif(
          PRACTICE_NOTIF_ID,
          DEFAULT_PRACTICE_HOUR,
          "settings.notif_practice_label",
          "settings.notif_practice_hint",
          t
        );
      } else {
        await cancelNotif(PRACTICE_NOTIF_ID);
      }
      await _persist({ reminder_practice: val });
    } else {
      setTodayOn(val);
      if (val && remindersEnabled) {
        await scheduleNotif(
          TODAY_NOTIF_ID,
          DEFAULT_TODAY_HOUR,
          "settings.notif_today_label",
          "settings.notif_today_hint",
          t
        );
      } else {
        await cancelNotif(TODAY_NOTIF_ID);
      }
      await _persist({ reminder_today: val });
    }
  }, [remindersEnabled, t]);

  const _persist = useCallback(async (updates) => {
    setSaving(true);
    try {
      if (onUpdate) await onUpdate(updates);
      else if (user?.id) await saveSettings(user.id, updates);
    } catch {}
    setSaving(false);
  }, [onUpdate, user]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.notif_screen_title")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Permission denied banner */}
        {isDenied && (
          <TouchableOpacity
            style={styles.permBanner}
            onPress={() => Linking.openSettings()}
            activeOpacity={0.8}
          >
            <Ionicons name="warning-outline" size={18} color="#ca8a04" />
            <Text style={styles.permBannerText}>{t("settings.notif_permission_denied")}</Text>
            <Text style={styles.permBannerCta}>{t("settings.notif_open_settings")}</Text>
          </TouchableOpacity>
        )}

        {/* Expo Go / dev build notice */}
        {isUnavailable && (
          <View style={[styles.permBanner, { borderColor: COLORS.borderLight, backgroundColor: COLORS.borderLight + "55" }]}>
            <Ionicons name="information-circle-outline" size={18} color={COLORS.textMuted} />
            <Text style={[styles.permBannerText, { color: COLORS.textMuted }]}>
              {"Notifications require a development build (not available in Expo Go)"}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          {/* Master toggle */}
          <SettingToggleRow
            icon="notifications-outline"
            label={t("settings.notifications_label")}
            value={remindersEnabled}
            onToggle={handleMasterToggle}
            disabled={isDenied}
          />
        </View>

        {/* Individual toggles — only shown when master is on */}
        {remindersEnabled && (
          <>
            <SectionHeader label={t("settings.notif_time_label")} />
            <View style={styles.card}>
              <SettingToggleRow
                icon="barbell-outline"
                label={t("settings.notif_practice_label")}
                hint={t("settings.notif_practice_hint")}
                value={practiceOn}
                onToggle={(v) => handleTypeToggle("practice", v)}
                disabled={isDenied}
              />
              <RowDivider />
              <SettingToggleRow
                icon="today-outline"
                label={t("settings.notif_today_label")}
                hint={t("settings.notif_today_hint")}
                value={todayOn}
                onToggle={(v) => handleTypeToggle("today", v)}
                disabled={isDenied}
              />
            </View>
          </>
        )}

        {saving && (
          <ActivityIndicator
            size="small"
            color={COLORS.textMuted}
            style={{ marginTop: 12, alignSelf: "center" }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP LANGUAGE SUB-SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export function AppLanguageScreen({ navigation }) {
  const { t, locale, setLocale } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.app_language_label")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <SectionHeader label={t("profile.language_available")} />
        <View style={styles.card}>
          {AVAILABLE_LANGUAGES.map((lang, index) => {
            const isActive = locale === lang.code;
            return (
              <React.Fragment key={lang.code}>
                <TouchableOpacity
                  style={styles.settingRow}
                  onPress={() => { setLocale(lang.code); navigation.goBack(); }}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingLeft}>
                    <Text style={styles.langFlag}>{lang.flag}</Text>
                    <Text style={[styles.settingLabel, isActive && styles.settingLabelActive]}>
                      {lang.label}
                    </Text>
                  </View>
                  {isActive && (
                    <Ionicons name="checkmark" size={18} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
                {index < AVAILABLE_LANGUAGES.length - 1 && <RowDivider />}
              </React.Fragment>
            );
          })}
        </View>

        {PLANNED_LANGUAGES.length > 0 && (
          <>
            <SectionHeader label={t("profile.language_upcoming")} />
            <View style={styles.card}>
              {PLANNED_LANGUAGES.map((lang, index) => (
                <React.Fragment key={lang.code}>
                  <View style={[styles.settingRow, styles.settingRowDisabled]}>
                    <View style={styles.settingLeft}>
                      <Text style={styles.langFlag}>{lang.flag}</Text>
                      <Text style={[styles.settingLabel, styles.settingLabelDisabled]}>
                        {lang.label}
                      </Text>
                    </View>
                    <Text style={styles.comingSoonBadge}>{t("profile.language_coming_soon")}</Text>
                  </View>
                  {index < PLANNED_LANGUAGES.length - 1 && <RowDivider />}
                </React.Fragment>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ABOUT SUB-SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export function AboutScreen({ navigation }) {
  const { t }  = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.about_screen_title")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* App info card */}
        <View style={[styles.card, { alignItems: "center", paddingVertical: SPACING.xxxl }]}>
          <View style={styles.aboutIconWrap}>
            <Text style={styles.aboutIconEmoji}>📖</Text>
          </View>
          <Text style={styles.aboutAppName}>Lexum</Text>
          <Text style={styles.aboutVersion}>
            {t("settings.about_version", { version: APP_VERSION })}
          </Text>
          <Text style={styles.aboutDesc}>{t("settings.about_description")}</Text>
        </View>

        {/* Support */}
        <SectionHeader label={t("settings.about_contact")} />
        <View style={styles.card}>
          <SettingRow
            icon="mail-outline"
            label={t("settings.about_contact")}
            value={t("settings.about_support_email")}
            onPress={() => Linking.openURL(`mailto:${t("settings.about_support_email")}`)}
            chevron={false}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE ACCOUNT SUB-SCREEN
// ═══════════════════════════════════════════════════════════════════════════════

export function DeleteAccountScreen({ navigation }) {
  const { t }       = useI18n();
  const { signOut } = useAuth();
  const insets      = useSafeAreaInsets();

  const [checked, setChecked]   = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!checked) return;

    Alert.alert(
      t("settings.delete_account_confirm_title"),
      t("settings.delete_account_confirm_body"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("settings.delete_account_confirm_btn"),
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
              // Server deleted auth user — sign out locally
              await signOut().catch(() => {});
            } catch (e) {
              setDeleting(false);
              Alert.alert(t("common.error"), e?.message || "Something went wrong.");
            }
          },
        },
      ]
    );
  }, [checked, t, signOut]);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={8}
          activeOpacity={0.7}
          disabled={deleting}
        >
          <Ionicons name="chevron-back" size={24} color={deleting ? COLORS.textHint : COLORS.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("settings.delete_account_screen_title")}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Warning card */}
        <View style={styles.deleteWarningCard}>
          <Ionicons name="warning-outline" size={28} color={COLORS.error} style={{ marginBottom: 10 }} />
          <Text style={styles.deleteWarningText}>{t("settings.delete_account_warning")}</Text>
        </View>

        {/* Checkbox */}
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setChecked((v) => !v)}
          activeOpacity={0.7}
          disabled={deleting}
        >
          <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
            {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
          </View>
          <Text style={styles.checkboxLabel}>{t("settings.delete_account_checkbox")}</Text>
        </TouchableOpacity>

        {/* Delete button */}
        <TouchableOpacity
          style={[
            styles.deleteBtn,
            (!checked || deleting) && styles.deleteBtnDisabled,
          ]}
          onPress={handleDelete}
          activeOpacity={0.8}
          disabled={!checked || deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.deleteBtnText}>{t("settings.delete_account_btn")}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },

  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center" },

  // ── Header ──
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.background,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.primary,
  },

  scroll: { flex: 1, paddingHorizontal: SPACING.xl },

  // ── Section header ──
  sectionHeader: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
    marginLeft: 2,
  },

  // ── Card ──
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
  },

  // ── Row ──
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: SPACING.xl,
    paddingVertical: 14,
    minHeight: 52,
  },
  settingRowDisabled: { opacity: 0.45 },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  settingRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "45%",
  },
  settingLabel: {
    fontSize: 15,
    color: COLORS.textSecondary,
    fontWeight: "400",
    flexShrink: 1,
  },
  settingLabelDanger:   { color: COLORS.error },
  settingLabelDisabled: { color: COLORS.textHint },
  settingLabelActive:   { color: COLORS.primary, fontWeight: "600" },
  settingValue: {
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: "right",
    flexShrink: 1,
  },
  settingHint: {
    fontSize: 12,
    color: COLORS.textHint,
    marginTop: 2,
    lineHeight: 16,
  },

  rowDivider: {
    height: 1,
    backgroundColor: COLORS.borderLight,
    marginHorizontal: SPACING.xl,
  },

  // ── Modals ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  goalModalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  goalModalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 4,
  },
  goalModalHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: SPACING.lg,
    lineHeight: 18,
  },
  goalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: 4,
  },
  goalOptionActive: {
    backgroundColor: COLORS.primary + "0d",
  },
  goalOptionText:       { fontSize: 15, color: COLORS.textSecondary },
  goalOptionTextActive: { color: COLORS.primary, fontWeight: "600" },
  goalCancelBtn: {
    marginTop: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  goalCancelText: {
    fontSize: 15,
    color: COLORS.textSecondary,
  },

  // ── Confirm modal ──
  confirmCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.xxl,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
    alignItems: "center",
  },
  confirmTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: COLORS.primary,
    marginBottom: 8,
    textAlign: "center",
  },
  confirmBody: {
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  confirmDangerBtn: {
    backgroundColor: COLORS.error,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 13,
    width: "100%",
    alignItems: "center",
    marginBottom: SPACING.sm,
  },
  confirmDangerText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  confirmCancelBtn: {
    paddingVertical: 12,
    width: "100%",
    alignItems: "center",
  },
  confirmCancelText: { fontSize: 15, color: COLORS.textSecondary },

  // ── Notifications ──
  permBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fefce8",
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  permBannerText: { flex: 1, fontSize: 13, color: "#92400e", lineHeight: 17 },
  permBannerCta:  { fontSize: 13, fontWeight: "600", color: "#ca8a04" },

  // ── App Language ──
  langFlag:      { fontSize: 22, marginRight: 2 },
  comingSoonBadge: {
    fontSize: 11,
    color: COLORS.textHint,
    backgroundColor: COLORS.borderLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: "hidden",
  },

  // ── About ──
  aboutIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  aboutIconEmoji: { fontSize: 34 },
  aboutAppName: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.primary,
    marginBottom: 4,
  },
  aboutVersion: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 14,
  },
  aboutDesc: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: SPACING.md,
  },

  // ── Delete Account ──
  deleteWarningCard: {
    backgroundColor: "#fef2f2",
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: "#fecaca",
    alignItems: "center",
    marginTop: SPACING.xl,
  },
  deleteWarningText: {
    fontSize: 14,
    color: "#991b1b",
    lineHeight: 20,
    textAlign: "center",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginTop: SPACING.xl,
    paddingHorizontal: 2,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: COLORS.error,
    borderColor: COLORS.error,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  deleteBtn: {
    marginTop: SPACING.xxl,
    backgroundColor: COLORS.error,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 15,
    alignItems: "center",
  },
  deleteBtnDisabled: {
    backgroundColor: COLORS.border,
  },
  deleteBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
