import React from "react";

import {
  View,
  Text,
} from "react-native";

import styles from "./styles";

const EmptyState = ({
  title = "No Data Found",

  subtitle = "",
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
    </View>
  );
};

export default EmptyState;