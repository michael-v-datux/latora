/**
 * AlternativeWordCard.js — Компактна картка альтернативного перекладу з чекбоксом
 *
 * Props:
 *   word          — об'єкт слова (з fields: translation, cefr_level, part_of_speech,
 *                   difficulty_score, example_sentence, ...)
 *   isSelected    — bool, чи вибрано чекбокс
 *   onToggle      — () => void, тоггл вибору
 *   onAddToList   — () => void, додати лише цю альтернативу в список
 *   isAdded       — bool, вже додано
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CefrBadge from './CefrBadge';
import DifficultyBar from './DifficultyBar';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';

export default function AlternativeWordCard({ word, isSelected, onToggle, onAddToList, isAdded }) {
  const [expanded, setExpanded] = useState(false);

  if (!word) return null;

  const diffScore = word.difficulty_score ?? 50;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => setExpanded((v) => !v)}
      style={[
        styles.card,
        isSelected && styles.cardSelected,
      ]}
    >
      {/* ─── Header row: translation + CEFR + checkbox ─── */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Text style={styles.translation} numberOfLines={expanded ? undefined : 1}>
            {word.translation}
          </Text>
          {!!word.part_of_speech && (
            <Text style={styles.pos}>{word.part_of_speech}</Text>
          )}
        </View>

        <View style={styles.headerRight}>
          <CefrBadge level={word.cefr_level} compact />

          {/* Checkbox */}
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
      </View>

      {/* ─── Difficulty bar ─── */}
      <View style={styles.barRow}>
        <DifficultyBar score={diffScore} />
        <Text style={styles.scoreChip}>
          {word.cefr_level || '—'} · {diffScore}
        </Text>
      </View>

      {/* ─── Expanded: example sentence + single-add button ─── */}
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
    justifyContent: 'space-between',
    gap: 8,
  },
  headerLeft: { flex: 1, gap: 2 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  translation: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.textPrimary,
  },
  pos: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },

  // Checkbox
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
  },

  // Expanded
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

  // Single-add button (inside expanded)
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
