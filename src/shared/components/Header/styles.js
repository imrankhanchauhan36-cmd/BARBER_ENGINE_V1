import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  container: {
    height: 60,

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "space-between",

    paddingHorizontal: 16,

    backgroundColor:
      COLORS.white,
  },

  left: {
    width: 40,
  },

  right: {
    width: 40,

    alignItems: "flex-end",
  },

  title: {
    flex: 1,

    textAlign: "center",

    fontSize: 18,

    fontWeight: "700",

    color: COLORS.text,
  },
});

export default styles;