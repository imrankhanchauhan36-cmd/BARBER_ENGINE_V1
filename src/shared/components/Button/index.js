import React from "react";

import {
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from "react-native";

import styles from "./styles";

import { COLORS } from "../../../constants/colors";

const Button = ({
  title,
  onPress,

  loading = false,
  disabled = false,

  style = {},
  textStyle = {},
}) => {

  const isDisabled =
    disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,

        isDisabled &&
          styles.disabledButton,

        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={COLORS.white}
        />
      ) : (
        <Text
          style={[
            styles.text,
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

export default Button;