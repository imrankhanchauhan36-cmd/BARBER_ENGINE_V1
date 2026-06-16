import React from "react";

import {
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";

import { COLORS } from "../../../constants/colors";

const AppLoader = ({
  visible = true,
  size = "large",
  overlay = true,
}) => {

  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="auto"
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[
        styles.container,

        overlay &&
          styles.overlay,
      ]}
    >
      <ActivityIndicator
        size={size}
        color={COLORS.primary}
      />
    </View>
  );
};

export default AppLoader;

const styles = StyleSheet.create({
  container: {
    justifyContent: "center",

    alignItems: "center",
  },

  overlay: {
    position: "absolute",

    top: 0,
    left: 0,
    right: 0,
    bottom: 0,

    zIndex: 999,

    backgroundColor:
      "rgba(0,0,0,0.2)",
  },
});