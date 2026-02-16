/**
 * WordCard.js — Картка перекладеного слова
 * 
 * Показує результат перекладу з усіма деталями:
 * - слово та транскрипція
 * - CEFR-рівень
 * - переклад
 * - шкала складності
 * - приклад у реченні
 * - кнопка "Додати в список"
 * 
 * Використання:
 *   <WordCard word={wordObject} onAddToList={() => ...} />
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CefrBadge from './CefrBadge';
import DifficultyBar from './DifficultyBar';
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';
import { pairLabel } from '../utils/languages';

export default function WordCard({ word, onAddToList, isAdded = false }) {
  const { t } = useI18n();
  if (!word) return null;

  const sourceLang = word.source_lang || word.sourceLang;
  const targetLang = word.target_lang || word.targetLang;
  const alt = Array.isArray(word.alt_translations) ? word.alt_translations : (Array.isArray(word.altTranslations) ? word.altTranslations : []);
  const note = word.translation_notes || word.translationNotes;
  const kind = word.translation_kind || word.translationKind;

  return (
    <View style={styles.card}>
      {/* Верхня частина: слово + бейдж */}
      <View style={styles.header}>
        <View style={styles.wordInfo}>
          <Text style={styles.original}>{word.original}</Text>
          <Text style={styles.transcription}>{word.transcription}</Text>
        </View>
        <View style={styles.badges}>
          <CefrBadge level={word.cefr_level || word.cefr} />
          <Text style={styles.partOfSpeech}>{word.part_of_speech || word.pos}</Text>
        </View>
      </View>

      {/* Переклад */}
      <View style={[styles.translationBox, { borderLeftColor: (CEFR_COLORS[word.cefr_level || word.cefr] || '#94a3b8') + '50' }]}>
        <View style={styles.translationTopRow}>
          <Text style={styles.translation}>{word.translation}</Text>
          {(sourceLang && targetLang) && (
            <View style={styles.pairBadge}>
              <Text style={styles.pairBadgeText}>{pairLabel(sourceLang, targetLang)}</Text>
            </View>
          )}
        </View>

        {alt.length > 0 && (
          <View style={styles.altBlock}>
            <Text style={styles.altLabel}>
              {kind === 'idiomatic' || kind === 'mixed' ? t('translate.idiom_label') : t('translate.variants_label')}
            </Text>
            {alt.map((a, idx) => (
              <Text key={`${a.text}-${idx}`} style={styles.altText}>• {a.text}</Text>
            ))}
            {!!note && (
              <Text style={styles.noteText}>{note}</Text>
            )}
          </View>
        )}
      </View>

      {/* Складність */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('word.difficulty')}</Text>
        <DifficultyBar score={word.difficulty_score || word.score || 50} />
      </View>

      {/* Приклад */}
      {(word.example_sentence || word.example) && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('word.example')}</Text>
          <Text style={styles.example}>"{word.example_sentence || word.example}"</Text>
        </View>
      )}

      {/* Кнопка "Додати в список" */}
      <TouchableOpacity
        style={[styles.addButton, isAdded && styles.addButtonAdded]}
        onPress={onAddToList}
        disabled={isAdded}
        activeOpacity={0.7}  // ефект натискання (0 = повністю прозорий, 1 = без ефекту)
      >
        <Text style={[styles.addButtonText, isAdded && styles.addButtonTextAdded]}>
          {isAdded ? t('lists.added_to_list_short') : `+ ${t('lists.add_to_list')}`}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    // Тінь (iOS)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    // Тінь (Android)
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  wordInfo: {
    flex: 1,  // зайняти максимум простору
  },
  original: {
    fontSize: 24,
    fontWeight: '400',
    color: COLORS.primary,
  },
  transcription: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontFamily: 'Courier',
    marginTop: 2,
  },
  badges: {
    alignItems: 'flex-end',
    gap: 6,
  },
  partOfSpeech: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  translationBox: {
    marginVertical: SPACING.lg,
    padding: 14,
    backgroundColor: '#fafbfc',
    borderRadius: BORDER_RADIUS.md,
    borderLeftWidth: 3,
  },
  translationTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  translation: {
    fontSize: 18,
    color: COLORS.textPrimary,
    fontWeight: '500',
    flex: 1,
  },
  pairBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(2,6,23,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    marginTop: 2,
  },
  pairBadgeText: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  altBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(148,163,184,0.25)',
  },
  altLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  altText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    lineHeight: 20,
    marginBottom: 2,
  },
  noteText: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  section: {
    marginBottom: 14,
  },
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
  addButton: {
    paddingVertical: 12,
    backgroundColor: '#fafbfc',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginTop: 2,
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
});
