/**
 * AlternativeWordCard.js — Компактна картка альтернативного перекладу з чекбоксом
 *
 * Props:
 *   word          — об'єкт слова (з fields: translation, cefr_level, part_of_speech,
 *                   difficulty_score, example_sentence, base_score, ...)
 *   isSelected    — bool, чи вибрано чекбокс
 *   onToggle      — () => void, тоггл вибору
 *   onAddToList   — () => void, додати лише цю альтернативу в список
 *   isAdded       — bool, вже додано
 *   isPro         — bool, чи має користувач Pro-підписку (для розбивки складності)
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CefrBadge from './CefrBadge';
import DifficultyBar from './DifficultyBar';
import { COLORS, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// ─── Helpers (mirrors WordCard) ───────────────────────────────────────────────

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

function FactorBar({ label, value, color = '#2563eb' }) {
  const pct = Math.min(100, Math.max(0, ((value || 0) / 100) * 100));
  return (
    <View style={fbStyles.row}>
      <Text style={fbStyles.label}>{label}</Text>
      <View style={fbStyles.track}>
        <View style={[fbStyles.fill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={fbStyles.value}>{value ?? '—'}</Text>
    </View>
  );
}

const fbStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  label: { fontSize: 11, color: COLORS.textMuted, width: 86 },
  track: { flex: 1, height: 4, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  fill:  { height: '100%', borderRadius: 2 },
  value: { fontSize: 11, color: COLORS.textSecondary, fontFamily: 'Courier', width: 24, textAlign: 'right' },
});

// ─── Main component ───────────────────────────────────────────────────────────

export default function AlternativeWordCard({ word, isSelected, onToggle, onAddToList, isAdded, isPro }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);

  if (!word) return null;

  const diffScore  = word.difficulty_score ?? 50;

  // v2 fields for breakdown (Pro-only)
  const baseScore  = word.base_score ?? null;
  const aiAdj      = word.ai_adjustment ?? null;
  const confScore  = word.confidence_score ?? null;
  const freqBand   = word.frequency_band ?? null;
  const polysemy   = word.polysemy_level ?? null;
  const morphCx    = word.morph_complexity ?? null;
  const phraseFlag = word.phrase_flag ?? false;
  const hasV2Data  = baseScore != null;
  const confKey    = confidenceLabel(confScore);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded((v) => !v)}
      style={[styles.card, isSelected && styles.cardSelected]}
    >
      {/* ─── Header row: translation left / checkbox right ─── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.translation} numberOfLines={expanded ? undefined : 1}>
            {word.translation}
          </Text>
          {/* CEFR badge + part of speech на одному рядку під перекладом */}
          <View style={styles.metaRow}>
            <CefrBadge level={word.cefr_level} small />
            {!!word.part_of_speech && (
              <Text style={styles.pos}>{word.part_of_speech}</Text>
            )}
          </View>
        </View>

        {/* Лише чекбокс праворуч — CEFR перенесено вліво щоб не виходило за межі */}
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation?.();
            onToggle?.();
          }}
          hitSlop={10}
          style={[styles.checkbox, isSelected && styles.checkboxSelected]}
          activeOpacity={0.7}
        >
          {isSelected && (
            <Ionicons name="checkmark" size={13} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* ─── Difficulty bar ─── */}
      <View style={styles.barRow}>
        <View style={{ flex: 1 }}>
          <DifficultyBar score={diffScore} />
        </View>
        <Text style={styles.scoreChip}>{diffScore}</Text>
      </View>

      {/* ─── Pro-only: кнопка "Деталі" і розбивка складності ─── */}
      {isPro && hasV2Data && (
        <TouchableOpacity
          style={styles.expandBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            setBreakdownExpanded((v) => !v);
          }}
          activeOpacity={0.6}
        >
          <Text style={styles.expandBtnText}>
            {breakdownExpanded ? '▲ ' : '▼ '}{t('word.tap_to_expand')}
          </Text>
        </TouchableOpacity>
      )}

      {isPro && hasV2Data && breakdownExpanded && (
        <View style={styles.breakdownBox}>
          <Text style={styles.breakdownLabel}>{t('word.breakdown')}</Text>

          {/* Score pills */}
          <View style={styles.scoreBreakdownRow}>
            <View style={styles.scorePill}>
              <Text style={styles.scorePillLabel}>{t('word.base_score')}</Text>
              <Text style={styles.scorePillValue}>{baseScore ?? '—'}</Text>
            </View>
            {aiAdj != null && (
              <View style={[
                styles.scorePill,
                aiAdj > 0 ? styles.scorePillNeg : aiAdj < 0 ? styles.scorePillPos : styles.scorePillNeutral,
              ]}>
                <Text style={styles.scorePillLabel}>{t('word.ai_adjustment')}</Text>
                <Text style={styles.scorePillValue}>{aiAdj > 0 ? `+${aiAdj}` : aiAdj}</Text>
              </View>
            )}
          </View>

          {/* Confidence */}
          {confKey && (
            <View style={styles.confidenceRow}>
              <Text style={styles.confidenceLabel}>{t('word.confidence')}:</Text>
              <Text style={[
                styles.confidenceValue,
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
          <View style={styles.factorsBox}>
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
      )}

      {/* ─── Expanded: example sentence + кнопка "Add to list" ─── */}
      {expanded && (
        <View style={styles.expandedContent}>
          {!!word.example_sentence && (
            <Text style={styles.example}>"{word.example_sentence}"</Text>
          )}

          <TouchableOpacity
            style={[styles.addBtn, isAdded && styles.addBtnAdded]}
            onPress={(e) => {
              e.stopPropagation?.();
              onAddToList?.();
            }}
            disabled={isAdded}
            activeOpacity={0.7}
          >
            <Text style={[styles.addBtnText, isAdded && styles.addBtnTextAdded]}>
              {isAdded ? '✓ Added' : '+ Add to list'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    marginBottom: 8,
  },
  cardSelected: {
    borderColor: '#16a34a',
    backgroundColor: '#f0fdf4',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,   // дозволяє flex-shrink коректно спрацювати
    gap: 4,
  },
  translation: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  pos: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },

  // Checkbox (єдиний елемент у headerRight)
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  checkboxSelected: {
    borderColor: '#16a34a',
    backgroundColor: '#16a34a',
  },

  // Difficulty bar row
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  scoreChip: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontFamily: 'Courier',
    flexShrink: 0,
    minWidth: 22,
    textAlign: 'right',
  },

  // Pro breakdown expand button
  expandBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  expandBtnText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Pro breakdown box
  breakdownBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: '#fafbfc',
    gap: 8,
  },
  breakdownLabel: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: '500',
    marginBottom: 2,
    textTransform: 'uppercase',
  },

  // Score pills
  scoreBreakdownRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  scorePill: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  scorePillNeg:     { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  scorePillPos:     { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  scorePillNeutral: { backgroundColor: '#f8fafc', borderColor: COLORS.border },
  scorePillLabel:   { fontSize: 9, color: COLORS.textMuted, marginBottom: 2 },
  scorePillValue:   { fontSize: 14, fontWeight: '500', color: COLORS.textPrimary, fontFamily: 'Courier' },

  // Confidence
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  confidenceLabel: { fontSize: 11, color: COLORS.textMuted },
  confidenceValue: { fontSize: 11, fontWeight: '600' },
  confHigh: { color: '#16a34a' },
  confMed:  { color: '#ca8a04' },
  confLow:  { color: '#94a3b8' },

  // Factor bars container
  factorsBox: { marginTop: 2 },

  // Expanded section (example + add button)
  expandedContent: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderLight,
    paddingTop: 10,
    gap: 10,
  },
  example: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    lineHeight: 20,
  },

  // Single-add button
  addBtn: {
    paddingVertical: 8,
    backgroundColor: '#fafbfc',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    alignItems: 'center',
  },
  addBtnAdded: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  addBtnTextAdded: {
    color: '#16a34a',
  },
});
