/**
 * supabase.js — Supabase client for Expo / React Native
 *
 * Reads from .env:
 * - EXPO_PUBLIC_SUPABASE_URL
 * - EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * IMPORTANT:
 * - Uses PKCE flow for OAuth (Google/Apple) to work with exchangeCodeForSession()
 */

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || "").trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "").trim();

if (!SUPABASE_URL) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL in app env. Add it to .env and restart Expo with: npx expo start -c"
  );
}

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_ANON_KEY in app env. Add it to .env and restart Expo with: npx expo start -c"
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // ✅ Required for OAuth flow where you call exchangeCodeForSession(res.url)
    flowType: "pkce",

    // RN/Expo is not a web browser that can parse sessions from URL reliably
    detectSessionInUrl: false,

    // Persist session on device
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});