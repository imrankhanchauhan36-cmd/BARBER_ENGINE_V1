import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  button: {
    height: 52,

    borderRadius: 14,

    justifyContent: "center",
    alignItems: "center",

    backgroundColor:
      COLORS.primary,
  },

  disabledButton: {
    opacity: 0.6,
  },

  text: {
    fontSize: 16,

    fontWeight: "600",

    color: COLORS.white,
  },
});

export default styles;