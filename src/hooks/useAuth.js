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
 * - Expo Go → useProxy: true → https://auth.expo.io/@username/slug/auth/callback
 * - Dev build / Standalone → useProxy: false → lexilevel://auth/callback
 *
 * IMPORTANT:
 * - Add "scheme": "lexilevel" to app.json
 * - Add both Redirect URLs in Supabase:
 *   - https://auth.expo.io/@bill_lava/LexiLevel/auth/callback
 *   - lexilevel://auth/callback
 *   (+ optional: lexilevel://)
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";

import { supabase } from "../config/supabase";

const AuthContext = createContext(null);

const isExpoGo = Constants.appOwnership === "expo";

function friendlyAuthError(err) {
  const msg = err?.message || "Auth error";

  if (/Invalid login credentials/i.test(msg)) return "Невірний email або пароль";
  if (/User already registered/i.test(msg)) return "Користувач з таким email вже існує";
  if (/Password should be at least/i.test(msg)) return "Пароль має бути мінімум 6 символів";
  if (/Email not confirmed/i.test(msg)) return "Підтвердіть email у листі (якщо увімкнено підтвердження)";
  if (/OAuth was cancelled/i.test(msg)) return "Вхід скасовано";
  if (/redirect/i.test(msg) && /not allowed|not permitted|invalid/i.test(msg)) {
    return "Redirect URL не дозволений. Перевір Redirect URLs у Supabase.";
  }
  return msg;
}

async function ensureOAuthDeps() {
  try {
    const WebBrowser = await import("expo-web-browser");
    const AuthSession = await import("expo-auth-session");
    return { WebBrowser, AuthSession };
  } catch (e) {
    const help =
      "Для входу через Google/Apple встанови пакети:\n" +
      "  npx expo install expo-auth-session expo-web-browser\n" +
      "і налаштуй Redirect URLs у Supabase (Auth → URL Configuration).";
    const err = new Error(help);
    err.code = "OAUTH_DEPS_MISSING";
    throw err;
  }
}

async function signInWithOAuthProvider(provider) {
  const { WebBrowser, AuthSession } = await ensureOAuthDeps();

  // Required for iOS to close Safari view correctly after auth.
  WebBrowser.maybeCompleteAuthSession?.();

  const redirectTo = AuthSession.makeRedirectUri({
    useProxy: isExpoGo,          // Expo Go: true, Dev build: false
    scheme: "lexilevel",         // for dev build/standalone
    path: "auth/callback",
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("OAuth URL was not returned");

  const result = await AuthSession.startAsync({
    authUrl: data.url,
    returnUrl: redirectTo,
  });

  if (result.type !== "success") {
    throw new Error("OAuth was cancelled");
  }

  // Session will be picked up by onAuthStateChange after redirect.
  return true;
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