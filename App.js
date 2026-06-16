import React from "react";
import { StatusBar, View, ActivityIndicator } from "react-native";
import AppToast from "./src/shared/ui/AppToast";
import AppProviders from "./src/app/providers/AppProviders";
import AppNavigator from "./src/app/navigation/AppNavigator";
import { COLORS } from "./constants/colors";

import { useFonts } from "expo-font";
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_800ExtraBold,
} from "@expo-google-fonts/poppins";

export default function App() {
  const [fontsLoaded] = useFonts({
    "Poppins-Regular":    Poppins_400Regular,
    "Poppins-Medium":     Poppins_500Medium,
    "Poppins-SemiBold":   Poppins_600SemiBold,
    "Poppins-Bold":       Poppins_700Bold,
    "Poppins-ExtraBold":  Poppins_800ExtraBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <AppProviders>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={COLORS.background}
      />
      <AppNavigator />
      <AppToast />
    </AppProviders>
  );
}