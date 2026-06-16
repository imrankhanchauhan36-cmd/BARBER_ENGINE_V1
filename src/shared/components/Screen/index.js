import React from "react";

import {
  SafeAreaView,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

import styles from "./styles";

const Screen = ({
  children,

  scroll = true,

  style = {},
}) => {

  const Content =
    scroll
      ? ScrollView
      : React.Fragment;

  const contentProps =
    scroll
      ? {
          showsVerticalScrollIndicator: false,
          contentContainerStyle: {
            flexGrow: 1,
          },
        }
      : {};

  return (
    <SafeAreaView
      style={[
        styles.container,
        style,
      ]}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }
      >
        <Content {...contentProps}>
          {children}
        </Content>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default Screen;