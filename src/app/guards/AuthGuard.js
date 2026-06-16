import React from "react";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../../features/auth/store/AuthContext";

const AuthGuard = ({ children }) => {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return children;
};

export default AuthGuard;