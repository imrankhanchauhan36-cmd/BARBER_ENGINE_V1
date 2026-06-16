import React from "react";

import {
  View,
  ActivityIndicator,
} from "react-native";

import styles from "./styles";

import { COLORS } from "../../../constants/colors";

const Loader = ({
  fullscreen = false,
}) => {

  return (
    <View
      style={[
        styles.container,

        fullscreen &&
          styles.fullscreen,
      ]}
    >
      <ActivityIndicator
        size="large"
        color={COLORS.primary}
      />
    </View>
  );
};

export default Loader;