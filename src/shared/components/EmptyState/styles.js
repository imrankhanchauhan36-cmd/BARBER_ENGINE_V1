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

    color: COLORS.text,
  },

  subtitle: {
    marginTop: 10,

    fontSize: 14,

    textAlign: "center",

    color: COLORS.textLight,
  },
});

export default styles;