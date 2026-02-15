/**
 * ListsScreen.js — Екран списків слів
 * 
 * Показує всі списки користувача з прогресом вивчення.
 * При натисканні відкриває список зі словами.
 */

import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CefrBadge from '../components/CefrBadge';
import DifficultyBar from '../components/DifficultyBar';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';

// === Тимчасові дані (замінимо на Supabase) ===
const MOCK_LISTS = [
  { id: '1', name: 'Abstract Concepts', emoji: '💭', word_count: 3, progress: 45 },
  { id: '2', name: 'Emotions & States', emoji: '🎭', word_count: 2, progress: 70 },
  { id: '3', name: 'Business English', emoji: '💼', word_count: 2, progress: 30 },
  { id: '4', name: 'Nature & Weather', emoji: '🌿', word_count: 1, progress: 90 },
];

const MOCK_WORDS = {
  '1': [
    { id: 'w1', original: 'serendipity', translation: 'щаслива випадковість', cefr: 'C1', score: 82 },
    { id: 'w2', original: 'ephemeral', translation: 'ефемерний', cefr: 'C1', score: 78 },
    { id: 'w6', original: 'ubiquitous', translation: 'всюдисущий', cefr: 'C2', score: 91 },
  ],
  '2': [
    { id: 'w3', original: 'reluctant', translation: 'неохочий', cefr: 'B2', score: 58 },
    { id: 'w7', original: 'procrastinate', translation: 'зволікати', cefr: 'B2', score: 62 },
  ],
  '3': [
    { id: 'w4', original: 'accomplish', translation: 'досягати', cefr: 'B1', score: 42 },
    { id: 'w8', original: 'benchmark', translation: 'орієнтир', cefr: 'B2', score: 55 },
  ],
  '4': [
    { id: 'w5', original: 'breeze', translation: 'легкий вітерець', cefr: 'A2', score: 25 },
  ],
};

export default function ListsScreen() {
  // Зберігаємо обраний список (null = показувати всі списки)
  const [selectedList, setSelectedList] = useState(null);

  // === Вигляд зі словами конкретного списку ===
  if (selectedList) {
    const words = MOCK_WORDS[selectedList.id] || [];
    
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.container}>
          {/* Кнопка "Назад" */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => setSelectedList(null)}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          {/* Заголовок списку */}
          <View style={styles.listHeader}>
            <Text style={styles.listEmoji}>{selectedList.emoji}</Text>
            <View>
              <Text style={styles.listTitle}>{selectedList.name}</Text>
              <Text style={styles.listSubtitle}>{words.length} words</Text>
            </View>
          </View>

          {/* Слова в списку */}
          <FlatList
            data={words}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={styles.wordItem}>
                <View style={styles.wordLeft}>
                  <View style={styles.wordHeader}>
                    <Text style={styles.wordOriginal}>{item.original}</Text>
                    <CefrBadge level={item.cefr} small />
                  </View>
                  <Text style={styles.wordTranslation}>{item.translation}</Text>
                </View>
                <View style={styles.wordRight}>
                  <DifficultyBar score={item.score} />
                </View>
              </View>
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // === Вигляд з усіма списками ===
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Заголовок */}
        <View style={styles.header}>
          <Text style={styles.title}>My Lists</Text>
          <Text style={styles.subtitle}>
            {MOCK_LISTS.reduce((sum, l) => sum + l.word_count, 0)} words across {MOCK_LISTS.length} lists
          </Text>
        </View>

        {/* Список списків */}
        {MOCK_LISTS.map((list) => (
          <TouchableOpacity
            key={list.id}
            style={styles.listCard}
            onPress={() => setSelectedList(list)}
            activeOpacity={0.7}
          >
            <View style={styles.listCardHeader}>
              <View style={styles.listCardInfo}>
                <Text style={styles.listCardEmoji}>{list.emoji}</Text>
                <View>
                  <Text style={styles.listCardName}>{list.name}</Text>
                  <Text style={styles.listCardCount}>{list.word_count} words</Text>
                </View>
              </View>
              <Text style={styles.listCardPercent}>{list.progress}%</Text>
            </View>
            {/* Шкала прогресу */}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${list.progress}%` }]} />
            </View>
          </TouchableOpacity>
        ))}

        {/* Кнопка "Новий список" */}
        <TouchableOpacity style={styles.newListButton} activeOpacity={0.6}>
          <Text style={styles.newListText}>+ New list</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, paddingHorizontal: SPACING.xl },
  
  // Заголовок
  header: { paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: '400', color: COLORS.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 4 },

  // Картка списку
  listCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 3,
    elevation: 1,
  },
  listCardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  listCardInfo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  listCardEmoji: { fontSize: 22 },
  listCardName: { fontSize: 15, fontWeight: '500', color: COLORS.primary },
  listCardCount: { fontSize: 12, color: COLORS.textMuted },
  listCardPercent: { fontSize: 12, color: COLORS.textMuted, fontFamily: 'Courier' },
  
  progressTrack: { height: 3, backgroundColor: COLORS.borderLight, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2, backgroundColor: COLORS.accent },

  // Кнопка нового списку
  newListButton: {
    padding: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg, alignItems: 'center', marginTop: 4,
  },
  newListText: { fontSize: 14, color: COLORS.textMuted },

  // Деталі списку
  backButton: { paddingVertical: SPACING.lg },
  backText: { fontSize: 13, color: COLORS.textMuted },
  listHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: SPACING.xl },
  listEmoji: { fontSize: 28 },
  listTitle: { fontSize: 24, fontWeight: '400', color: COLORS.primary },
  listSubtitle: { fontSize: 12, color: COLORS.textMuted },

  // Слово в списку
  wordItem: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.borderLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.03, shadowRadius: 2,
  },
  wordLeft: { flex: 1 },
  wordHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  wordOriginal: { fontSize: 16, fontWeight: '500', color: COLORS.primary },
  wordTranslation: { fontSize: 13, color: COLORS.textMuted },
  wordRight: { width: 100 },
});
