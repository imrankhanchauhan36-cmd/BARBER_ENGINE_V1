import React from "react";

import {
  View,
  Text,
} from "react-native";

import styles from "./styles";

const OfflineBanner = () => {

  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        No Internet Connection
      </Text>
    </View>
  );
};

export default OfflineBanner;