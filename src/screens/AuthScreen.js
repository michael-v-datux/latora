/**
 * AuthScreen.js — Login / Sign Up screen (Email+Password) + OAuth buttons
 */

import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../utils/constants";
import { useAuth } from "../hooks/useAuth";

export default function AuthScreen() {
  const { signIn, signUp, signInWithGoogle, signInWithApple } = useAuth();

  const [mode, setMode] = useState("signin"); // signin | signup
  const isSignIn = mode === "signin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const disabled = useMemo(() => {
    return busy || email.trim().length === 0 || password.length < 6;
  }, [busy, email, password]);

  async function onSubmit() {
    setBusy(true);
    try {
      if (isSignIn) {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
        Alert.alert("Готово", "Акаунт створено. Тепер можна увійти.");
        setMode("signin");
      }
    } catch (e) {
      Alert.alert("Помилка", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert("Google", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onApple() {
    setBusy(true);
    try {
      await signInWithApple();
    } catch (e) {
      Alert.alert("Apple", e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>LexiLevel</Text>
        <Text style={styles.subtitle}>
          {isSignIn ? "Увійди, щоб бачити свої списки" : "Створи акаунт, щоб зберігати прогрес"}
        </Text>

        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, isSignIn && styles.segmentBtnActive]}
            onPress={() => setMode("signin")}
            disabled={busy}
          >
            <Text style={[styles.segmentText, isSignIn && styles.segmentTextActive]}>Вхід</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, !isSignIn && styles.segmentBtnActive]}
            onPress={() => setMode("signup")}
            disabled={busy}
          >
            <Text style={[styles.segmentText, !isSignIn && styles.segmentTextActive]}>Реєстрація</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          placeholder="Пароль (мін. 6 символів)"
          placeholderTextColor={COLORS.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!busy}
        />

        <TouchableOpacity
          style={[styles.primaryBtn, disabled && styles.primaryBtnDisabled]}
          onPress={onSubmit}
          disabled={disabled}
        >
          {busy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.primaryBtnText}>{isSignIn ? "Увійти" : "Зареєструватись"}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>або</Text>
          <View style={styles.dividerLine} />
        </View>

        <TouchableOpacity style={styles.oauthBtn} onPress={onGoogle} disabled={busy}>
          <Ionicons name="logo-google" size={18} color={COLORS.text} />
          <Text style={styles.oauthText}>Continue with Google</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.oauthBtn} onPress={onApple} disabled={busy}>
          <Ionicons name="logo-apple" size={18} color={COLORS.text} />
          <Text style={styles.oauthText}>Continue with Apple</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Google/Apple: треба увімкнути провайдери в Supabase + налаштувати redirect scheme в app.json.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginBottom: 14,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: COLORS.background,
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  segmentBtnActive: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textMuted,
  },
  segmentTextActive: {
    color: COLORS.text,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: COLORS.text,
    backgroundColor: COLORS.surface,
    marginBottom: 10,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 14,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  dividerText: {
    marginHorizontal: 10,
    color: COLORS.textMuted,
    fontSize: 12,
  },
  oauthBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 10,
  },
  oauthText: {
    color: COLORS.text,
    fontWeight: "600",
  },
  hint: {
    marginTop: 8,
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 15,
  },
});
