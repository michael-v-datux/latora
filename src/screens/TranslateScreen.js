/**
 * TranslateScreen.js — Головний екран перекладу
 * 
 * Це перший і найважливіший екран додатка.
 * Користувач вводить англійське слово → отримує:
 * - переклад українською
 * - рівень складності CEFR
 * - шкалу складності
 * - приклад у реченні
 * - можливість додати в список
 */

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import WordCard from '../components/WordCard';
import AddToListModal from '../components/AddToListModal';
import { translateWord } from '../services/translateService';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';

// Тимчасові моковані списки (потім замінимо на реальні з Supabase)
const MOCK_LISTS = [
  { id: '1', name: 'Abstract Concepts', emoji: '💭', word_count: 3 },
  { id: '2', name: 'Emotions & States', emoji: '🎭', word_count: 2 },
  { id: '3', name: 'Business English', emoji: '💼', word_count: 2 },
  { id: '4', name: 'Nature & Weather', emoji: '🌿', word_count: 1 },
];

export default function TranslateScreen() {
  // === Стани (state) — дані, які можуть змінюватись ===
  const [query, setQuery] = useState('');          // текст у полі вводу
  const [result, setResult] = useState(null);       // результат перекладу
  const [loading, setLoading] = useState(false);    // індикатор завантаження
  const [error, setError] = useState(null);         // повідомлення про помилку
  const [showModal, setShowModal] = useState(false); // чи відкрита модалка списків
  const [isAdded, setIsAdded] = useState(false);    // чи додано в список

  /**
   * Обробити натискання кнопки "Translate"
   */
  const handleTranslate = async () => {
    // Ігноруємо порожній ввід
    if (!query.trim()) return;

    setLoading(true);    // показати "завантаження..."
    setError(null);      // очистити попередню помилку
    setResult(null);     // очистити попередній результат
    setIsAdded(false);   // скинути статус "додано"

    try {
      // Викликаємо сервіс перекладу (запит на бекенд)
      const data = await translateWord(query);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);  // прибрати "завантаження..." в будь-якому випадку
    }
  };

  /**
   * Додати слово в обраний список
   */
  const handleAddToList = (listId) => {
    // TODO: реальний запит до Supabase
    console.log('Додаємо слово в список:', listId);
    setShowModal(false);
    setIsAdded(true);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView 
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Заголовок */}
          <View style={styles.header}>
            <Text style={styles.title}>Translate</Text>
            <Text style={styles.subtitle}>EN → UK · powered by AI</Text>
          </View>

          {/* Поле вводу */}
          <View style={styles.inputCard}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Enter English word..."
              placeholderTextColor={COLORS.textHint}
              returnKeyType="search"
              onSubmitEditing={handleTranslate}
              autoCorrect={false}
              autoCapitalize="none"
            />
            <View style={styles.inputFooter}>
              <Text style={styles.hint}>Try: serendipity, ephemeral, reluctant</Text>
              <TouchableOpacity
                style={[styles.translateButton, !query.trim() && styles.translateButtonDisabled]}
                onPress={handleTranslate}
                disabled={!query.trim() || loading}
                activeOpacity={0.7}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={[styles.translateButtonText, !query.trim() && styles.translateButtonTextDisabled]}>
                    Translate
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Помилка */}
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Результат перекладу */}
          {result && (
            <View style={styles.resultContainer}>
              <WordCard
                word={result}
                onAddToList={() => setShowModal(true)}
                isAdded={isAdded}
              />
            </View>
          )}

          {/* Відступ внизу для зручного скролу */}
          <View style={{ height: 40 }} />
        </ScrollView>

        {/* Модалка вибору списку */}
        <AddToListModal
          visible={showModal}
          lists={MOCK_LISTS}
          suggestedList={result?.suggested_list || 'Abstract Concepts'}
          onSelect={handleAddToList}
          onClose={() => setShowModal(false)}
          onCreateNew={() => {
            setShowModal(false);
            // TODO: навігація до створення нового списку
            console.log('Створити новий список');
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: SPACING.xl,
  },
  header: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  title: {
    fontSize: 28,
    fontWeight: '400',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 4,
    letterSpacing: 0.2,
  },
  inputCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  input: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '400',
    letterSpacing: -0.3,
    paddingVertical: 0,
  },
  inputFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  hint: {
    fontSize: 11,
    color: COLORS.textHint,
    letterSpacing: 0.3,
    flex: 1,
  },
  translateButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 20,
  },
  translateButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  translateButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  translateButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: BORDER_RADIUS.md,
    padding: 12,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
  },
  resultContainer: {
    marginBottom: SPACING.lg,
  },
});
