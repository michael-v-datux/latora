/**
 * TabNavigator.js — Нижня панель навігації
 * 
 * Це та панель з іконками внизу екрана (як в Instagram, Telegram тощо).
 * Тут визначаються 4 вкладки: Translate, Lists, Practice, Profile.
 * 
 * @react-navigation/bottom-tabs автоматично:
 * - показує іконки та назви
 * - перемикає між екранами
 * - підсвічує активну вкладку
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';  // Безкоштовні іконки від Expo
import { COLORS } from '../utils/constants';
import { useI18n } from '../i18n';

// Імпортуємо екрани
import TranslateScreen from '../screens/TranslateScreen';
import ListsScreen from '../screens/ListsScreen';
import PracticeScreen from '../screens/PracticeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ProScreen from '../screens/ProScreen';
import SettingsScreen, {
  NotificationsScreen,
  AppLanguageScreen,
  AboutScreen,
  DeleteAccountScreen,
} from '../screens/SettingsScreen';

// Створюємо навігатори
const Tab = createBottomTabNavigator();
const ProfileStack = createNativeStackNavigator();

// Profile tab — stack so ProfileScreen can push to ProScreen / Settings / etc.
function ProfileStackNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain"    component={ProfileScreen} />
      <ProfileStack.Screen name="ProScreen"      component={ProScreen} />
      <ProfileStack.Screen name="Settings"       component={SettingsScreen} />
      <ProfileStack.Screen name="Notifications"  component={NotificationsScreen} />
      <ProfileStack.Screen name="AppLanguage"    component={AppLanguageScreen} />
      <ProfileStack.Screen name="About"          component={AboutScreen} />
      <ProfileStack.Screen name="DeleteAccount"  component={DeleteAccountScreen} />
    </ProfileStack.Navigator>
  );
}

export default function TabNavigator() {
  const { t } = useI18n();
  return (
    <Tab.Navigator
      // Глобальні налаштування для всіх вкладок
      screenOptions={({ route }) => ({
        // Визначаємо іконку для кожної вкладки
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          // Обираємо іконку залежно від назви вкладки
          // "focused" означає що вкладка зараз активна
          switch (route.name) {
            case 'Translate':
              iconName = focused ? 'search' : 'search-outline';
              break;
            case 'Lists':
              iconName = focused ? 'list' : 'list-outline';
              break;
            case 'Practice':
              iconName = focused ? 'fitness' : 'fitness-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
          }

          return <Ionicons name={iconName} size={22} color={color} />;
        },

        // Стилізація панелі
        tabBarActiveTintColor: COLORS.primary,      // колір активної іконки
        tabBarInactiveTintColor: COLORS.textMuted,   // колір неактивної іконки
        tabBarStyle: {
          backgroundColor: COLORS.surface,           // білий фон
          borderTopColor: COLORS.border,             // тонка лінія зверху
          borderTopWidth: 1,
          paddingBottom: 4,
          height: 85,                                // висота панелі
        },
        tabBarLabelStyle: {
          fontSize: 10,                              // розмір тексту під іконкою
          fontWeight: '500',
        },
        headerShown: false,                          // прибираємо стандартний заголовок
      })}
    >
      {/* Кожен Tab.Screen — це одна вкладка */}
      <Tab.Screen name="Translate" component={TranslateScreen} options={{ tabBarLabel: t('tabs.translate') }} />
      <Tab.Screen name="Lists" component={ListsScreen} options={{ tabBarLabel: t('tabs.lists') }} />
      <Tab.Screen name="Practice" component={PracticeScreen} options={{ tabBarLabel: t('tabs.practice') }} />
      <Tab.Screen name="Profile" component={ProfileStackNavigator} options={{ tabBarLabel: t('tabs.profile') }} />
    </Tab.Navigator>
  );
}
