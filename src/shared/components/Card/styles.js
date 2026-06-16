import { StyleSheet } from "react-native";

import { COLORS } from "../../../constants/colors";

const styles = StyleSheet.create({
  card: {
    backgroundColor:
      COLORS.white,

    borderRadius: 18,

    padding: 16,

    marginBottom: 16,

    shadowColor: "#000",

    shadowOffset: {
      width: 0,
      height: 2,
    },

    shadowOpacity: 0.08,

    shadowRadius: 8,

    elevation: 3,
  },
});

export default styles;