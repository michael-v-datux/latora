/**
 * supabase.js — Підключення до Supabase
 * 
 * Supabase — це наша база даних та система авторизації.
 * Цей файл створює клієнт, через який ми будемо:
 * - зберігати/отримувати слова, списки, прогрес
 * - реєструвати та авторизувати користувачів
 * 
 * Для роботи потрібні дві змінні з файлу .env:
 * - SUPABASE_URL — адреса вашого проєкту Supabase
 * - SUPABASE_ANON_KEY — публічний ключ доступу
 */

import 'react-native-url-polyfill/auto'; // Потрібно для коректної роботи URL в React Native
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Зчитуємо змінні середовища
// ⚠️ Замініть ці значення на ваші реальні з Supabase Dashboard → Settings → API
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

// Створюємо клієнт Supabase
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // AsyncStorage зберігає токен авторизації на пристрої,
    // щоб користувач не логінився кожного разу
    storage: AsyncStorage,
    autoRefreshToken: true,       // автоматично оновлювати токен
    persistSession: true,         // зберігати сесію між перезапусками
    detectSessionInUrl: false,    // не потрібно для мобільного додатка
  },
});
