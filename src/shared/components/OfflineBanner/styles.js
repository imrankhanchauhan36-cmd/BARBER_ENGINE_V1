import { StyleSheet } from "react-native";

import { COLORS } from "../../../../constants/colors";

const styles = StyleSheet.create({
  container: {
    padding: 10,

    backgroundColor:
      COLORS.error,

    alignItems: "center",
  },

  text: {
    color: COLORS.white,

    fontWeight: "600",
  },
});

export default styles;