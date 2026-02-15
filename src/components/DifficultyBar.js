/**
 * DifficultyBar.js — Візуальна шкала складності
 * 
 * Показує горизонтальну шкалу від 0 до 100, де:
 * - 0-30: зелений (легко)
 * - 30-50: салатовий
 * - 50-65: жовтий
 * - 65-80: оранжевий
 * - 80-100: червоний (дуже складно)
 * 
 * Використання:
 *   <DifficultyBar score={75} />
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Функція, яка повертає колір залежно від числового балу
function getColor(score) {
  if (score < 30) return '#16a34a';  // зелений
  if (score < 50) return '#65a30d';  // салатовий
  if (score < 65) return '#ca8a04';  // жовтий
  if (score < 80) return '#ea580c';  // оранжевий
  return '#dc2626';                  // червоний
}

export default function DifficultyBar({ score }) {
  const color = getColor(score);

  return (
    <View style={styles.container}>
      {/* Фон шкали */}
      <View style={styles.track}>
        {/* Заповнена частина шкали */}
        <View style={[styles.fill, { width: `${score}%`, backgroundColor: color }]} />
      </View>
      {/* Числове значення праворуч */}
      <Text style={styles.score}>{score}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',   // розташувати елементи горизонтально
    alignItems: 'center',   // вирівняти по центру вертикально
    gap: 8,
  },
  track: {
    flex: 1,                // зайняти всю доступну ширину
    height: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 2,
    overflow: 'hidden',     // обрізати вміст по краях (для заокруглення)
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  score: {
    fontSize: 11,
    color: '#94a3b8',
    fontFamily: 'Courier',
    minWidth: 22,
    textAlign: 'right',
  },
});
