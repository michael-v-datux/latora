/**
 * supabase.js — Supabase client for Expo / React Native
 *
 * Reads from .env:
 * - EXPO_PUBLIC_SUPABASE_URL
 * - EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * IMPORTANT:
 * - Uses PKCE flow for OAuth (Google/Apple)
 */

import "react-native-url-polyfill/auto";
import "react-native-get-random-values"; // ✅ важливо для PKCE verifier (crypto.getRandomValues)
import * as Crypto from "expo-crypto";   // ✅ дає digest/crypto API в Expo середовищі

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// ✅ Підстрахуємо crypto, якщо середовище не має його як WebCrypto
if (!globalThis.crypto) {
  globalThis.crypto = Crypto;
}

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!SUPABASE_URL) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_URL in app env. Restart Expo with: npx expo start -c");
}
if (!SUPABASE_ANON_KEY) {
  throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY in app env. Restart Expo with: npx expo start -c");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: false,
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});