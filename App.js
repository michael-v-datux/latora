/**
 * App.js — Entry point for LexiLevel
 *
 * Guard:
 * - If user is NOT logged in → show AuthScreen
 * - If user IS logged in → show TabNavigator
 *
 * Auth is powered by Supabase Auth (email+password + OAuth providers).
 */

import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, ActivityIndicator } from "react-native";

import TabNavigator from "./src/navigation/TabNavigator";
import AuthScreen from "./src/screens/AuthScreen";
import { AuthProvider, useAuth } from "./src/hooks/useAuth";
import { COLORS } from "./src/utils/constants";

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  return user ? <TabNavigator /> : <AuthScreen />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <Root />
        </NavigationContainer>
        <StatusBar style="dark" />
      </AuthProvider>
    </SafeAreaProvider>
  );
}