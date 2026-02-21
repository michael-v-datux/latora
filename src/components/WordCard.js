/**
 * WordCard.js — Картка перекладеного слова (Difficulty Engine v2)
 *
 * Collapsed (default):
 *   - слово, транскрипція, CEFR-бейдж, part of speech, lang pill
 *   - переклад (з кольоровою смужкою)
 *   - idiom block (якщо є)
 *   - DifficultyBar + difficulty_score (CEFR)
 *   - Word State badge + Trend indicator + AI reason (якщо є)
 *   - Кнопка "Деталі ›"
 *   - Приклад речення
 *   - Кнопка "+ Додати в список"
 *
 * Expanded (tap "Деталі"):
 *   - Все з Collapsed +
 *   - Breakdown: Base score, AI adjustment, Personal score, Confidence
 *   - Factor bars: Frequency, Polysemy, Morphology, Phrase, Length
 */

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CefrBadge from './CefrBadge';
import DifficultyBar from './DifficultyBar';
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// ─── Helper: підсвічування слова у прикладі ───────────────────────────────────

/**
 * Розбиває речення на частини, виділяючи точний збіг (case-insensitive).
 * Повертає масив { text, highlight }.
 */
function highlightWord(sentence, word) {
  if (!sentence || !word) return [{ text: sentence || '', highlight: false }];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex   = new RegExp(`(${escaped})`, 'gi');
  const parts   = sentence.split(regex);
  return parts.map((part) => ({
    text:      part,
    highlight: part.toLowerCase() === word.toLowerCase(),
  }));
}

// ─── Helpers: idiom fields ────────────────────────────────────────────────────

const parseAltTranslations = (v) => {
  if (!v) return { idiomatic: [], literal: '' };
  let val = v;
  if (typeof val === 'string') {
    try { val = JSON.parse(val); } catch { return { idiomatic: [], literal: '' }; }
  }
  const normalizeList = (arr) => {
    if (!arr) return [];
    return arr
      .map((x) => {
        if (!x) return '';
        if (typeof x === 'string') return x.trim();
        if (typeof x === 'object') return (x.text || x.translation || '').toString().trim();
        return '';
      })
      .filter(Boolean);
  };
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const idiomatic = normalizeList(val.idiomatic || val.variants || val.alt || []);
    const literal = (val.literal || val.literal_translation || '').toString().trim();
    return { idiomatic, literal };
  }
  if (Array.isArray(val)) {
    return { idiomatic: normalizeList(val), literal: '' };
  }
  return { idiomatic: [], literal: '' };
};

const isIdiomatic = (word) => {
  const kind = (word?.translation_kind || '').toString().toLowerCase();
  const pos = (word?.part_of_speech || word?.pos || '').toString().toLowerCase();
  return kind.includes('idiom') || kind.includes('idiomatic') || pos === 'idiom';
};

// ─── Word State badge config ──────────────────────────────────────────────────

const WORD_STATE_CONFIG = {
  new:          { color: '#94a3b8', bg: '#f1f5f9', i18nKey: 'word.state_new' },
  learning:     { color: '#2563eb', bg: '#eff6ff', i18nKey: 'word.state_learning' },
  stabilizing:  { color: '#ca8a04', bg: '#fefce8', i18nKey: 'word.state_stabilizing' },
  mastered:     { color: '#16a34a', bg: '#f0fdf4', i18nKey: 'word.state_mastered' },
  decaying:     { color: '#dc2626', bg: '#fef2f2', i18nKey: 'word.state_decaying' },
};

const TREND_CONFIG = {
  easier: { color: '#16a34a', i18nKey: 'word.trend_easier' },
  harder: { color: '#dc2626', i18nKey: 'word.trend_harder' },
  stable: { color: '#94a3b8', i18nKey: 'word.trend_stable' },
};

// ─── Confidence label ─────────────────────────────────────────────────────────

function confidenceLabel(score) {
  if (score == null) return null;
  if (score >= 70) return 'confidence_high';
  if (score >= 40) return 'confidence_medium';
  return 'confidence_low';
}

// ─── Small factor bar (0–100) ─────────────────────────────────────────────────

function FactorBar({ label, value, max = 100, color = '#2563eb' }) {
  const pct = Math.min(100, Math.max(0, ((value || 0) / max) * 100));
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
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  label: { fontSize: 11, color: COLORS.textMuted, width: 86 },
  track: { flex: 1, height: 4, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
  value: { fontSize: 11, color: COLORS.textSecondary, fontFamily: 'Courier', width: 24, textAlign: 'right' },
});

