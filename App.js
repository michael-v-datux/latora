/**
 * App.js — Головний файл додатка LexiLevel
 * 
 * Це "точка входу" — перше, що запускається коли ви відкриваєте додаток.
 * Тут ми підключаємо навігацію (перехід між екранами) та провайдер авторизації.
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import TabNavigator from './src/navigation/TabNavigator';
import { AuthProvider } from './src/hooks/useAuth';

export default function App() {
  return (
    // SafeAreaProvider — забезпечує правильні відступи від "чубчика" iPhone
    <SafeAreaProvider>
      {/* AuthProvider — обгортка, яка дає доступ до даних користувача на всіх екранах */}
      <AuthProvider>
        {/* NavigationContainer — контейнер для всієї навігації */}
        <NavigationContainer>
          {/* TabNavigator — нижня панель з вкладками (Translate, Lists, Practice, Profile) */}
          <TabNavigator />
        </NavigationContainer>
      </AuthProvider>
      {/* StatusBar — верхня панель з часом, батареєю тощо (стиль: темний текст на світлому фоні) */}
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
