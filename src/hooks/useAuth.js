/**
 * useAuth.js — Хук авторизації
 * 
 * "Хук" (hook) — це спосіб додати функціональність до React-компонентів.
 * Цей хук відповідає за:
 * - відстеження чи користувач увійшов в систему
 * - реєстрацію нового користувача
 * - вхід / вихід з акаунта
 * 
 * Використання в будь-якому компоненті:
 *   const { user, signIn, signUp, signOut } = useAuth();
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';

// Контекст — це "глобальне сховище", доступне всім компонентам
const AuthContext = createContext({});

/**
 * AuthProvider — обгортка, яку ми ставимо в App.js
 * Вона відстежує стан авторизації та передає його дочірнім компонентам.
 */
export function AuthProvider({ children }) {
  // useState — зберігає значення, яке може змінюватись
  const [user, setUser] = useState(null);         // дані користувача (або null якщо не увійшов)
  const [loading, setLoading] = useState(true);    // чи завантажується перевірка авторизації
  const [session, setSession] = useState(null);    // дані сесії (токен доступу)

  // useEffect — виконується один раз при завантаженні додатка
  useEffect(() => {
    // Перевіряємо чи є збережена сесія (чи користувач вже був залогінений)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Підписуємось на зміни авторизації (логін, логаут, оновлення токена)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    // Відписуємось коли компонент знищується (запобігає витокам пам'яті)
    return () => subscription.unsubscribe();
  }, []);

  /**
   * Реєстрація нового користувача
   * @param {string} email — електронна пошта
   * @param {string} password — пароль (мін. 6 символів)
   */
  const signUp = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  /**
   * Вхід існуючого користувача
   */
  const signIn = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  /**
   * Вихід з акаунта
   */
  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  // Передаємо всі дані та функції через контекст
  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * useAuth — хук для використання в компонентах
 * Приклад: const { user, signOut } = useAuth();
 */
export function useAuth() {
  return useContext(AuthContext);
}