// ─── Band → score helper (1–5 → 80/60/40/20/5) ────────────────────────────────

function bandToScore(band) {
  // frequency_band: 1=very common → easy, 5=rare → hard
  // Display as difficulty contribution (invert: band 1 → low score)
  const map = { 1: 5, 2: 20, 3: 45, 4: 65, 5: 85 };
  return map[band] ?? 45;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WordCard({ word, onAddToList, isAdded = false }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [idiomView, setIdiomView] = useState('idiomatic');

  if (!word) return null;

  const idiomMeta = useMemo(() => parseAltTranslations(word?.alt_translations), [word?.alt_translations]);
  const showIdiomToggle = isIdiomatic(word) && (idiomMeta.literal && idiomMeta.idiomatic.length > 0);

  // ─── v2 fields ───
  const diffScore    = word.difficulty_score ?? word.score ?? 50;
  const baseScore    = word.base_score ?? null;
  const aiAdj        = word.ai_adjustment ?? null;
  const confScore    = word.confidence_score ?? null;
  const personalSc   = word.personal_score ?? null;   // from user_word_progress
  const wordState    = word.word_state ?? null;        // from user_word_progress
  const trendDir     = word.trend_direction ?? null;   // from user_word_progress
  const aiReason     = word.ai_reason ?? null;
  const freqBand     = word.frequency_band ?? null;
  const polysemy     = word.polysemy_level ?? null;
  const morphCx      = word.morph_complexity ?? null;
  const phraseFlag   = word.phrase_flag ?? false;

  const stateConf    = wordState ? WORD_STATE_CONFIG[wordState] : null;
  const trendConf    = trendDir  ? TREND_CONFIG[trendDir]       : null;
  const confKey      = confidenceLabel(confScore);

  // CEFR від personal_score (якщо є) або від diff_score
  const personalCefr = personalSc != null
    ? scoreToCefrLocal(personalSc)
    : null;

  const hasV2Data    = baseScore != null;
  const hasProgress  = wordState != null || trendDir != null || personalSc != null;

  return (
    <View style={styles.card}>
      {/* ─── Header: word + badges ─── */}
      <View style={styles.header}>
        <View style={styles.wordInfo}>
          <Text style={styles.original}>{word.original}</Text>
          <Text style={styles.transcription}>{word.transcription}</Text>
        </View>
        <View style={styles.badges}>
          <CefrBadge level={word.cefr_level || word.cefr} />
          {(word.source_lang || word.target_lang) && (
            <Text style={styles.langPill}>
              {(word.source_lang || 'EN')} → {(word.target_lang || 'UK')}
            </Text>
          )}
          <Text style={styles.partOfSpeech}>{word.part_of_speech || word.pos}</Text>
        </View>
      </View>

      {/* ─── Translation ─── */}
      <View style={[
        styles.translationBox,
        { borderLeftColor: (CEFR_COLORS[word.cefr_level || word.cefr] || '#94a3b8') + '50' },
      ]}>
        <Text style={styles.translation}>{word.translation}</Text>
      </View>

      {/* ─── Idiom block ─── */}
      {isIdiomatic(word) && (idiomMeta.idiomatic.length > 0 || !!idiomMeta.literal) && (
        <View style={styles.altBox}>
          <View style={styles.idiomHeaderRow}>
            <Text style={styles.altLabel}>
              {idiomView === 'literal' ? 'Буквально' : 'Ідіоматично'}
            </Text>
            {showIdiomToggle && (
              <View style={styles.idiomToggle}>
                <TouchableOpacity
                  onPress={() => setIdiomView('idiomatic')}
                  style={[styles.idiomToggleBtn, idiomView === 'idiomatic' && styles.idiomToggleBtnActive]}
                >
                  <Text style={[styles.idiomToggleText, idiomView === 'idiomatic' && styles.idiomToggleTextActive]}>
                    Idiomatic
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setIdiomView('literal')}
                  style={[styles.idiomToggleBtn, idiomView === 'literal' && styles.idiomToggleBtnActive]}
                >
                  <Text style={[styles.idiomToggleText, idiomView === 'literal' && styles.idiomToggleTextActive]}>
                    Literal
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {idiomView === 'literal' && !!idiomMeta.literal && (
            <Text style={styles.altText}>• {idiomMeta.literal}</Text>
          )}
          {(idiomView !== 'literal' || !idiomMeta.literal) && (
            idiomMeta.idiomatic.map((txt, i) => (
              <Text key={`${i}-${txt}`} style={styles.altText}>• {txt}</Text>
            ))
          )}
          {!!word.translation_notes && idiomView !== 'literal' && (
            <Text style={styles.altNote}>{word.translation_notes}</Text>
          )}
        </View>
      )}

      {/* ─── Difficulty bar + score row ─── */}
      <View style={styles.section}>
        <View style={styles.diffHeaderRow}>
          <Text style={styles.sectionLabel}>{t('word.difficulty')}</Text>
          {/* Word State badge */}
          {stateConf && (
            <View style={[styles.stateBadge, { backgroundColor: stateConf.bg }]}>
              <Text style={[styles.stateBadgeText, { color: stateConf.color }]}>
                {t(stateConf.i18nKey)}
              </Text>
            </View>
          )}
        </View>

        <DifficultyBar score={diffScore} />

        {/* Score row: diff_score + personal_score + trend */}
        <View style={styles.scoreRow}>
          <Text style={styles.scoreChip}>
            {word.cefr_level || word.cefr || '—'} · {diffScore}
          </Text>
          {personalSc != null && personalCefr && (
            <Text style={styles.personalChip}>
              🎯 {personalCefr} · {personalSc}
            </Text>
          )}
          {trendConf && (
            <Text style={[styles.trendText, { color: trendConf.color }]}>
              {t(trendConf.i18nKey)}
            </Text>
          )}
        </View>

        {/* AI reason (short) */}
        {aiReason && (
          <Text style={styles.aiReason}>{t('word.ai_reason')} {aiReason}</Text>
        )}
      </View>

      {/* ─── Expand/Collapse toggle (only when v2 data exists) ─── */}
      {hasV2Data && (
        <TouchableOpacity
          style={styles.expandBtn}
          onPress={() => setExpanded(v => !v)}
          activeOpacity={0.6}
        >
          <Text style={styles.expandBtnText}>
            {expanded ? '▲ ' : '▼ '}{t('word.tap_to_expand')}
          </Text>
        </TouchableOpacity>
      )}

      {/* ─── Expanded: full breakdown ─── */}
      {expanded && hasV2Data && (
        <View style={styles.breakdownBox}>
          <Text style={styles.sectionLabel}>{t('word.breakdown')}</Text>

          {/* Score pills row */}
          <View style={styles.scoreBreakdownRow}>
            <View style={styles.scorePill}>
              <Text style={styles.scorePillLabel}>{t('word.base_score')}</Text>
              <Text style={styles.scorePillValue}>{baseScore ?? '—'}</Text>
            </View>
            {aiAdj != null && (
              <View style={[styles.scorePill, aiAdj > 0 ? styles.scorePillNeg : aiAdj < 0 ? styles.scorePillPos : styles.scorePillNeutral]}>
                <Text style={styles.scorePillLabel}>{t('word.ai_adjustment')}</Text>
                <Text style={styles.scorePillValue}>
                  {aiAdj > 0 ? `+${aiAdj}` : aiAdj}
                </Text>
              </View>
            )}
            {personalSc != null && (
              <View style={[styles.scorePill, styles.scorePillPersonal]}>
                <Text style={styles.scorePillLabel}>{t('word.personal_score')}</Text>
                <Text style={styles.scorePillValue}>{personalSc}</Text>
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
              <FactorBar
                label={t('word.factor_freq')}
                value={bandToScore(freqBand)}
                color="#2563eb"
              />
            )}
            {polysemy != null && (
              <FactorBar
                label={t('word.factor_poly')}
                value={Math.round(((polysemy - 1) / 4) * 100)}
                color="#7c3aed"
              />
            )}
            {morphCx != null && (
              <FactorBar
                label={t('word.factor_morph')}
                value={Math.round(((morphCx - 1) / 4) * 100)}
                color="#ea580c"
              />
            )}
            {phraseFlag && (
              <FactorBar
                label={t('word.factor_phrase')}
                value={100}
                color="#ca8a04"
              />
            )}
          </View>
        </View>
      )}

      {/* ─── Example ─── */}
      {(word.example_sentence || word.example) && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('word.example')}</Text>
          <Text style={styles.example}>
            {"\""}
            {highlightWord(word.example_sentence || word.example, word.original).map((part, i) =>
              part.highlight ? (
                <Text key={i} style={styles.exampleHighlight}>{part.text}</Text>
              ) : (
                part.text
              )
            )}
            {"\""}
          </Text>
        </View>
      )}

      {/* ─── Add to list button ─── */}
      <TouchableOpacity
        style={[styles.addButton, isAdded && styles.addButtonAdded]}
        onPress={onAddToList}
        disabled={isAdded}
        activeOpacity={0.7}
      >
        <Text style={[styles.addButtonText, isAdded && styles.addButtonTextAdded]}>
          {isAdded ? '✓ Added to list' : '+ Add to list'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Local scoreToCefr (mirrors server, no import needed) ────────────────────

function scoreToCefrLocal(score) {
  if (score < 17) return 'A1';
  if (score < 33) return 'A2';
  if (score < 50) return 'B1';
  if (score < 66) return 'B2';
  if (score < 83) return 'C1';
  return 'C2';
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  wordInfo: { flex: 1 },
  original: { fontSize: 24, fontWeight: '400', color: COLORS.primary },
  transcription: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Courier', marginTop: 2 },
  badges: { alignItems: 'flex-end', gap: 6 },
  partOfSpeech: { fontSize: 10, color: COLORS.textMuted, fontStyle: 'italic' },
  langPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },

  // Translation box
  translationBox: {
    marginVertical: SPACING.lg,
    padding: 14,
    backgroundColor: '#fafbfc',
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 3,
  },
  translation: { fontSize: 18, color: COLORS.textPrimary, fontWeight: '500' },

  // Section
  section: { marginTop: 20, marginBottom: 4 },
  sectionLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 0.8,
    fontWeight: '500',
    marginBottom: 6,
  },
  example: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    lineHeight: 22,
  },
  exampleHighlight: {
    fontWeight: '700',
    fontStyle: 'normal',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },

  // Difficulty row
  diffHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },

  // Word State badge
  stateBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  stateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },

  // Score row below bar
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
    flexWrap: 'wrap',
  },
  scoreChip: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: 'Courier',
  },
  personalChip: {
    fontSize: 12,
    color: '#7c3aed',
    fontFamily: 'Courier',
  },
  trendText: {
    fontSize: 11,
    fontWeight: '500',
    marginLeft: 'auto',
  },

  // AI reason
  aiReason: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginTop: 5,
    lineHeight: 18,
  },

  // Expand button
  expandBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  expandBtnText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },

  // Breakdown box
  breakdownBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    backgroundColor: '#fafbfc',
    gap: 10,
  },

  // Score pills inside breakdown
  scoreBreakdownRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 4,
  },
  scorePill: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  scorePillNeg:     { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  scorePillPos:     { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  scorePillNeutral: { backgroundColor: '#f8fafc', borderColor: COLORS.border },
  scorePillPersonal:{ backgroundColor: '#f5f3ff', borderColor: '#ddd6fe' },
  scorePillLabel: { fontSize: 10, color: COLORS.textMuted, marginBottom: 2 },
  scorePillValue: { fontSize: 16, fontWeight: '500', color: COLORS.textPrimary, fontFamily: 'Courier' },

  // Confidence
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  confidenceLabel: { fontSize: 12, color: COLORS.textMuted },
  confidenceValue: { fontSize: 12, fontWeight: '600' },
  confHigh:   { color: '#16a34a' },
  confMed:    { color: '#ca8a04' },
  confLow:    { color: '#94a3b8' },

  // Factor bars container
  factorsBox: { marginTop: 4 },

  // Add button
  addButton: {
    paddingVertical: 12,
    backgroundColor: '#fafbfc',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: 20,
  },
  addButtonAdded: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  addButtonTextAdded: {
    color: '#16a34a',
  },

  // Idiom block (unchanged)
  altBox: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  altLabel: {
    color: COLORS.textHint,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  idiomHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  idiomToggle: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
  },
  idiomToggleBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  idiomToggleBtnActive: { backgroundColor: COLORS.background },
  idiomToggleText: { color: COLORS.textHint, fontSize: 11, fontWeight: '700' },
  idiomToggleTextActive: { color: COLORS.textPrimary },
  altText: { color: COLORS.textPrimary, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  altNote: { color: COLORS.textHint, fontSize: 12, lineHeight: 18, marginTop: 6 },
});
