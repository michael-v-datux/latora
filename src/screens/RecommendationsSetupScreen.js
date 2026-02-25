/**
 * RecommendationsSetupScreen.js — Screen 1: Configure recommendation parameters
 *
 * Shown as a full-screen Modal from ListsScreen.
 * User picks: language pair, mode (auto/controlled), intent, difficulty, format, topic, count.
 * On submit → triggers generate → navigates to RecommendationsResultsScreen (second modal).
 *
 * Props (passed via modal):
 *   visible      - boolean
 *   onClose      - () => void
 *   onResults    - (results) => void  — called with server response
 *   lists        - array of user's lists (for lang pair detection)
 *   quota        - { used, max, left } current quota state
 *   isPro        - boolean
 *   defaultLang  - { sourceLang, targetLang } from user's profile/last used
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../i18n';
import { COLORS, BORDER_RADIUS, SPACING } from '../utils/constants';
import { generateRecommendations } from '../services/recommendationsService';
import { trackEvent, Events } from '../services/analytics';

// ─── Option pill ──────────────────────────────────────────────────────────────
function OptionPill({ label, selected, onPress, disabled }) {
  return (
    <TouchableOpacity
      style={[
        styles.pill,
        selected && styles.pillSelected,
        disabled && styles.pillDisabled,
      ]}
      onPress={!disabled ? onPress : undefined}
      activeOpacity={disabled ? 1 : 0.7}
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected, disabled && styles.pillTextDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ label, hint }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export default function RecommendationsSetupScreen({
  visible,
  onClose,
  onResults,
  lists = [],
  quota,
  isPro,
  defaultLang,
}) {
  const { t } = useI18n();

  // ── Derive available lang pairs from user's lists ─────────────────────────
  // Lists now include has_mixed_langs but not per-word lang pairs.
  // We use the defaultLang (from profile) as the primary, plus any extras
  // that might be known from the list data. For MVP, defaultLang is the only source.
  const langPairs = useMemo(() => {
    const seen = new Set();
    const pairs = [];
    // Primary: from defaultLang (user's configured translation pair)
    if (defaultLang?.sourceLang && defaultLang?.targetLang) {
      const key = `${defaultLang.sourceLang}→${defaultLang.targetLang}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push({ sourceLang: defaultLang.sourceLang, targetLang: defaultLang.targetLang, label: key });
      }
    }
    // Fallback if no defaultLang provided
    if (pairs.length === 0) {
      pairs.push({ sourceLang: 'EN', targetLang: 'UK', label: 'EN→UK' });
    }
    return pairs;
  }, [lists, defaultLang]);

  // ── State ─────────────────────────────────────────────────────────────────
  const initialPair = langPairs[0] || defaultLang || { sourceLang: 'EN', targetLang: 'UK' };
  const [sourceLang, setSourceLang] = useState(initialPair.sourceLang || 'EN');
  const [targetLang, setTargetLang] = useState(initialPair.targetLang || 'UK');
  const [mode, setMode] = useState('auto');
  const [intent, setIntent] = useState('expand');
  const [difficulty, setDifficulty] = useState('same');
  const [format, setFormat] = useState('mixed');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(Math.min(5, quota?.left || 5));
  const [loading, setLoading] = useState(false);

  const maxCount = Math.min(isPro ? 30 : 5, quota?.left || 0);
  const countOptions = isPro
    ? [5, 10, 15, 20, 30].filter(n => n <= maxCount)
    : [5].filter(n => n <= maxCount);

  const canGenerate = maxCount > 0 && !loading;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!canGenerate) return;
    setLoading(true);
    try {
      const result = await generateRecommendations({
        sourceLang,
        targetLang,
        mode,
        intent: mode === 'controlled' ? intent : undefined,
        difficulty: mode === 'controlled' ? difficulty : undefined,
        format: mode === 'controlled' ? format : undefined,
        topic: topic.trim() || undefined,
        count: Math.min(count, maxCount),
      });

      trackEvent(Events.RECOMMENDATION_GENERATED, {
        strategy: result.strategy,
        count:    result.items?.length ?? 0,
        mode,
        lang_pair: `${sourceLang}-${targetLang}`,
      });
      onResults(result);
    } catch (e) {
      const errorCode = e?.response?.data?.errorCode;
      if (errorCode === 'REC_LIMIT_REACHED') {
        Alert.alert(
          t('rec.entry_quota_empty'),
          t('rec.limit_reached', { max: quota?.max || 5 })
        );
      } else {
        Alert.alert(t('common.error'), t('rec.error_generate'));
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.headerClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('rec.setup_title')}</Text>
          <View style={styles.headerRight} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Quota info */}
          {quota && (
            <View style={styles.quotaBanner}>
              <Ionicons name="sparkles-outline" size={14} color={COLORS.accent} />
              <Text style={styles.quotaText}>
                {maxCount > 0
                  ? t('rec.setup_quota_info', { left: quota.left, max: quota.max })
                  : t('rec.entry_quota_empty')}
              </Text>
            </View>
          )}

          {/* Language pair */}
          {langPairs.length > 1 && (
            <>
              <SectionHeader label={t('rec.setup_lang_pair')} />
              <View style={styles.pillRow}>
                {langPairs.map(pair => {
                  const key = `${pair.sourceLang}→${pair.targetLang}`;
                  const isSelected = pair.sourceLang === sourceLang && pair.targetLang === targetLang;
                  return (
                    <OptionPill
                      key={key}
                      label={key}
                      selected={isSelected}
                      onPress={() => {
                        setSourceLang(pair.sourceLang);
                        setTargetLang(pair.targetLang);
                      }}
                    />
                  );
                })}
              </View>
            </>
          )}

          {/* Mode */}
          <SectionHeader label={t('rec.setup_mode')} />
          <View style={styles.modeRow}>
            {[
              { value: 'auto', titleKey: 'rec.setup_mode_auto', descKey: 'rec.setup_mode_auto_desc' },
              { value: 'controlled', titleKey: 'rec.setup_mode_controlled', descKey: 'rec.setup_mode_controlled_desc' },
            ].map(m => (
              <TouchableOpacity
                key={m.value}
                style={[styles.modeCard, mode === m.value && styles.modeCardSelected]}
                onPress={() => setMode(m.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.modeTitle, mode === m.value && styles.modeTitleSelected]}>
                  {t(m.titleKey)}
                </Text>
                <Text style={[styles.modeDesc, mode === m.value && styles.modeDescSelected]}>
                  {t(m.descKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Controlled mode options */}
          {mode === 'controlled' && (
            <>
              {/* Intent */}
              <SectionHeader label={t('rec.setup_intent')} />
              <View style={styles.intentGrid}>
                {[
                  { value: 'focus',   titleKey: 'rec.setup_intent_focus',   descKey: 'rec.setup_intent_focus_desc' },
                  { value: 'expand',  titleKey: 'rec.setup_intent_expand',  descKey: 'rec.setup_intent_expand_desc' },
                  { value: 'explore', titleKey: 'rec.setup_intent_explore', descKey: 'rec.setup_intent_explore_desc' },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.intentCard, intent === opt.value && styles.intentCardSelected]}
                    onPress={() => setIntent(opt.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.intentTitle, intent === opt.value && styles.intentTitleSelected]}>
                      {t(opt.titleKey)}
                    </Text>
                    <Text style={[styles.intentDesc, intent === opt.value && styles.intentDescSelected]}>
                      {t(opt.descKey)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Difficulty */}
              <SectionHeader label={t('rec.setup_difficulty')} />
              <View style={styles.pillRow}>
                {[
                  { value: 'easier', labelKey: 'rec.setup_diff_easier' },
                  { value: 'same',   labelKey: 'rec.setup_diff_same' },
                  { value: 'harder', labelKey: 'rec.setup_diff_harder' },
                ].map(opt => (
                  <OptionPill
                    key={opt.value}
                    label={t(opt.labelKey)}
                    selected={difficulty === opt.value}
                    onPress={() => setDifficulty(opt.value)}
                  />
                ))}
              </View>

              {/* Format */}
              <SectionHeader label={t('rec.setup_format')} />
              <View style={styles.pillRow}>
                {[
                  { value: 'words',   labelKey: 'rec.setup_format_words' },
                  { value: 'phrases', labelKey: 'rec.setup_format_phrases' },
                  { value: 'mixed',   labelKey: 'rec.setup_format_mixed' },
                ].map(opt => (
                  <OptionPill
                    key={opt.value}
                    label={t(opt.labelKey)}
                    selected={format === opt.value}
                    onPress={() => setFormat(opt.value)}
                  />
                ))}
              </View>

              {/* Topic */}
              <SectionHeader label={t('rec.setup_topic')} />
              <TextInput
                style={styles.topicInput}
                value={topic}
                onChangeText={setTopic}
                placeholder={t('rec.setup_topic_placeholder')}
                placeholderTextColor={COLORS.textHint}
                returnKeyType="done"
                maxLength={60}
                autoCorrect={false}
              />
            </>
          )}

          {/* Count (Pro only shows options > 5) */}
          {isPro && countOptions.length > 1 && (
            <>
              <SectionHeader label={t('rec.setup_count')} />
              <View style={styles.pillRow}>
                {countOptions.map(n => (
                  <OptionPill
                    key={n}
                    label={t('rec.setup_count_label', { count: n })}
                    selected={count === n}
                    onPress={() => setCount(n)}
                  />
                ))}
              </View>
            </>
          )}

        </ScrollView>

        {/* Generate button */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.generateBtn, !canGenerate && styles.generateBtnDisabled]}
            onPress={handleGenerate}
            disabled={!canGenerate}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="sparkles" size={16} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.generateBtnText}>
                  {maxCount <= 0 ? t('rec.entry_quota_empty') : t('rec.setup_generate_btn')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 14,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerClose: {
    width: 40,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  headerRight: {
    width: 40,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: 120,
    gap: 4,
  },
  quotaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#eff6ff',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  quotaText: {
    fontSize: 13,
    color: COLORS.accent,
    fontWeight: '500',
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  pillSelected: {
    borderColor: COLORS.accent,
    backgroundColor: '#eff6ff',
  },
  pillDisabled: {
    opacity: 0.4,
  },
  pillText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  pillTextSelected: {
    color: COLORS.accent,
    fontWeight: '600',
  },
  pillTextDisabled: {
    color: COLORS.textMuted,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modeCard: {
    flex: 1,
    padding: 14,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  modeCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: '#eff6ff',
  },
  modeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  modeTitleSelected: {
    color: COLORS.accent,
  },
  modeDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 16,
  },
  modeDescSelected: {
    color: '#60a5fa',
  },
  intentGrid: {
    gap: 8,
  },
  intentCard: {
    padding: 12,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  intentCardSelected: {
    borderColor: COLORS.accent,
    backgroundColor: '#eff6ff',
  },
  intentTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  intentTitleSelected: {
    color: COLORS.accent,
  },
  intentDesc: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  intentDescSelected: {
    color: '#60a5fa',
  },
  topicInput: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.md,
    paddingBottom: 32,
    paddingTop: 12,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.accent,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 15,
  },
  generateBtnDisabled: {
    backgroundColor: COLORS.textMuted,
  },
  generateBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
