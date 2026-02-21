/**
 * ProfileScreen.js — Екран профілю / Центр прогресу
 *
 * Секції (зверху вниз):
 *  1. Plan badge (Free / Pro)
 *  2. Картка профілю (аватар, ім'я, email) + кнопка Вийти
 *  3. Стрік
 *  4. Word State Distribution (New / Learning / Stabilizing / Mastered / Decaying)
 *  5. Most Active CEFR Level (inline, 1 рядок)
 *  6. Розподіл слів за CEFR
 *  7. Tab Switcher (Overview / Activity / Difficulty)
 *     - Overview: Vocab Growth chart (7D/30D) + Velocity (Pro) або locked
 *     - Activity:  Review stats + Accuracy bar
 *     - Difficulty: Difficulty Overview + Weakness Map (Pro) або locked
 *  8. Налаштування
 *  9. Рядок-тригер мови + Modal
 */

import React, { useCallback, useMemo, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth }  from "../hooks/useAuth";
import { useI18n } from "../i18n";
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";
import { fetchMyProfile } from "../services/profileService";
import { AVAILABLE_LANGUAGES, PLANNED_LANGUAGES } from "../config/languages";

// ─── Константи ────────────────────────────────────────────────────────────────
const CEFR_ORDER   = ["A1", "A2", "B1", "B2", "C1", "C2"];
const STATE_ORDER  = ["new", "learning", "stabilizing", "mastered", "decaying"];
const STATE_COLORS = {
  new:         "#94a3b8",
  learning:    "#2563eb",
  stabilizing: "#ca8a04",
  mastered:    "#16a34a",
  decaying:    "#dc2626",
};

const WEAKNESS_FACTORS = [
  { key: "frequency_band",   i18nKey: "word.factor_freq"  },
  { key: "polysemy_level",   i18nKey: "word.factor_poly"  },
  { key: "morph_complexity", i18nKey: "word.factor_morph" },
  { key: "phrase_flag",      i18nKey: "word.factor_phrase"},
];

const SETTINGS = [
  { key: "profile.settings.notifications", icon: "notifications-outline" },
  { key: "profile.settings.export",        icon: "download-outline"       },
  { key: "profile.settings.language_pair", icon: "language-outline"       },
  { key: "profile.settings.about",         icon: "information-circle-outline" },
];

