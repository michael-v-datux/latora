/**
 * WordDifficultyBreakdown.js
 *
 * Розгорнутий блок складності слова (Difficulty Engine v2).
 * Використовується в ListsScreen і WordCard (expanded секція).
 *
 * Props:
 *   word — об'єкт слова з полями v2:
 *     base_score, ai_adjustment, confidence_score,
 *     personal_score, word_state, trend_direction,
 *     frequency_band, polysemy_level, morph_complexity, phrase_flag
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreToCefrLocal(score) {
  if (score < 17) return 'A1';
  if (score < 33) return 'A2';
  if (score < 50) return 'B1';
  if (score < 66) return 'B2';
  if (score < 83) return 'C1';
  return 'C2';
}

function confidenceLabel(score) {
  if (score == null) return null;
  if (score >= 70) return 'confidence_high';
  if (score >= 40) return 'confidence_medium';
  return 'confidence_low';
}

function bandToScore(band) {
  const map = { 1: 5, 2: 20, 3: 45, 4: 65, 5: 85 };
  return map[band] ?? 45;
}

// ─── FactorBar ────────────────────────────────────────────────────────────────

function FactorBar({ label, value, color = '#2563eb' }) {
  const pct = Math.min(100, Math.max(0, value || 0));
  return (
    <View style={fb.row}>
      <Text style={fb.label}>{label}</Text>
      <View style={fb.track}>
        <View style={[fb.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={fb.value}>{value ?? '—'}</Text>
    </View>
  );
}

const fb = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  label: { fontSize: 11, color: COLORS.textMuted, width: 86 },
  track: { flex: 1, height: 4, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 2 },
  value: { fontSize: 11, color: COLORS.textSecondary, fontFamily: 'Courier', width: 24, textAlign: 'right' },
});

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function WordDifficultyBreakdown({ word }) {
  const { t } = useI18n();
  if (!word) return null;

  const baseScore   = word.base_score    ?? null;
  const aiAdj       = word.ai_adjustment ?? null;
  const confScore   = word.confidence_score ?? null;
  const personalSc  = word.personal_score   ?? null;
  const freqBand    = word.frequency_band   ?? null;
  const polysemy    = word.polysemy_level   ?? null;
  const morphCx     = word.morph_complexity ?? null;
  const phraseFlag  = word.phrase_flag      ?? false;

  const confKey     = confidenceLabel(confScore);
  const personalCefr = personalSc != null ? scoreToCefrLocal(personalSc) : null;

  return (
    <View style={styles.box}>
      <Text style={styles.sectionLabel}>{t('word.breakdown')}</Text>

      {/* Score pills */}
      <View style={styles.pillsRow}>
        <View style={styles.pill}>
          <Text style={styles.pillLabel}>{t('word.base_score')}</Text>
          <Text style={styles.pillValue}>{baseScore ?? '—'}</Text>
        </View>

        {aiAdj != null && (
          <View style={[
            styles.pill,
            aiAdj > 0 ? styles.pillNeg : aiAdj < 0 ? styles.pillPos : styles.pillNeutral,
          ]}>
            <Text style={styles.pillLabel}>{t('word.ai_adjustment')}</Text>
            <Text style={styles.pillValue}>{aiAdj > 0 ? `+${aiAdj}` : aiAdj}</Text>
          </View>
        )}

        {personalSc != null && (
          <View style={[styles.pill, styles.pillPersonal]}>
            <Text style={styles.pillLabel}>{t('word.personal_score')}</Text>
            <Text style={styles.pillValue}>{personalSc}</Text>
          </View>
        )}
      </View>

      {/* Confidence */}
      {confKey && (
        <View style={styles.confRow}>
          <Text style={styles.confLabel}>{t('word.confidence')}:</Text>
          <Text style={[
            styles.confValue,
            confKey === 'confidence_high'   ? styles.confHigh
            : confKey === 'confidence_medium' ? styles.confMed
            : styles.confLow,
          ]}>
            {t(`word.${confKey}`)}
            {confScore != null ? ` (${confScore}%)` : ''}
          </Text>
        </View>
      )}

      {/* Factor bars */}
      <View style={styles.factors}>
        {freqBand != null && (
          <FactorBar label={t('word.factor_freq')} value={bandToScore(freqBand)} color="#2563eb" />
        )}
        {polysemy != null && (
          <FactorBar label={t('word.factor_poly')} value={Math.round(((polysemy - 1) / 4) * 100)} color="#7c3aed" />
        )}
        {morphCx != null && (
          <FactorBar label={t('word.factor_morph')} value={Math.round(((morphCx - 1) / 4) * 100)} color="#ea580c" />
        )}
        {phraseFlag && (
          <FactorBar label={t('word.factor_phrase')} value={100} color="#ca8a04" />
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  box: {
    marginTop: 10,
    padding: 12,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: '#fafbfc',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: '600',
    textTransform: 'uppercase',
  },

  // Pills
  pillsRow:    { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  pill: {
    flex: 1,
    minWidth: 72,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    alignItems: 'center',
  },
  pillNeg:     { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  pillPos:     { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  pillNeutral: { backgroundColor: '#f8fafc', borderColor: COLORS.borderLight },
  pillPersonal:{ backgroundColor: '#f5f3ff', borderColor: '#ddd6fe' },
  pillLabel:   { fontSize: 9, color: COLORS.textMuted, marginBottom: 2 },
  pillValue:   { fontSize: 15, fontWeight: '500', color: COLORS.textPrimary, fontFamily: 'Courier' },

  // Confidence
  confRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  confLabel: { fontSize: 11, color: COLORS.textMuted },
  confValue: { fontSize: 11, fontWeight: '600' },
  confHigh:  { color: '#16a34a' },
  confMed:   { color: '#ca8a04' },
  confLow:   { color: '#94a3b8' },

  // Factors
  factors: { marginTop: 2 },
});
