/**
 * PracticeScreen.js — Екран повторення слів (flashcards)
 * 
 * Три стани:
 * 1. Головна — статистика + вибір списку для повторення
 * 2. Сесія — flashcard з кнопками Forgot/Hard/Good/Easy
 * 3. Результати — підсумок сесії
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CefrBadge from '../components/CefrBadge';
import { calculateNextReview } from '../services/srsService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';
import { useI18n } from '../i18n';

// Тимчасові дані для повторення
const PRACTICE_WORDS = [
  { id: 'w1', original: 'serendipity', translation: 'щаслива випадковість', transcription: '/ˌsɛr.ənˈdɪp.ɪ.ti/', cefr: 'C1', example: 'It was pure serendipity that we met.' },
  { id: 'w3', original: 'reluctant', translation: 'неохочий', transcription: '/rɪˈlʌk.tənt/', cefr: 'B2', example: 'She was reluctant to leave.' },
  { id: 'w4', original: 'accomplish', translation: 'досягати, здійснювати', transcription: '/əˈkɒm.plɪʃ/', cefr: 'B1', example: 'We accomplished our goal.' },
  { id: 'w5', original: 'breeze', translation: 'легкий вітерець', transcription: '/briːz/', cefr: 'A2', example: 'A gentle breeze was blowing.' },
  { id: 'w2', original: 'ephemeral', translation: 'ефемерний, короткочасний', transcription: '/ɪˈfɛm.ər.əl/', cefr: 'C1', example: 'Fame is often ephemeral.' },
];

const MOCK_LISTS = [
  { id: '1', name: 'Abstract Concepts', emoji: '💭', count: 3 },
  { id: '2', name: 'Emotions & States', emoji: '🎭', count: 2 },
  { id: '3', name: 'Business English', emoji: '💼', count: 2 },
  { id: '4', name: 'Nature & Weather', emoji: '🌿', count: 1 },
];

// Кнопки оцінки
const ANSWER_BUTTONS = [
  { key: 'forgot', label: 'Forgot', color: '#dc2626', bg: '#fef2f2' },
  { key: 'hard', label: 'Hard', color: '#ea580c', bg: '#fff7ed' },
  { key: 'good', label: 'Good', color: '#2563eb', bg: '#eff6ff' },
  { key: 'easy', label: 'Easy', color: '#16a34a', bg: '#f0fdf4' },
];

export default function PracticeScreen() {
  const { t } = useI18n();
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ easy: 0, good: 0, hard: 0, forgot: 0 });
  const [finished, setFinished] = useState(false);

  const words = PRACTICE_WORDS;

  const handleAnswer = (quality) => {
    // Оновити статистику
    setStats(prev => ({ ...prev, [quality]: prev[quality] + 1 }));
    
    // Розрахувати наступне повторення (SM-2)
    const newProgress = calculateNextReview(
      { ease_factor: 2.5, interval_days: 1, repetitions: 0 },
      quality
    );
    console.log(`${words[currentIndex].original}: next review in ${newProgress.interval_days} days`);

    // Перейти до наступного слова або завершити
    setRevealed(false);
    if (currentIndex + 1 >= words.length) {
      setFinished(true);
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const reset = () => {
    setStarted(false);
    setCurrentIndex(0);
    setRevealed(false);
    setStats({ easy: 0, good: 0, hard: 0, forgot: 0 });
    setFinished(false);
  };

  // ═══ Стан 1: Головна (до початку сесії) ═══
  if (!started) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('practice.title')}</Text>
            <Text style={styles.subtitle}>{t('practice.subtitle')}</Text>
          </View>

          {/* Статистика */}
          <View style={styles.statsCard}>
            <View style={styles.statsRow}>
              {[
                { n: 5, label: 'Due today', color: '#ea580c' },
                { n: 3, label: 'Mastered', color: '#16a34a' },
                { n: 8, label: 'Total', color: '#2563eb' },
              ].map(stat => (
                <View key={stat.label} style={styles.statItem}>
                  <Text style={[styles.statNumber, { color: stat.color }]}>{stat.n}</Text>
                  <Text style={styles.statLabel}>{stat.label}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.startButton} onPress={() => setStarted(true)} activeOpacity={0.7}>
              <Text style={styles.startButtonText}>{t('practice.start_session')}</Text>
            </TouchableOpacity>
          </View>

          {/* Вибір списку */}
          <Text style={styles.sectionLabel}>{t('practice.choose_list')}</Text>
          {MOCK_LISTS.map(list => (
            <TouchableOpacity
              key={list.id}
              style={styles.listItem}
              onPress={() => setStarted(true)}
              activeOpacity={0.6}
            >
              <Text style={styles.listEmoji}>{list.emoji}</Text>
              <Text style={styles.listName}>{list.name}</Text>
              <Text style={styles.listCount}>{list.count}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ═══ Стан 3: Результати ═══
  if (finished) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.finishedContainer}>
          <View style={styles.checkCircle}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
          <Text style={styles.finishedTitle}>{t('practice.session_complete')}</Text>

          <View style={styles.resultsGrid}>
            {ANSWER_BUTTONS.map(btn => (
              <View key={btn.key} style={[styles.resultCard, { backgroundColor: btn.bg }]}>
                <Text style={[styles.resultNumber, { color: btn.color }]}>{stats[btn.key]}</Text>
                <Text style={styles.resultLabel}>{t(`practice.answer.${btn.key}`)}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.doneButton} onPress={reset} activeOpacity={0.7}>
            <Text style={styles.doneButtonText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ═══ Стан 2: Сесія (flashcards) ═══
  const word = words[currentIndex];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.sessionContainer}>
        {/* Прогрес-бар */}
        <View style={styles.progressHeader}>
          <TouchableOpacity onPress={reset}>
            <Text style={styles.endButton}>✕ End</Text>
          </TouchableOpacity>
          <Text style={styles.progressText}>{currentIndex + 1} / {words.length}</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${((currentIndex + 1) / words.length) * 100}%` }]} />
        </View>

        {/* Flashcard */}
        <View style={styles.cardArea}>
          <TouchableOpacity
            style={styles.flashcard}
            onPress={() => !revealed && setRevealed(true)}
            activeOpacity={revealed ? 1 : 0.8}
          >
            <CefrBadge level={word.cefr} />
            <Text style={styles.flashcardWord}>{word.original}</Text>
            <Text style={styles.flashcardTranscription}>{word.transcription}</Text>

            {!revealed && (
              <Text style={styles.tapHint}>{t('practice.tap_to_reveal')}</Text>
            )}

            {revealed && (
              <View style={styles.revealedContent}>
                <View style={styles.divider} />
                <Text style={styles.flashcardTranslation}>{word.translation}</Text>
                <Text style={styles.flashcardExample}>"{word.example}"</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Кнопки оцінки */}
          {revealed && (
            <View style={styles.answerButtons}>
              {ANSWER_BUTTONS.map(btn => (
                <TouchableOpacity
                  key={btn.key}
                  style={[styles.answerButton, { backgroundColor: btn.bg, borderColor: btn.color + '20' }]}
                  onPress={() => handleAnswer(btn.key)}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.answerButtonText, { color: btn.color }]}>{t(`practice.answer.${btn.key}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: '400', color: COLORS.primary },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

  // Статистика
  statsCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.xl,
    borderWidth: 1, borderColor: COLORS.borderLight, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3,
  },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 18 },
  statItem: { alignItems: 'center' },
  statNumber: { fontSize: 28, fontWeight: '300', fontFamily: 'Courier' },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  startButton: {
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md,
    paddingVertical: 14, alignItems: 'center',
  },
  startButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  // Списки
  sectionLabel: { fontSize: 12, color: COLORS.textMuted, letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  listItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: 11, marginBottom: 6, borderWidth: 1, borderColor: COLORS.borderLight,
  },
  listEmoji: { fontSize: 16 },
  listName: { flex: 1, fontSize: 14, color: COLORS.textPrimary },
  listCount: { fontSize: 12, color: COLORS.textMuted },

  // Сесія
  sessionContainer: { flex: 1, paddingHorizontal: SPACING.xl },
  progressHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: SPACING.lg, marginBottom: 8,
  },
  endButton: { fontSize: 13, color: COLORS.textMuted },
  progressText: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Courier' },
  progressTrack: { height: 3, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: 2 },

  cardArea: { flex: 1, justifyContent: 'center', paddingBottom: 20 },
  flashcard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.xl, padding: 32,
    borderWidth: 1, borderColor: COLORS.borderLight, alignItems: 'center', minHeight: 220,
    justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
  },
  flashcardWord: { fontSize: 28, fontWeight: '400', color: COLORS.primary, marginTop: 16 },
  flashcardTranscription: { fontSize: 13, color: COLORS.textMuted, fontFamily: 'Courier', marginTop: 4 },
  tapHint: { fontSize: 13, color: COLORS.textHint, marginTop: 24, letterSpacing: 0.5 },

  revealedContent: { marginTop: 24, alignItems: 'center' },
  divider: { height: 1, backgroundColor: COLORS.borderLight, width: 120, marginBottom: 20 },
  flashcardTranslation: { fontSize: 20, fontWeight: '500', color: COLORS.textPrimary, textAlign: 'center' },
  flashcardExample: { fontSize: 13, color: COLORS.textMuted, fontStyle: 'italic', marginTop: 12, textAlign: 'center', lineHeight: 20 },

  answerButtons: { flexDirection: 'row', gap: 8, marginTop: 16 },
  answerButton: {
    flex: 1, paddingVertical: 12, borderRadius: BORDER_RADIUS.md,
    alignItems: 'center', borderWidth: 1,
  },
  answerButtonText: { fontSize: 13, fontWeight: '600' },

  // Результати
  finishedContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.xl },
  checkCircle: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#f0fdf4',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  checkMark: { fontSize: 24, color: '#16a34a' },
  finishedTitle: { fontSize: 22, fontWeight: '400', color: COLORS.primary, marginBottom: 24 },
  resultsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10, width: '100%', maxWidth: 280, marginBottom: 28,
  },
  resultCard: {
    width: '47%', borderRadius: BORDER_RADIUS.md, padding: 12,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.borderLight,
  },
  resultNumber: { fontSize: 24, fontWeight: '300', fontFamily: 'Courier' },
  resultLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
  doneButton: {
    backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md,
    paddingVertical: 12, paddingHorizontal: 32,
  },
  doneButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
});
