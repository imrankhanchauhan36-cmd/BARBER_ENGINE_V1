import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  overlay: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",

    backgroundColor:
      "rgba(0,0,0,0.4)",
  },

  container: {
    width: "85%",

    backgroundColor:
      COLORS.white,

    borderRadius: 20,

    padding: 20,
  },

  title: {
    fontSize: 20,

    fontWeight: "700",

    color: COLORS.text,
  },

  message: {
    marginTop: 12,

    fontSize: 15,

    lineHeight: 22,

    color: COLORS.textLight,
  },

  actions: {
    flexDirection: "row",

    justifyContent: "space-between",

    marginTop: 24,
  },

  cancelButton: {
    flex: 1,

    marginRight: 8,

    backgroundColor:
      COLORS.border,
  },

  confirmButton: {
    flex: 1,

    marginLeft: 8,
  },
});

export default styles;