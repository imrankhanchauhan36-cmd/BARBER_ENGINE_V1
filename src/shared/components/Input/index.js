import React from "react";

import {
  View,
  TextInput,
  Text,
} from "react-native";

import styles from "./styles";

const Input = ({
  label,
  value,
  onChangeText,

  placeholder = "",

  secureTextEntry = false,

  keyboardType = "default",

  error = "",

  style = {},

  inputStyle = {},
}) => {

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={styles.label}>
          {label}
        </Text>
      ) : null}

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#999"

        secureTextEntry={
          secureTextEntry
        }

        keyboardType={keyboardType}

        style={[
          styles.input,
          inputStyle,
        ]}
      />

      {error ? (
        <Text style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};

export default Input;