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
 *     - Overview: Vocab Growth chart (7D/30D, tap bar = tooltip) + Velocity (Pro) або locked
 *     - Activity:  Review stats + Accuracy bar + Mistake Heatmap
 *     - Difficulty: Difficulty Overview + Weakness Map з info-tooltips (Pro) або locked
 *  8. Налаштування
 *  9. Рядок-тригер мови + Modal
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth }  from "../hooks/useAuth";
import { useI18n } from "../i18n";
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from "../utils/constants";
import { fetchMyProfile } from "../services/profileService";

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
  { key: "frequency_band",   i18nKey: "word.factor_freq",   infoKey: "profile.factor_freq_info"   },
  { key: "polysemy_level",   i18nKey: "word.factor_poly",   infoKey: "profile.factor_poly_info"   },
  { key: "morph_complexity", i18nKey: "word.factor_morph",  infoKey: "profile.factor_morph_info"  },
  { key: "phrase_flag",      i18nKey: "word.factor_phrase", infoKey: "profile.factor_phrase_info" },
];

// ALE factor definitions — map skill_profile field → i18n keys + info
const ALE_FACTORS = [
  { scoreKey: "frequency_score", labelKey: "profile.ale_factor_frequency", infoKey: "profile.ale_factor_freq_info", icon: "📊" },
  { scoreKey: "polysemy_score",  labelKey: "profile.ale_factor_polysemy",  infoKey: "profile.ale_factor_poly_info", icon: "🔀" },
  { scoreKey: "morph_score",     labelKey: "profile.ale_factor_morphology",infoKey: "profile.ale_factor_morph_info",icon: "🔤" },
  { scoreKey: "idiom_score",     labelKey: "profile.ale_factor_idiom",     infoKey: "profile.ale_factor_idiom_info",icon: "💬" },
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
function LockedProBlock({ t, label, onUnlock }) {
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
        <TouchableOpacity style={styles.lockCta} activeOpacity={0.8} onPress={onUnlock}>
          <Text style={styles.lockCtaText}>{t("profile.pro_lock_cta")}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Горизонтальна смуга фактора для Weakness Map з кнопкою ⓘ */
function FactorBarLocal({ label, value, color, avgDelta, infoText }) {
  const [infoVisible, setInfoVisible] = useState(false);
  const infoTimerRef = useRef(null);

  useEffect(() => {
    if (infoTimerRef.current) clearTimeout(infoTimerRef.current);
    if (infoVisible) {
      infoTimerRef.current = setTimeout(() => setInfoVisible(false), 6000);
    }
    return () => { if (infoTimerRef.current) clearTimeout(infoTimerRef.current); };
  }, [infoVisible]);

  // Текст-підказка: +N harder / -N easier / neutral
  const deltaLabel =
    avgDelta > 5  ? `+${avgDelta} pts` :
    avgDelta < -5 ? `${avgDelta} pts` :
    "~0 pts";
  const deltaColor =
    avgDelta > 5  ? "#dc2626" :
    avgDelta < -5 ? "#16a34a" :
    COLORS.textMuted;

  return (
    <View style={{ marginBottom: 12 }}>
      {/* Рядок: label + ⓘ + bar + value */}
      <View style={styles.factorRow}>
        <View style={styles.factorLabelWrap}>
          <Text style={styles.factorLabel} numberOfLines={1}>{label}</Text>
          <TouchableOpacity
            onPress={() => setInfoVisible((v) => !v)}
            hitSlop={8}
            activeOpacity={0.7}
          >
            <Ionicons
              name={infoVisible ? "information-circle" : "information-circle-outline"}
              size={14}
              color={infoVisible ? COLORS.primary : COLORS.textHint}
            />
          </TouchableOpacity>
        </View>
        <View style={styles.factorTrack}>
          <View
            style={[
              styles.factorFill,
              { width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color },
            ]}
          />
          {/* Центральна лінія (50%) */}
          <View style={styles.factorCenter} />
        </View>
        <Text style={[styles.factorDelta, { color: deltaColor }]}>{deltaLabel}</Text>
      </View>
      {/* Розгорнутий tooltip */}
      {infoVisible && (
        <View style={styles.factorInfoBox}>
          <Text style={styles.factorInfoText}>{infoText}</Text>
        </View>
      )}
    </View>
  );
}

/**
 * AleScoreBar — Один рядок ALE skill profile:
 *   icon · label ⓘ  ──────■───── [Weakness / Strength / Developing] (+3 pts)
 * Score range: -100…+100. Bar centred at 50%, green=positive, red=negative.
 */
function AleScoreBar({ icon, label, score, infoText, t }) {
  const [infoVisible, setInfoVisible] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (infoVisible) {
      timerRef.current = setTimeout(() => setInfoVisible(false), 6000);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [infoVisible]);

  // Map score -100…+100 → bar fill 0…100%
  const fillPct  = Math.round(Math.min(100, Math.max(0, 50 + score / 2)));
  const isStrength = score > 15;
  const isWeak     = score < -15;
  const barColor   = isStrength ? "#16a34a" : isWeak ? "#dc2626" : COLORS.primary;
  const statusKey  = isStrength ? "ale_score_strength" : isWeak ? "ale_score_weakness" : "ale_score_neutral";
  const statusColor= isStrength ? "#16a34a" : isWeak ? "#dc2626" : COLORS.textMuted;
  const scoreLabel = score >= 0 ? `+${score}` : `${score}`;

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={styles.factorRow}>
        {/* Icon + Label + ⓘ */}
        <View style={styles.factorLabelWrap}>
          <Text style={{ fontSize: 13, marginRight: 2 }}>{icon}</Text>
          <Text style={styles.factorLabel} numberOfLines={1}>{label}</Text>
          <TouchableOpacity onPress={() => setInfoVisible(v => !v)} hitSlop={8} activeOpacity={0.7}>
            <Ionicons
              name={infoVisible ? "information-circle" : "information-circle-outline"}
              size={14}
              color={infoVisible ? COLORS.primary : COLORS.textHint}
            />
          </TouchableOpacity>
        </View>
        {/* Bar */}
        <View style={styles.factorTrack}>
          <View style={[styles.factorFill, { width: `${fillPct}%`, backgroundColor: barColor }]} />
          <View style={styles.factorCenter} />
        </View>
        {/* Score */}
        <Text style={[styles.factorDelta, { color: barColor }]}>{scoreLabel}</Text>
      </View>
      {/* Status chip */}
      <View style={styles.aleStatusRow}>
        <Text style={[styles.aleStatusText, { color: statusColor }]}>
          {t(`profile.${statusKey}`)}
        </Text>
      </View>
      {/* Info tooltip */}
      {infoVisible && (
        <View style={styles.factorInfoBox}>
          <Text style={styles.factorInfoText}>{infoText}</Text>
        </View>
      )}
    </View>
  );
}

/** Один бар у Vocab Growth chart з тап-tooltip */
function GrowthBarWithTooltip({ day, barH, isToday, t }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const growthTimerRef = useRef(null);
  const hasData = day.count > 0;

  useEffect(() => {
    if (growthTimerRef.current) clearTimeout(growthTimerRef.current);
    if (tooltipVisible) {
      growthTimerRef.current = setTimeout(() => setTooltipVisible(false), 3000);
    }
    return () => { if (growthTimerRef.current) clearTimeout(growthTimerRef.current); };
  }, [tooltipVisible]);

  return (
    <View style={styles.growthColumn}>
      {/* Tooltip: абсолютно над баром */}
      {tooltipVisible && (
        <View style={[styles.growthTooltip, { bottom: barH + 6 }]}>
          <Text style={styles.growthTooltipDate}>{formatDayLabel(day.date)}</Text>
          <Text style={styles.growthTooltipCount}>
            {day.count} {day.count === 1 ? "word" : "words"}
          </Text>
        </View>
      )}
      <TouchableOpacity
        style={{ width: "100%", alignItems: "center" }}
        onPress={() => hasData && setTooltipVisible((v) => !v)}
        activeOpacity={hasData ? 0.7 : 1}
      >
        <View
          style={[
            styles.growthBar,
            {
              height: barH,
              backgroundColor: isToday
                ? COLORS.primary
                : hasData
                  ? COLORS.primary + "55"
                  : COLORS.borderLight,
            },
          ]}
        />
      </TouchableOpacity>
    </View>
  );
}

/** Клітинка теплової карти помилок */
function HeatmapCell({ day, t }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const heatTimerRef = useRef(null);

  useEffect(() => {
    if (heatTimerRef.current) clearTimeout(heatTimerRef.current);
    if (tooltipVisible) {
      heatTimerRef.current = setTimeout(() => setTooltipVisible(false), 3000);
    }
    return () => { if (heatTimerRef.current) clearTimeout(heatTimerRef.current); };
  }, [tooltipVisible]);

  const getCellColor = () => {
    if (!day || day.total === 0) return COLORS.borderLight;
    const acc = day.accuracy_pct;
    if (acc >= 80) return "#16a34a44"; // зелений
    if (acc >= 60) return "#ca8a0444"; // жовтий
    return "#dc262644";               // червоний
  };

  const getBorderColor = () => {
    if (!day || day.total === 0) return COLORS.borderLight;
    const acc = day.accuracy_pct;
    if (acc >= 80) return "#16a34a88";
    if (acc >= 60) return "#ca8a0488";
    return "#dc262688";
  };

  return (
    <TouchableOpacity
      onPress={() => day.total > 0 && setTooltipVisible((v) => !v)}
      activeOpacity={day.total > 0 ? 0.7 : 1}
      style={{ position: "relative" }}
    >
      <View
        style={[
          styles.heatCell,
          { backgroundColor: getCellColor(), borderColor: getBorderColor() },
        ]}
      />
      {tooltipVisible && (
        <View style={styles.heatTooltip}>
          <Text style={styles.heatTooltipDate}>{formatDayLabel(day.date)}</Text>
          <Text style={styles.heatTooltipLine}>
            {t("profile.heatmap_words", { count: day.total })}
          </Text>
          <Text style={styles.heatTooltipLine}>
            {t("profile.heatmap_accuracy", { pct: day.accuracy_pct })}
          </Text>
          <TouchableOpacity
            onPress={() => setTooltipVisible(false)}
            style={styles.heatTooltipClose}
          >
            <Ionicons name="close" size={10} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

/** Порожній стан для вкладок (новий акаунт / немає даних) */
function EmptyTabState({ icon, title, subtitle, btnLabel, onBtnPress }) {
  return (
    <View style={styles.emptyTabState}>
      <Text style={styles.emptyTabIcon}>{icon}</Text>
      <Text style={styles.emptyTabTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptyTabSub}>{subtitle}</Text> : null}
      {btnLabel && onBtnPress ? (
        <TouchableOpacity style={styles.emptyBtn} onPress={onBtnPress} activeOpacity={0.7}>
          <Text style={styles.emptyBtnText}>{btnLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ─── Головний компонент ───────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const { t }    = useI18n();
  const { user } = useAuth();

  const [profileData, setProfileData]         = useState(null);
  const [loading, setLoading]                 = useState(true);
  const [activeTab, setActiveTab]             = useState("overview");
  const [growthWindow, setGrowthWindow]       = useState(7);

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

  // Usage counters (for Free plan card)
  const usage = profileData?.usage ?? null;

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

  // ALE Skill Profile (all users — data is public, engine is Pro)
  const skillProfile = profileData?.skill_profile ?? null;
  const hasSkillData = skillProfile && (skillProfile.total_updates ?? 0) > 0;

  // Mistake Heatmap (30 днів)
  const mistakeHeatmap30 = profileData?.mistake_heatmap ?? [];
  const mistakeHeatmap   = growthWindow === 7 ? mistakeHeatmap30.slice(-7) : mistakeHeatmap30;

  // Plan badge config
  const PLAN_CONFIG = {
    free: { emoji: t("profile.plan_free_emoji"), label: t("profile.plan_free"), color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
    pro:  { emoji: t("profile.plan_pro_emoji"),  label: t("profile.plan_pro"),  color: "#ca8a04", bg: "#fefce8", border: "#fde68a" },
  };
  const planCfg = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free;

  // Navigate to ProScreen (in the same stack)
  const openProScreen = useCallback(() => {
    navigation.navigate("ProScreen");
  }, [navigation]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{t("profile.title")}</Text>
        </View>

        {/* ── 1. Plan badge ── */}
        <TouchableOpacity
          style={[styles.planCard, { backgroundColor: planCfg.bg, borderColor: planCfg.border }]}
          onPress={!isPro ? openProScreen : undefined}
          activeOpacity={!isPro ? 0.75 : 1}
        >
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.textMuted} />
          ) : (
            <View style={styles.planRow}>
              <Text style={styles.planEmoji}>{planCfg.emoji}</Text>
              <View style={styles.planTextWrap}>
                <Text style={styles.planSublabel}>{t("profile.plan_label")}</Text>
                <Text style={[styles.planName, { color: planCfg.color }]}>{planCfg.label}</Text>
                {!isPro && usage && (
                  <Text style={styles.planUsageRow}>
                    {t("profile.usage_saves", { used: usage.saves_today ?? 0, max: usage.saves_limit ?? 10 })}
                    {"  ·  "}
                    {t("profile.usage_ai", { used: usage.ai_requests_today ?? 0, max: usage.ai_limit ?? 5 })}
                  </Text>
                )}
              </View>
              {!isPro && (
                <View style={styles.planUpgradeChip}>
                  <Text style={styles.planUpgradeChipText}>{t("profile.plan_upgrade_cta")}</Text>
                </View>
              )}
            </View>
          )}
        </TouchableOpacity>

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
            <TouchableOpacity
              style={styles.settingsGear}
              onPress={() => navigation.navigate("Settings")}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <Ionicons name="settings-outline" size={22} color={COLORS.textSecondary} />
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
              ) : vocabGrowth.every((d) => d.count === 0) ? (
                <EmptyTabState
                  icon="📈"
                  title={t("profile.vocab_growth_empty_title")}
                  subtitle={t("profile.vocab_growth_empty_sub")}
                  btnLabel={t("profile.cefr_empty_btn")}
                  onBtnPress={() => navigation.navigate("Translate")}
                />
              ) : (
                <>
                  <View style={styles.growthChart}>
                    {vocabGrowth.map((day, i) => {
                      const isToday = i === vocabGrowth.length - 1;
                      const barH    = day.count > 0
                        ? Math.max(Math.round((day.count / growthMax) * 56), 4)
                        : 2;
                      return (
                        <GrowthBarWithTooltip
                          key={day.date}
                          day={day}
                          barH={barH}
                          isToday={isToday}
                          t={t}
                        />
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
              <LockedProBlock t={t} label={t("profile.pro_velocity_lock")} onUnlock={openProScreen} />
            )}
          </>
        )}

        {/* ── Tab: Activity ── */}
        {activeTab === "activity" && (
          <>
            {/* Review Activity stats */}
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>{t("profile.review_activity_section")}</Text>
              {loading ? (
                <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginTop: 8 }} />
              ) : reviewActivity.total_reviews === 0 ? (
                <EmptyTabState
                  icon="📖"
                  title={t("profile.activity_empty_title")}
                  subtitle={t("profile.activity_empty_sub")}
                  btnLabel={t("profile.streak_empty_btn")}
                  onBtnPress={() => navigation.navigate("Practice")}
                />
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

            {/* Mistake Heatmap */}
            <View style={styles.card}>
              <View style={styles.growthHeaderRow}>
                <Text style={styles.sectionLabel}>{t("profile.heatmap_section")}</Text>
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
              ) : mistakeHeatmap.every((d) => d.total === 0) ? (
                <EmptyTabState
                  icon="📅"
                  title={t("profile.heatmap_empty_title")}
                  subtitle={t("profile.heatmap_empty_sub")}
                  btnLabel={t("profile.streak_empty_btn")}
                  onBtnPress={() => navigation.navigate("Practice")}
                />
              ) : (
                <>
                  <View style={styles.heatmapGrid}>
                    {mistakeHeatmap.map((day) => (
                      <HeatmapCell key={day.date} day={day} t={t} />
                    ))}
                  </View>
                  {/* Date labels: first / middle / last */}
                  <View style={styles.growthDateRow}>
                    <Text style={styles.growthDateLabel}>
                      {formatDayLabel(mistakeHeatmap[0]?.date)}
                    </Text>
                    <Text style={styles.growthDateLabel}>
                      {formatDayLabel(mistakeHeatmap[Math.floor(mistakeHeatmap.length / 2)]?.date)}
                    </Text>
                    <Text style={styles.growthDateLabel}>{t("profile.vocab_growth_today")}</Text>
                  </View>
                  {/* Legend: none → red → amber → green */}
                  <View style={styles.heatLegendRow}>
                    <Text style={styles.heatLegendLabel}>{t("profile.heatmap_empty_day")}</Text>
                    <View style={styles.heatLegendCells}>
                      <View style={[styles.heatLegendCell, { backgroundColor: COLORS.borderLight }]} />
                      <View style={[styles.heatLegendCell, { backgroundColor: "#dc262644", borderColor: "#dc262688" }]} />
                      <View style={[styles.heatLegendCell, { backgroundColor: "#ca8a0444", borderColor: "#ca8a0488" }]} />
                      <View style={[styles.heatLegendCell, { backgroundColor: "#16a34a44", borderColor: "#16a34a88" }]} />
                    </View>
                    <Text style={styles.heatLegendLabel}>100%</Text>
                  </View>
                </>
              )}
            </View>
          </>
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
                  <EmptyTabState
                    icon="🔍"
                    title={t("profile.diff_empty_title")}
                    subtitle={t("profile.diff_empty_sub")}
                    btnLabel={t("profile.streak_empty_btn")}
                    onBtnPress={() => navigation.navigate("Practice")}
                  />
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
                        avgDelta={data.avg_delta ?? 0}
                        infoText={t(factor.infoKey)}
                      />
                    );
                  })}
                </View>
              )}

            </>
          ) : (
            <LockedProBlock t={t} label={t("profile.pro_difficulty_lock")} onUnlock={openProScreen} />
          )
        )}

        {/* ── ALE Skill Profile (Difficulty tab, all users) ── */}
        {activeTab === "difficulty" && !loading && (
          <View style={styles.card}>
            {/* Header row: title + active badge (Pro) or lock chip */}
            <View style={styles.aleSectionHeader}>
              <Text style={styles.sectionLabel}>{t("profile.ale_section")}</Text>
              {isPro ? (
                <View style={styles.aleActiveBadge}>
                  <Text style={styles.aleActiveBadgeText}>{t("profile.ale_active_badge")}</Text>
                </View>
              ) : (
                <TouchableOpacity onPress={openProScreen} activeOpacity={0.8} style={styles.aleProChip}>
                  <Ionicons name="lock-closed" size={10} color="#ca8a04" />
                  <Text style={styles.aleProChipText}>Pro</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.weaknessHint}>{t("profile.ale_section_hint")}</Text>

            {hasSkillData ? (
              <>
                {ALE_FACTORS.map((factor) => {
                  const score = skillProfile[factor.scoreKey] ?? 0;
                  return (
                    <AleScoreBar
                      key={factor.scoreKey}
                      icon={factor.icon}
                      label={t(factor.labelKey)}
                      score={score}
                      infoText={t(factor.infoKey)}
                      t={t}
                    />
                  );
                })}
                <Text style={styles.aleUpdatesLabel}>
                  {t("profile.ale_updates_count", { count: skillProfile.total_updates ?? 0 })}
                </Text>
              </>
            ) : (
              <View style={styles.emptyTabState}>
                <Text style={styles.emptyTabIcon}>🧠</Text>
                <Text style={styles.emptyTabTitle}>{t("profile.ale_no_data")}</Text>
                <Text style={styles.emptyTabSub}>{t("profile.ale_no_data_sub")}</Text>
              </View>
            )}

            {/* Free CTA — show for all Free users */}
            {!isPro && (
              <TouchableOpacity style={styles.aleFreeCta} onPress={openProScreen} activeOpacity={0.85}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.aleFreeCtatitle}>{t("profile.ale_free_cta_title")}</Text>
                  <Text style={styles.aleFreeCtaBody}>{t("profile.ale_free_cta_body")}</Text>
                </View>
                <Text style={styles.aleFreeCtatBtn}>{t("profile.ale_free_cta_btn")}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── 8. Settings nav row ── */}
        <View style={styles.settingsCard}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => navigation.navigate("Settings")}
            activeOpacity={0.6}
          >
            <View style={styles.settingLeft}>
              <Ionicons name="settings-outline" size={20} color={COLORS.textSecondary} />
              <Text style={styles.settingLabel}>{t("settings.title")}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.textHint} />
          </TouchableOpacity>
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
  planSublabel:       { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", letterSpacing: 0.5 },
  planName:           { fontSize: 18, fontWeight: "700", marginTop: 1 },
  planUpgradeChip:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "#ca8a04" },
  planUpgradeChipText:{ fontSize: 11, fontWeight: "700", color: "#ffffff", letterSpacing: 0.3 },
  planUsageRow:       { fontSize: 11, color: COLORS.textMuted, marginTop: 3 },

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

  settingsGear: {
    padding: 4,
  },

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

  // ── EmptyTabState ──
  emptyTabState: { alignItems: "center", paddingVertical: 20, paddingHorizontal: 8, gap: 6 },
  emptyTabIcon:  { fontSize: 32, marginBottom: 2 },
  emptyTabTitle: { fontSize: 14, fontWeight: "600", color: COLORS.textSecondary, textAlign: "center" },
  emptyTabSub:   { fontSize: 12, color: COLORS.textMuted, textAlign: "center", lineHeight: 18, marginBottom: 8 },

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
  weaknessHint:    { fontSize: 11, color: COLORS.textHint, fontStyle: "italic", marginBottom: 10, marginTop: -8 },
  factorRow:       { flexDirection: "row", alignItems: "center", gap: 8 },
  factorLabelWrap: { flexDirection: "row", alignItems: "center", gap: 4, width: 90 },
  factorLabel:     { fontSize: 11, color: COLORS.textMuted, flexShrink: 1 },
  factorTrack:     { flex: 1, height: 6, backgroundColor: COLORS.borderLight, borderRadius: 3, overflow: "hidden", position: "relative" },
  factorFill:      { height: 6, borderRadius: 3 },
  factorCenter:    { position: "absolute", left: "50%", top: 0, width: 1, height: 6, backgroundColor: COLORS.borderLight + "99" },
  factorDelta:     { width: 52, fontSize: 11, textAlign: "right", fontFamily: "Courier" },
  factorValue:     { width: 28, fontSize: 11, color: COLORS.textMuted, textAlign: "right", fontFamily: "Courier" },
  factorInfoBox:   { marginTop: 6, marginBottom: 4, backgroundColor: COLORS.background, borderRadius: BORDER_RADIUS.md, padding: 10, borderWidth: 1, borderColor: COLORS.borderLight },
  factorInfoText:  { fontSize: 12, color: COLORS.textSecondary, lineHeight: 17 },

  // ── ALE Skill Profile ──
  aleSectionHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 0 },
  aleActiveBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#dcfce7", borderWidth: 1, borderColor: "#86efac" },
  aleActiveBadgeText:  { fontSize: 10, fontWeight: "700", color: "#15803d", letterSpacing: 0.3 },
  aleProChip:          { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#fefce8", borderWidth: 1, borderColor: "#fde68a" },
  aleProChipText:      { fontSize: 10, fontWeight: "700", color: "#ca8a04" },
  aleStatusRow:        { marginTop: 2, marginBottom: 2, paddingLeft: 96 },
  aleStatusText:       { fontSize: 10, fontWeight: "500" },
  aleUpdatesLabel:     { fontSize: 10, color: COLORS.textHint, textAlign: "right", marginTop: 4 },
  aleFreeCta:          { marginTop: 14, padding: 12, backgroundColor: "#fefce8", borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: "#fde68a", flexDirection: "row", alignItems: "center", gap: 10 },
  aleFreeCtatitle:     { fontSize: 13, fontWeight: "700", color: "#92400e", marginBottom: 2 },
  aleFreeCtaBody:      { fontSize: 11, color: "#78350f", lineHeight: 16 },
  aleFreeCtatBtn:      { fontSize: 12, fontWeight: "700", color: "#ca8a04" },

  // ── Growth bar tooltip ──
  growthTooltip:      { position: "absolute", left: -16, right: -16, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.sm, paddingVertical: 5, paddingHorizontal: 4, alignItems: "center", zIndex: 10 },
  growthTooltipDate:  { fontSize: 10, color: "#ffffff", fontWeight: "600" },
  growthTooltipCount: { fontSize: 11, color: "#ffffffcc", marginTop: 1 },
  growthTooltipArrow: { position: "absolute", bottom: -4, left: "50%", marginLeft: -4, width: 8, height: 8, backgroundColor: COLORS.primary, transform: [{ rotate: "45deg" }] },

  // ── Mistake Heatmap ──
  heatmapGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4, marginBottom: 8 },
  heatCell:       { width: 20, height: 20, borderRadius: 3, borderWidth: 1 },
  heatTooltip:    { position: "absolute", bottom: 26, left: -24, width: 110, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.sm, padding: 8, borderWidth: 1, borderColor: COLORS.borderLight, zIndex: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  heatTooltipDate:  { fontSize: 11, fontWeight: "600", color: COLORS.primary, marginBottom: 3 },
  heatTooltipLine:  { fontSize: 11, color: COLORS.textSecondary, marginBottom: 1 },
  heatTooltipClose: { position: "absolute", top: 5, right: 5, padding: 2 },
  heatLegendRow:   { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  heatLegendLabel: { fontSize: 9, color: COLORS.textHint, fontFamily: "Courier" },
  heatLegendCells: { flexDirection: "row", gap: 3, flex: 1, justifyContent: "center" },
  heatLegendCell:  { width: 14, height: 14, borderRadius: 2, borderWidth: 1, borderColor: COLORS.borderLight },

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

});

