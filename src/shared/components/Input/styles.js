import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },

  label: {
    marginBottom: 8,

    fontSize: 14,

    fontWeight: "600",

    color: COLORS.text,
  },

  input: {
    height: 52,

    borderWidth: 1,

    borderColor: COLORS.border,

    borderRadius: 14,

    paddingHorizontal: 16,

    fontSize: 15,

    color: COLORS.text,

    backgroundColor:
      COLORS.white,
  },

  error: {
    marginTop: 6,

    fontSize: 12,

    color: COLORS.error,
  },
});

export default styles;