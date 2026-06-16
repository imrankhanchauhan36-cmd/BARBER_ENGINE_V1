import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  container: {
    flex: 1,

    justifyContent: "center",

    alignItems: "center",

    padding: 24,
  },

  title: {
    fontSize: 20,

    fontWeight: "700",

    color: COLORS.error,
  },

  subtitle: {
    marginTop: 10,

    fontSize: 14,

    textAlign: "center",

    color: COLORS.textLight,
  },

  button: {
    marginTop: 20,

    width: 160,
  },
});

export default styles;