/**
 * useAuth.js — Supabase Auth hook + provider
 *
 * Provides:
 * - user, session, loading
 * - signUp(email, password)
 * - signIn(email, password)
 * - signOut()
 * - signInWithGoogle()
 * - signInWithApple()
 *
 * OAuth (Google/Apple):
 * - Expo Go → fixed proxy redirect → https://auth.expo.io/@bill_lava/LexiLevel
 * - Dev build / Standalone → lexilevel://auth/callback
 *
 * IMPORTANT:
 * - app.json must include: { "expo": { "scheme": "lexilevel" } }
 * - Supabase → Auth → URL Configuration:
 *   - Site URL (for Expo Go dev): https://auth.expo.io/@bill_lava/LexiLevel
 *   - Additional Redirect URLs:
 *       https://auth.expo.io/@bill_lava/LexiLevel
 *       lexilevel://auth/callback
 *       lexilevel://
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";

import { supabase } from "../config/supabase";

const AuthContext = createContext(null);

// Expo Go detection
const isExpoGo = Constants.appOwnership === "expo";

// ✅ Fixed proxy redirect for Expo Go to avoid localhost / --/ path variations
const EXPO_PROXY_REDIRECT = "https://auth.expo.io/@bill_lava/LexiLevel";

function friendlyAuthError(err) {
  const msg = err?.message || "Auth error";

  if (/Invalid login credentials/i.test(msg)) return "Невірний email або пароль";
  if (/User already registered/i.test(msg)) return "Користувач з таким email вже існує";
  if (/Password should be at least/i.test(msg)) return "Пароль має бути мінімум 6 символів";
  if (/Email not confirmed/i.test(msg)) return "Підтвердіть email у листі (якщо увімкнено підтвердження)";
  if (/OAuth was cancelled/i.test(msg)) return "Вхід скасовано";

  // Common redirect whitelist errors
  if (/redirect/i.test(msg) && /not allowed|not permitted|invalid/i.test(msg)) {
    return "Redirect URL не дозволений. Перевір Redirect URLs у Supabase.";
  }

  return msg;
}

async function ensureOAuthDeps() {
  try {
    const WebBrowserMod = await import("expo-web-browser");
    const AuthSessionMod = await import("expo-auth-session");

    // Dynamic import інколи кладе експорт у .default
    const WebBrowser = WebBrowserMod?.default ?? WebBrowserMod;
    const AuthSession = AuthSessionMod?.default ?? AuthSessionMod;

    return { WebBrowser, AuthSession };
  } catch (_e) {
    const help =
      "Для входу через Google/Apple встанови пакети:\n" +
      "  npx expo install expo-auth-session expo-web-browser expo-crypto\n" +
      "і налаштуй Redirect URLs у Supabase (Auth → URL Configuration).";
    const err = new Error(help);
    err.code = "OAUTH_DEPS_MISSING";
    throw err;
  }
}

function getRedirectTo(AuthSession) {
  if (isExpoGo) return EXPO_PROXY_REDIRECT;

  // Dev build / standalone
  return AuthSession.makeRedirectUri({
    scheme: "lexilevel",
    path: "auth/callback",
    preferLocalhost: false,
  });
}

async function signInWithOAuthProvider(provider) {
  const { WebBrowser, AuthSession } = await ensureOAuthDeps();

  WebBrowser.maybeCompleteAuthSession?.();

  const redirectTo = getRedirectTo(AuthSession);

  // 🔎 Debug if needed:
  console.log("isExpoGo:", isExpoGo);
  console.log("redirectTo:", redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("OAuth URL was not returned");

  // 🔎 Debug if needed:
  // console.log("supabase oauth url:", data.url);

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (res.type !== "success" || !res.url) {
    throw new Error("OAuth was cancelled");
  }

  // PKCE: exchange code for session
  const { data: exchanged, error: exErr } = await supabase.auth.exchangeCodeForSession(res.url);
  if (exErr) throw exErr;

  return exchanged?.session ?? true;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsub = null;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data?.session ?? null);
        setUser(data?.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    unsub = data?.subscription;

    return () => {
      try {
        unsub?.unsubscribe?.();
      } catch {}
    };
  }, []);

  const api = useMemo(() => {
    return {
      user,
      session,
      loading,

      async signUp(email, password) {
        try {
          const { data, error } = await supabase.auth.signUp({ email, password });
          if (error) throw error;
          return data;
        } catch (e) {
          throw new Error(friendlyAuthError(e));
        }
      },

      async signIn(email, password) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
          return data;
        } catch (e) {
          throw new Error(friendlyAuthError(e));
        }
      },

      async signOut() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      },

      async signInWithGoogle() {
        try {
          return await signInWithOAuthProvider("google");
        } catch (e) {
          throw new Error(friendlyAuthError(e));
        }
      },

      async signInWithApple() {
        if (Platform.OS !== "ios") {
          throw new Error("AppleID доступний лише на iOS");
        }
        try {
          return await signInWithOAuthProvider("apple");
        } catch (e) {
          throw new Error(friendlyAuthError(e));
        }
      },
    };
  }, [user, session, loading]);

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}