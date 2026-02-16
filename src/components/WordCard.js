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

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CefrBadge from './CefrBadge';
import DifficultyBar from './DifficultyBar';
import { COLORS, CEFR_COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
// --- Helpers: normalize idiom fields coming from Supabase/HTTP ---
// --- Helpers: normalize idiom fields coming from Supabase/HTTP ---
const parseAltTranslations = (v) => {
  // Supported formats:
  // 1) legacy: ["a","b"]  (or JSON string of that)
  // 2) new: { idiomatic: ["a","b"], literal: "..." } (or JSON string)
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

  // New format
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const idiomatic = normalizeList(val.idiomatic || val.variants || val.alt || []);
    const literal = (val.literal || val.literal_translation || '').toString().trim();
    return { idiomatic, literal };
  }

  // Legacy array
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

export default function WordCard({ word, onAddToList, isAdded = false }) {
  if (!word) return null;
  const idiomMeta = useMemo(() => parseAltTranslations(word?.alt_translations), [word?.alt_translations]);
  const [idiomView, setIdiomView] = useState('idiomatic');
  const showIdiomToggle = isIdiomatic(word) && (idiomMeta.literal && idiomMeta.idiomatic.length > 0);

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
          {(word.source_lang || word.target_lang) && (
            <Text style={styles.langPill}>{(word.source_lang || 'EN')} → {(word.target_lang || 'UK')}</Text>
          )}
          <Text style={styles.partOfSpeech}>{word.part_of_speech || word.pos}</Text>
        </View>
      </View>

      {/* Переклад */}
      <View style={[styles.translationBox, { borderLeftColor: (CEFR_COLORS[word.cefr_level || word.cefr] || '#94a3b8') + '50' }]}>
        <Text style={styles.translation}>{word.translation}</Text>
      </View>

      {(isIdiomatic(word) && (idiomMeta.idiomatic.length > 0 || !!idiomMeta.literal)) && (
  <View style={styles.altBox}>
    <View style={styles.idiomHeaderRow}>
      <Text style={styles.altLabel}>{idiomView === 'literal' ? 'Буквально' : 'Ідіоматично'}</Text>

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
      <>
        {idiomMeta.idiomatic.map((t, i) => (
          <Text key={`${i}-${t}`} style={styles.altText}>• {t}</Text>
        ))}
      </>
    )}

    {!!word.translation_notes && idiomView !== 'literal' && (
      <Text style={styles.altNote}>{word.translation_notes}</Text>
    )}
  </View>
)}

      {/* Складність */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>DIFFICULTY</Text>
        <DifficultyBar score={word.difficulty_score || word.score || 50} />
      </View>

      {/* Приклад */}
      {(word.example_sentence || word.example) && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>EXAMPLE</Text>
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
          {isAdded ? '✓ Added to list' : '+ Add to list'}
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
  translation: {
    fontSize: 18,
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  section: {
    marginTop: 20,
    marginBottom: 4,
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

langPill: {
  marginLeft: 8,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: COLORS.border,
  backgroundColor: COLORS.surface,
  color: COLORS.textPrimary,
  fontSize: 11,
  fontWeight: '700',
},
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
  marginBottom: 0,
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
idiomToggleBtn: {
  paddingHorizontal: 10,
  paddingVertical: 6,
},
idiomToggleBtnActive: {
  backgroundColor: COLORS.card,
},
idiomToggleText: {
  color: COLORS.textHint,
  fontSize: 11,
  fontWeight: '700',
},
idiomToggleTextActive: {
  color: COLORS.textPrimary,
},
altText: {
  color: COLORS.textPrimary,
  fontSize: 14,
  lineHeight: 20,
  marginBottom: 4,
},
altNote: {
  color: COLORS.textHint,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 6,
},

});