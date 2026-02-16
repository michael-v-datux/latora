/**
 * CefrBadge.js — Бейдж рівня складності CEFR
 * 
 * Показує маленький кольоровий бейдж з рівнем (A1, A2, B1, B2, C1, C2).
 * Колір автоматично відповідає рівню: зелений для легких, червоний для складних.
 * 
 * Використання:
 *   <CefrBadge level="B2" />
 *   <CefrBadge level="A1" small />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CEFR_COLORS } from '../utils/constants';

export default function CefrBadge({ level, small = false }) {
  // Отримуємо колір для даного рівня
  const color = CEFR_COLORS[level] || '#64748b';

  return (
    <View style={[
      styles.badge,
      small && styles.badgeSmall,
      { 
        backgroundColor: color + '12',  // колір з прозорістю (12 = ~7%)
        borderColor: color + '30',       // трохи темніша рамка
      },
    ]}>
      <Text style={[
        styles.text,
        small && styles.textSmall,
        { color },
      ]}>
        {level}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1.5,
    alignSelf: 'flex-end', // ширина за вмістом, а не на всю ширину
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: 'Courier', // моноширинний шрифт для технічного вигляду
  },
  textSmall: {
    fontSize: 10,
  },
});
