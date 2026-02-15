/**
 * AddToListModal.js — Модальне вікно "Додати в список"
 * 
 * Коли користувач натискає "+ Add to list", з'являється це вікно з:
 * - AI-рекомендацією списку
 * - списком існуючих списків
 * - можливістю створити новий список
 * 
 * Використання:
 *   <AddToListModal
 *     visible={true}
 *     lists={[...]}
 *     suggestedList="Business English"
 *     onSelect={(listId) => ...}
 *     onClose={() => ...}
 *     onCreateNew={() => ...}
 *   />
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  StyleSheet, FlatList, TextInput, Pressable,
} from 'react-native';
import { COLORS, SPACING, BORDER_RADIUS } from '../utils/constants';

export default function AddToListModal({
  visible,
  lists = [],
  suggestedList = null,
  onSelect,
  onClose,
  onCreateNew,
}) {
  return (
    <Modal
      visible={visible}
      transparent={true}           // прозорий фон (ми самі малюємо затемнення)
      animationType="slide"        // анімація появи знизу
      onRequestClose={onClose}     // закрити по кнопці "Назад" на Android
    >
      {/* Затемнений фон (натискання закриває модалку) */}
      <Pressable style={styles.overlay} onPress={onClose}>
        {/* Контент модалки (stopPropagation щоб натискання не закривало) */}
        <Pressable style={styles.modal} onPress={() => {}}>
          {/* Заголовок + кнопка закриття */}
          <View style={styles.header}>
            <Text style={styles.title}>Add to list</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* AI-рекомендація */}
          {suggestedList && (
            <View style={styles.suggestion}>
              <Text style={styles.suggestionIcon}>🤖</Text>
              <Text style={styles.suggestionText}>
                AI suggests: <Text style={styles.suggestionName}>{suggestedList}</Text>
              </Text>
            </View>
          )}

          {/* Список існуючих списків */}
          <FlatList
            data={lists}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.listItem,
                  // Підсвічуємо рекомендований список
                  item.name === suggestedList && styles.listItemSuggested,
                ]}
                onPress={() => onSelect(item.id)}
                activeOpacity={0.6}
              >
                <Text style={styles.listEmoji}>{item.emoji || '📚'}</Text>
                <Text style={styles.listName}>{item.name}</Text>
                <Text style={styles.listCount}>{item.word_count || 0} words</Text>
              </TouchableOpacity>
            )}
            style={styles.flatList}
          />

          {/* Кнопка "Створити новий список" */}
          <TouchableOpacity style={styles.createNew} onPress={onCreateNew} activeOpacity={0.6}>
            <Text style={styles.createNewText}>+ Create new list</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',  // напівпрозоре затемнення
    justifyContent: 'flex-end',           // модалка з'являється знизу
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.xl,
    maxHeight: '60%',  // максимум 60% екрана
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.primary,
  },
  closeButton: {
    fontSize: 18,
    color: COLORS.textMuted,
    padding: 4,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0fdf4',
    borderRadius: BORDER_RADIUS.md,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    gap: 10,
  },
  suggestionIcon: {
    fontSize: 14,
  },
  suggestionText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  suggestionName: {
    fontWeight: '700',
    color: '#16a34a',
  },
  flatList: {
    maxHeight: 250,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 2,
    gap: 12,
  },
  listItemSuggested: {
    backgroundColor: '#fafbfc',
  },
  listEmoji: {
    fontSize: 18,
  },
  listName: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
  },
  listCount: {
    fontSize: 12,
    color: COLORS.textMuted,
  },
  createNew: {
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: COLORS.border,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6,
  },
  createNewText: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
});
