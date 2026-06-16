import React from "react";

import {
  View,
  Text,
} from "react-native";

import Button from "../Button";

import styles from "./styles";

const ErrorState = ({
  title = "Something went wrong",

  subtitle = "",

  onRetry,
}) => {

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {title}
      </Text>

      {subtitle ? (
        <Text style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}

      {onRetry ? (
        <Button
          title="Retry"
          onPress={onRetry}
          style={styles.button}
        />
      ) : null}
    </View>
  );
};

export default ErrorState;