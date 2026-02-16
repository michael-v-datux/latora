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
 * - Supabase → Auth → URL Configuration (Redirect URLs):
 *     https://auth.expo.io/@bill_lava/LexiLevel
 *     lexilevel://auth/callback
 *     lexilevel://
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "../config/supabase";

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext(null);

// Expo Go detection
const isExpoGo = Constants.appOwnership === "expo";

// Fixed proxy redirect for Expo Go to avoid localhost / --/ path variations
const EXPO_PROXY_REDIRECT = "https://auth.expo.io/@bill_lava/LexiLevel";

// Toggle to see OAuth flow details
const DEBUG_OAUTH = true;

function friendlyAuthError(err) {
  const msg = err?.message || "Auth error";

  if (/Invalid login credentials/i.test(msg)) return "Невірний email або пароль";
  if (/User already registered/i.test(msg)) return "Користувач з таким email вже існує";
  if (/Password should be at least/i.test(msg)) return "Пароль має бути мінімум 6 символів";
  if (/Email not confirmed/i.test(msg)) return "Підтвердіть email у листі (якщо увімкнено підтвердження)";
  if (/OAuth was cancelled/i.test(msg)) return "Вхід скасовано";
  if (/invalid flow state/i.test(msg)) return "OAuth стан зламався (flow state). Спробуй ще раз або перезапусти апку.";

  // Common redirect whitelist errors
  if (/redirect/i.test(msg) && /not allowed|not permitted|invalid/i.test(msg)) {
    return "Redirect URL не дозволений. Перевір Redirect URLs у Supabase.";
  }

  return msg;
}

async function ensureAuthSession() {
  try {
    const AuthSessionMod = await import("expo-auth-session");
    // dynamic import інколи кладе експорт у .default
    return AuthSessionMod?.default ?? AuthSessionMod;
  } catch (_e) {
    const help =
      "Для входу через Google/Apple встанови пакети:\n" +
      "  npx expo install expo-auth-session expo-web-browser\n" +
      "і налаштуй Redirect URLs у Supabase (Auth → URL Configuration).";
    throw new Error(help);
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

function parseImplicitTokensFromUrl(url) {
  // implicit returns tokens in fragment: #access_token=...&refresh_token=...
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return null;

  const fragment = url.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);

  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");

  if (!access_token || !refresh_token) return null;
  return { access_token, refresh_token };
}

async function finalizeOAuthRedirect(resUrl) {
  // Prefer PKCE code flow if present
  if (resUrl.includes("?code=") || resUrl.includes("&code=")) {
    let code = null;

    try {
      code = new URL(resUrl).searchParams.get("code");
    } catch {
      // на всякий випадок, якщо URL не парситься
      const match = resUrl.match(/[?&]code=([^&]+)/);
      code = match?.[1] ?? null;
    }

    if (!code) throw new Error("OAuth redirect did not include code");

    // ✅ ВАЖЛИВО: передаємо тільки code, не весь URL
    const { data: exchanged, error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) throw exErr;

    return exchanged?.session ?? true;
  }

  // Fallback: implicit tokens in hash
  if (resUrl.includes("#access_token=")) {
    const tokens = parseImplicitTokensFromUrl(resUrl);
    if (!tokens) throw new Error("OAuth tokens missing in redirect URL");

    const { data: setData, error: setErr } = await supabase.auth.setSession(tokens);
    if (setErr) throw setErr;

    return setData?.session ?? true;
  }

  // Unknown result
  throw new Error("OAuth redirect URL did not contain code or tokens");
}

async function signInWithOAuthProvider(provider) {
  const AuthSession = await ensureAuthSession();

  const redirectTo = getRedirectTo(AuthSession);

  if (DEBUG_OAUTH) {
    console.log("isExpoGo:", isExpoGo);
    console.log("redirectTo:", redirectTo);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      // RN — don't let supabase-js try to redirect like a web browser
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data?.url) throw new Error("OAuth URL was not returned");

  // Open auth in browser and return to redirectTo
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (DEBUG_OAUTH) {
    console.log("openAuthSessionAsync:", res?.type, res?.url ? res.url.slice(0, 140) : null);
  }

  if (res.type !== "success" || !res.url) {
    throw new Error("OAuth was cancelled");
  }

  // Finalize: PKCE (?code=) or implicit (#access_token=)
  return await finalizeOAuthRedirect(res.url);
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