// ─── Хелпери ──────────────────────────────────────────────────────────────────
function formatDayLabel(dateStr) {
  if (!dateStr) return "";
  try {
    return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

// ─── Підкомпоненти ────────────────────────────────────────────────────────────

/** Горизонтальний tab-switcher (Overview / Activity / Difficulty) */
function TabSwitcherBar({ active, onChange, t }) {
  const tabs = [
    { key: "overview",   label: t("profile.tab_overview")   },
    { key: "activity",   label: t("profile.tab_activity")   },
    { key: "difficulty", label: t("profile.tab_difficulty") },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.key}
          style={[styles.tabBtn, active === tab.key && styles.tabBtnActive]}
          onPress={() => onChange(tab.key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabLabel, active === tab.key && styles.tabLabelActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** Заблокований Pro-блок: розмитий фейковий контент + оверлей з lock-іконкою */
function LockedProBlock({ t, label }) {
  return (
    <View style={styles.lockWrapper}>
      {/* Фейковий контент (майже прозорий) для ілюзії розмиття */}
      <View style={styles.lockBlurred}>
        {[65, 40, 80, 30, 55].map((h, i) => (
          <View key={i} style={[styles.lockFakeBar, { height: h }]} />
        ))}
      </View>
      {/* Оверлей */}
      <View style={styles.lockOverlay}>
        <View style={styles.lockBadge}>
          <Ionicons name="lock-closed" size={18} color="#ca8a04" />
        </View>
        <Text style={styles.lockTitle}>{label}</Text>
        <Text style={styles.lockSubtitle}>{t("profile.pro_lock_subtitle")}</Text>
        <TouchableOpacity style={styles.lockCta} activeOpacity={0.8}>
          <Text style={styles.lockCtaText}>{t("profile.pro_lock_cta")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Горизонтальна смуга фактора для Weakness Map */
function FactorBarLocal({ label, value, color }) {
  return (
    <View style={styles.factorRow}>
      <Text style={styles.factorLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.factorTrack}>
        <View
          style={[
            styles.factorFill,
            { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color },
          ]}
        />
      </View>
      <Text style={styles.factorValue}>{value}</Text>
    </View>
  );
}

// ─── Головний компонент ───────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const { t, locale, setLocale } = useI18n();
  const { user, signOut }        = useAuth();
  const insets                   = useSafeAreaInsets();

  const [profileData, setProfileData]         = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [activeTab, setActiveTab]             = useState("overview");
  const [growthWindow, setGrowthWindow]       = useState(7);

  // Поточна мова
  const currentLang = [...AVAILABLE_LANGUAGES, ...PLANNED_LANGUAGES].find(
    (l) => l.code === locale
  );

  // Завантаження профілю
  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchMyProfile();
      setProfileData(data);
    } catch {
      setProfileData({ subscription_plan: "free", streak: 0, cefr_distribution: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  // Дані з user object
  const profile = useMemo(() => {
    const email = user?.email || user?.user_metadata?.email || null;
    const providers = user?.app_metadata?.providers || [];
    const provider =
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

  // ── Похідні дані ────────────────────────────────────────────────────────────
  const plan   = profileData?.subscription_plan ?? "free";
  const isPro  = plan === "pro";
  const streak = profileData?.streak ?? 0;

  // CEFR
  const cefrRaw  = profileData?.cefr_distribution ?? {};
  const cefrDist = CEFR_ORDER.reduce((acc, lvl) => {
    acc[lvl] = cefrRaw[lvl] ?? 0;
    return acc;
  }, {});
  const totalWords = Object.values(cefrDist).reduce((s, n) => s + n, 0);
  const maxCount   = Math.max(...Object.values(cefrDist), 1);

  // Most Active Level
  const mostActiveLevel = totalWords > 0
    ? CEFR_ORDER.reduce(
        (best, lvl) => (cefrDist[lvl] ?? 0) > (cefrDist[best] ?? 0) ? lvl : best,
        CEFR_ORDER[0]
      )
    : null;

  // Word State Distribution
  const wordStateDist = profileData?.word_state_distribution ?? {
    new: 0, learning: 0, stabilizing: 0, mastered: 0, decaying: 0, total: 0,
  };

  // Vocab Growth
  const vocabGrowth30 = profileData?.vocab_growth ?? [];
  const vocabGrowth   = growthWindow === 7 ? vocabGrowth30.slice(-7) : vocabGrowth30;
  const growthMax     = Math.max(...vocabGrowth.map((d) => d.count), 1);
  const vocabVelocity = profileData?.vocab_velocity ?? { last_7_days: 0, last_30_days: 0 };

  // Review Activity
  const reviewActivity = profileData?.review_activity ?? {
    total_reviews: 0, correct: 0, incorrect: 0, accuracy_pct: null,
  };

  // Difficulty (Pro)
  const difficultyOverview = profileData?.difficulty_overview ?? null;
  const weaknessMap        = profileData?.weakness_map ?? null;

  // Plan badge config
  const PLAN_CONFIG = {
    free: { emoji: t("profile.plan_free_emoji"), label: t("profile.plan_free"), color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    pro:  { emoji: t("profile.plan_pro_emoji"),  label: t("profile.plan_pro"),  color: "#ca8a04", bg: "#fefce8", border: "#fde68a" },
  };
  const planCfg = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;

  // ── Render ──────────────────────────────────────────────────────────────────
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

        {/* ── 2. Картка профілю ── */}
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
                {profile.fullName || t("profile.signed_in")}
              </Text>
              <Text style={styles.profileEmail} numberOfLines={1}>
                {profile.email || "—"}
              </Text>
            </View>
            <TouchableOpacity style={styles.signOutPill} onPress={signOut} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={14} color="#dc2626" />
              <Text style={styles.signOutPillText}>{t("profile.sign_out")}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── 3. Стрік ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("profile.streak_section")}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
          ) : streak > 0 ? (
            <View style={styles.streakContent}>
              <Text style={styles.streakNumber}>{streak}</Text>
              <Text style={styles.streakLabel}>{t("profile.streak", { count: streak })} 🔥</Text>
            </View>
          ) : (
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

        {/* ── 4. Word State Distribution ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("profile.word_states_section")}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
          ) : (
            <View style={styles.statePillsRow}>
              {STATE_ORDER.map((state) => {
                const count = wordStateDist[state] ?? 0;
                const total = wordStateDist.total || 1;
                const pct   = Math.round((count / total) * 100);
                return (
                  <View key={state} style={styles.statePill}>
                    <View style={[styles.stateDot, { backgroundColor: STATE_COLORS[state] }]} />
                    <Text style={[styles.stateCount, { color: STATE_COLORS[state] }]}>{count}</Text>
                    <Text style={styles.stateLabel}>{t(`word.state_${state}`)}</Text>
                    {isPro && wordStateDist.total > 0 && (
                      <View style={styles.stateBarTrack}>
                        <View
                          style={[
                            styles.stateBarFill,
                            { width: `${pct}%`, backgroundColor: STATE_COLORS[state] },
                          ]}
                        />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* ── 5. Most Active Level (inline) ── */}
        {!loading && mostActiveLevel && (
          <View style={[styles.card, styles.mostActiveCard]}>
            <Text style={styles.sectionLabel}>{t("profile.most_active_label")}</Text>
            <View style={styles.mostActiveRow}>
              <View
                style={[
                  styles.mostActiveBadge,
                  {
                    backgroundColor: (CEFR_COLORS[mostActiveLevel] || "#94a3b8") + "22",
                    borderColor:     (CEFR_COLORS[mostActiveLevel] || "#94a3b8") + "55",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.mostActiveBadgeText,
                    { color: CEFR_COLORS[mostActiveLevel] || "#94a3b8" },
                  ]}
                >
                  {mostActiveLevel}
                </Text>
              </View>
              <Text style={styles.mostActiveSubtext}>
                {cefrDist[mostActiveLevel]} {t("profile.most_active_desc")}
              </Text>
            </View>
          </View>
        )}

        {/* ── 6. CEFR chart ── */}
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>{t("profile.words_by_level")}</Text>
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
          ) : totalWords === 0 ? (
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
            <View style={styles.levelsChart}>
              {CEFR_ORDER.map((level) => {
                const count = cefrDist[level] ?? 0;
                const barH  = count > 0 ? Math.max(Math.round((count / maxCount) * 72), 8) : 4;
                return (
                  <View key={level} style={styles.levelColumn}>
                    <View
                      style={[
                        styles.levelBar,
                        {
                          height:          barH,
                          backgroundColor: count > 0 ? (CEFR_COLORS[level] || "#94a3b8") + "22" : COLORS.borderLight,
                          borderColor:     count > 0 ? (CEFR_COLORS[level] || "#94a3b8") + "44" : COLORS.borderLight,
                          borderWidth:     1,
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

        {/* ── 7. Tab Switcher ── */}
        <TabSwitcherBar active={activeTab} onChange={setActiveTab} t={t} />

        {/* ── Tab: Overview ── */}
        {activeTab === "overview" && (
          <>
            {/* Vocab Growth chart */}
            <View style={styles.card}>
              <View style={styles.growthHeaderRow}>
                <Text style={styles.sectionLabel}>{t("profile.vocab_growth_section")}</Text>
                <View style={styles.windowToggle}>
                  {[7, 30].map((w) => (
                    <TouchableOpacity
                      key={w}
                      style={[styles.windowBtn, growthWindow === w && styles.windowBtnActive]}
                      onPress={() => setGrowthWindow(w)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.windowBtnText, growthWindow === w && styles.windowBtnTextActive]}>
                        {w === 7 ? "7D" : "30D"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              {loading ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
              ) : (
                <>
                  <View style={styles.growthChart}>
                    {vocabGrowth.map((day, i) => {
                      const isToday = i === vocabGrowth.length - 1;
                      const barH    = day.count > 0
                        ? Math.max(Math.round((day.count / growthMax) * 56), 4)
                        : 2;
                      return (
                        <View key={day.date} style={styles.growthColumn}>
                          <View
                            style={[
                              styles.growthBar,
                              {
                                height:          barH,
                                backgroundColor: isToday
                                  ? COLORS.primary
                                  : day.count > 0
                                    ? COLORS.primary + "44"
                                    : COLORS.borderLight,
                              },
                            ]}
                          />
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.growthDateRow}>
                    <Text style={styles.growthDateLabel}>
                      {formatDayLabel(vocabGrowth[0]?.date)}
                    </Text>
                    <Text style={styles.growthDateLabel}>
                      {formatDayLabel(vocabGrowth[Math.floor(vocabGrowth.length / 2)]?.date)}
                    </Text>
                    <Text style={styles.growthDateLabel}>{t("profile.vocab_growth_today")}</Text>
                  </View>
                </>
              )}
            </View>

            {/* Vocabulary Velocity */}
            {isPro ? (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>{t("profile.pro_velocity_lock")}</Text>
                {loading ? (
                  <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
                ) : (
                  <View style={styles.velocityRow}>
                    <View style={styles.velocityPill}>
                      <Text style={styles.velocityNumber}>+{vocabVelocity.last_7_days}</Text>
                      <Text style={styles.velocityLabel}>{t("profile.velocity_week")}</Text>
                    </View>
                    <View style={styles.velocityPill}>
                      <Text style={styles.velocityNumber}>+{vocabVelocity.last_30_days}</Text>
                      <Text style={styles.velocityLabel}>{t("profile.velocity_month")}</Text>
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <LockedProBlock t={t} label={t("profile.pro_velocity_lock")} />
            )}
          </>
        )}

        {/* ── Tab: Activity ── */}
        {activeTab === "activity" && (
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>{t("profile.review_activity_section")}</Text>
            {loading ? (
              <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
            ) : reviewActivity.total_reviews === 0 ? (
              <View style={styles.cefrEmpty}>
                <Text style={styles.cefrEmptyIcon}>📖</Text>
                <Text style={styles.cefrEmptyText}>{t("profile.streak_empty_title")}</Text>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => navigation.navigate("Practice")}
                  activeOpacity={0.7}
                >
                  <Text style={styles.emptyBtnText}>{t("profile.streak_empty_btn")}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.activityRow}>
                  <View style={styles.activityStat}>
                    <Text style={styles.activityBigNum}>{reviewActivity.total_reviews}</Text>
                    <Text style={styles.activityStatLabel}>{t("profile.reviews_total")}</Text>
                  </View>
                  <View style={styles.activityDivider} />
                  <View style={styles.activityStat}>
                    <Text style={[styles.activityBigNum, { color: "#16a34a" }]}>
                      {reviewActivity.correct}
                    </Text>
                    <Text style={styles.activityStatLabel}>{t("profile.reviews_correct")}</Text>
                  </View>
                  <View style={styles.activityDivider} />
                  <View style={styles.activityStat}>
                    <Text style={[styles.activityBigNum, { color: "#dc2626" }]}>
                      {reviewActivity.incorrect}
                    </Text>
                    <Text style={styles.activityStatLabel}>{t("profile.reviews_incorrect")}</Text>
                  </View>
                </View>
                {reviewActivity.accuracy_pct != null && (
                  <View style={{ marginTop: 4 }}>
                    <View style={styles.accuracyLabelRow}>
                      <Text style={styles.sectionLabel}>{t("profile.reviews_accuracy")}</Text>
                      <Text style={styles.sectionLabel}>{reviewActivity.accuracy_pct}%</Text>
                    </View>
                    <View style={styles.accuracyTrack}>
                      <View
                        style={[
                          styles.accuracyFill,
                          {
                            width:           `${reviewActivity.accuracy_pct}%`,
                            backgroundColor: reviewActivity.accuracy_pct >= 70 ? "#16a34a" : "#ca8a04",
                          },
                        ]}
                      />
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ── Tab: Difficulty ── */}
        {activeTab === "difficulty" && (
          isPro ? (
            <>
              {/* Personal Difficulty Overview */}
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>{t("profile.difficulty_overview_section")}</Text>
                {loading ? (
                  <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
                ) : !difficultyOverview ? (
                  <View style={styles.cefrEmpty}>
                    <Text style={styles.cefrEmptyIcon}>🔍</Text>
                    <Text style={styles.cefrEmptyText}>{t("profile.diff_no_data")}</Text>
                  </View>
                ) : (
                  <View style={styles.diffPillsRow}>
                    <View style={styles.diffPill}>
                      <Text style={styles.diffPillLabel}>{t("word.base_score")}</Text>
                      <Text style={styles.diffPillValue}>{difficultyOverview.avg_base_score}</Text>
                    </View>
                    <View style={[styles.diffPill, styles.diffPillPersonal]}>
                      <Text style={styles.diffPillLabel}>{t("word.personal_score")}</Text>
                      <Text style={[styles.diffPillValue, { color: "#7c3aed" }]}>
                        {difficultyOverview.avg_personal_score}
                      </Text>
                    </View>
                    <View style={styles.diffPill}>
                      <Text style={styles.diffPillLabel}>{t("profile.diff_trend")}</Text>
                      <Text style={[
                        styles.diffPillTrend,
                        difficultyOverview.dominant_trend === "easier" && { color: "#16a34a" },
                        difficultyOverview.dominant_trend === "harder" && { color: "#dc2626" },
                      ]}>
                        {difficultyOverview.dominant_trend === "easier" ? "↗"
                          : difficultyOverview.dominant_trend === "harder" ? "↘" : "→"}
                      </Text>
                    </View>
                  </View>
                )}
              </View>

              {/* Weakness Map */}
              {!loading && difficultyOverview && (
                <View style={styles.card}>
                  <Text style={styles.sectionLabel}>{t("profile.weakness_map_section")}</Text>
                  <Text style={styles.weaknessHint}>{t("profile.weakness_map_hint")}</Text>
                  {WEAKNESS_FACTORS.map((factor) => {
                    const data = weaknessMap?.[factor.key];
                    if (!data) return null;
                    // delta>0 → важче за avg; delta<0 → легше; centre = 50
                    const displayVal = Math.min(100, Math.max(0, 50 + (data.avg_delta ?? 0)));
                    const barColor   =
                      data.avg_delta > 5  ? "#dc2626" :
                      data.avg_delta < -5 ? "#16a34a" : COLORS.primary;
                    return (
                      <FactorBarLocal
                        key={factor.key}
                        label={t(factor.i18nKey)}
                        value={displayVal}
                        color={barColor}
                      />
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <LockedProBlock t={t} label={t("profile.pro_difficulty_lock")} />
          )
        )}

        {/* ── 8. Налаштування ── */}
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

        {/* ── 9. Рядок-тригер мови ── */}
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
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t("profile.language_section")}</Text>
              <TouchableOpacity onPress={() => setLangModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
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

  // ── Shared card ──
  card: {
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
  sectionLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: "500",
    marginBottom: 14,
    textTransform: "uppercase",
  },

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
  streakContent: { alignItems: "center", paddingTop: 4 },
  streakNumber:  { fontSize: 42, fontWeight: "300", color: "#ea580c", fontFamily: "Courier" },
  streakLabel:   { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
  streakEmpty:   { alignItems: "center", paddingTop: 8, paddingBottom: 4 },
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

  // ── Word State Distribution ──
  statePillsRow: { flexDirection: "row", gap: 4 },
  statePill:     { flex: 1, alignItems: "center", gap: 3 },
  stateDot:      { width: 8, height: 8, borderRadius: 4 },
  stateCount:    { fontSize: 15, fontWeight: "700", fontFamily: "Courier" },
  stateLabel:    { fontSize: 8, color: COLORS.textMuted, textAlign: "center" },
  stateBarTrack: { width: "100%", height: 3, backgroundColor: COLORS.borderLight, borderRadius: 2, marginTop: 2 },
  stateBarFill:  { height: 3, borderRadius: 2 },

  // ── Most Active Level ──
  mostActiveCard:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: SPACING.md },
  mostActiveRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  mostActiveBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, borderWidth: 1 },
  mostActiveBadgeText: { fontSize: 13, fontWeight: "700", fontFamily: "Courier" },
  mostActiveSubtext:   { fontSize: 12, color: COLORS.textMuted },

  // ── CEFR chart ──
  levelsChart: { flexDirection: "row", gap: 8, alignItems: "flex-end", height: 88 },
  levelColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  levelBar:    { width: "100%", borderRadius: 6, justifyContent: "center", alignItems: "center" },
  levelCount:  { fontSize: 11, fontWeight: "700", fontFamily: "Courier" },
  levelLabel:  { fontSize: 10, color: COLORS.textMuted, fontFamily: "Courier", marginTop: 6 },
  cefrEmpty:   { alignItems: "center", paddingTop: 4, paddingBottom: 4 },
  cefrEmptyIcon: { fontSize: 28, marginBottom: 6 },
  cefrEmptyText: { fontSize: 13, color: COLORS.textSecondary, textAlign: "center", marginBottom: 12 },

  // ── Tab Switcher ──
  tabBar:        { flexDirection: "row", backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: COLORS.borderLight, padding: 3, marginBottom: 10 },
  tabBtn:        { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: BORDER_RADIUS.md },
  tabBtnActive:  { backgroundColor: COLORS.primary },
  tabLabel:      { fontSize: 12, fontWeight: "500", color: COLORS.textMuted },
  tabLabelActive:{ color: "#ffffff", fontWeight: "600" },

  // ── Vocab Growth ──
  growthHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 0 },
  windowToggle:    { flexDirection: "row", gap: 4 },
  windowBtn:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.sm, borderWidth: 1, borderColor: COLORS.borderLight },
  windowBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  windowBtnText:   { fontSize: 11, fontWeight: "600", color: COLORS.textMuted },
  windowBtnTextActive: { color: "#ffffff" },
  growthChart:     { flexDirection: "row", gap: 3, alignItems: "flex-end", height: 64, marginTop: 12, marginBottom: 6 },
  growthColumn:    { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  growthBar:       { width: "100%", borderRadius: 3 },
  growthDateRow:   { flexDirection: "row", justifyContent: "space-between" },
  growthDateLabel: { fontSize: 9, color: COLORS.textHint, fontFamily: "Courier" },

  // ── Velocity ──
  velocityRow:    { flexDirection: "row", gap: 10 },
  velocityPill:   { flex: 1, backgroundColor: COLORS.background, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, alignItems: "center", borderWidth: 1, borderColor: COLORS.borderLight },
  velocityNumber: { fontSize: 22, fontWeight: "700", color: COLORS.primary, fontFamily: "Courier" },
  velocityLabel:  { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },

  // ── Activity ──
  activityRow:       { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  activityStat:      { flex: 1, alignItems: "center" },
  activityBigNum:    { fontSize: 28, fontWeight: "300", color: COLORS.primary, fontFamily: "Courier" },
  activityStatLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  activityDivider:   { width: 1, height: 40, backgroundColor: COLORS.borderLight },
  accuracyLabelRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  accuracyTrack:     { height: 6, backgroundColor: COLORS.borderLight, borderRadius: 3, overflow: "hidden" },
  accuracyFill:      { height: 6, borderRadius: 3 },

  // ── Difficulty tab ──
  diffPillsRow:    { flexDirection: "row", gap: 8 },
  diffPill:        { flex: 1, backgroundColor: COLORS.background, borderRadius: BORDER_RADIUS.md, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", borderWidth: 1, borderColor: COLORS.borderLight },
  diffPillPersonal:{ borderColor: "#c084fc", backgroundColor: "#faf5ff" },
  diffPillLabel:   { fontSize: 10, color: COLORS.textMuted, marginBottom: 4, textAlign: "center" },
  diffPillValue:   { fontSize: 18, fontWeight: "700", color: COLORS.primary, fontFamily: "Courier" },
  diffPillTrend:   { fontSize: 22, fontWeight: "300", color: COLORS.textMuted, fontFamily: "Courier" },

  // ── Weakness Map ──
  weaknessHint: { fontSize: 11, color: COLORS.textHint, fontStyle: "italic", marginBottom: 10, marginTop: -8 },
  factorRow:    { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  factorLabel:  { width: 82, fontSize: 11, color: COLORS.textMuted },
  factorTrack:  { flex: 1, height: 6, backgroundColor: COLORS.borderLight, borderRadius: 3, overflow: "hidden" },
  factorFill:   { height: 6, borderRadius: 3 },
  factorValue:  { width: 28, fontSize: 11, color: COLORS.textMuted, textAlign: "right", fontFamily: "Courier" },

  // ── Pro Lock Overlay ──
  lockWrapper:  { borderRadius: BORDER_RADIUS.lg, borderWidth: 1, borderColor: "#fde68a", backgroundColor: COLORS.surface, marginBottom: 10, overflow: "hidden", minHeight: 140 },
  lockBlurred:  { position: "absolute", top: 12, left: 16, right: 16, flexDirection: "row", alignItems: "flex-end", gap: 8, opacity: 0.12 },
  lockFakeBar:  { flex: 1, borderRadius: 4, backgroundColor: COLORS.primary },
  lockOverlay:  { alignItems: "center", paddingVertical: 24, paddingHorizontal: 20, gap: 6 },
  lockBadge:    { width: 36, height: 36, borderRadius: 18, backgroundColor: "#fefce8", borderWidth: 1, borderColor: "#fde68a", alignItems: "center", justifyContent: "center", marginBottom: 2 },
  lockTitle:    { fontSize: 15, fontWeight: "600", color: COLORS.primary, textAlign: "center" },
  lockSubtitle: { fontSize: 12, color: COLORS.textMuted, textAlign: "center" },
  lockCta:      { marginTop: 8, paddingVertical: 8, paddingHorizontal: 20, borderRadius: BORDER_RADIUS.md, backgroundColor: "#ca8a04" },
  lockCtaText:  { fontSize: 13, color: "#ffffff", fontWeight: "600" },

  // ── Налаштування ──
  settingsCard:  {
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

  // ── Тригер мови ──
  langTriggerRight:  { flexDirection: "row", alignItems: "center", gap: 6 },
  langTriggerValue:  { fontSize: 14, color: COLORS.textMuted },

  // ── Modal ──
  modalContainer: { flex: 1, backgroundColor: COLORS.background, paddingHorizontal: SPACING.xl, paddingTop: SPACING.xl },
  modalHeader:    { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 },
  modalTitle:     { fontSize: 18, fontWeight: "600", color: COLORS.primary },
  langGroupLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", letterSpacing: 0.8, marginBottom: 6 },
  langGroup:      { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, paddingHorizontal: SPACING.xl, borderWidth: 1, borderColor: COLORS.borderLight },
  langItem:       { flexDirection: "row", alignItems: "center", paddingVertical: 13, gap: 12 },
  langItemBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.borderLight },
  langItemDisabled: { opacity: 0.4 },
  langFlag:       { fontSize: 20 },
  langLabel:      { flex: 1, fontSize: 15, color: COLORS.textSecondary, fontWeight: "400" },
  langLabelActive:   { color: COLORS.primary, fontWeight: "600" },
  langLabelDisabled: { color: COLORS.textMuted },
  langComingSoon:    { fontSize: 12, color: COLORS.textHint, fontStyle: "italic" },
});
