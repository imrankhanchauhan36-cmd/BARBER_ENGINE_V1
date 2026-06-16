import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user,       setUser]       = useState(null);
  const [isLoading,  setIsLoading]  = useState(true);

  useEffect(() => { restoreSession(); }, []);

  const restoreSession = async () => {
    try {
      const token  = await AsyncStorage.getItem("AUTH_TOKEN");
      const userId = await AsyncStorage.getItem("USER_ID");
      const name   = await AsyncStorage.getItem("USER_NAME");
      const phone  = await AsyncStorage.getItem("USER_PHONE");

      if (token && userId) {
        setUser({ userId, name, phone });
        setIsLoggedIn(true);
      }
    } catch (err) {
      console.warn("SESSION_RESTORE:", err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (data) => {
    try {
      await AsyncStorage.setItem("AUTH_TOKEN",    data.accessToken  || "");
      await AsyncStorage.setItem("REFRESH_TOKEN", data.refreshToken || "");
      await AsyncStorage.setItem("USER_ID",       data.userId       || "");
      await AsyncStorage.setItem("USER_PHONE",    data.phone        || "");
      await AsyncStorage.setItem("USER_NAME",     data.name         || "Customer");

      setUser({
        userId: data.userId,
        name:   data.name  || "Customer",
        phone:  data.phone || "",
      });
      setIsLoggedIn(true);
    } catch (err) {
      console.warn("LOGIN_STORE:", err.message);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem("AUTH_TOKEN");
      await AsyncStorage.removeItem("REFRESH_TOKEN");
      await AsyncStorage.removeItem("USER_ID");
      await AsyncStorage.removeItem("USER_PHONE");
      await AsyncStorage.removeItem("USER_NAME");
      await AsyncStorage.removeItem("USER_AVATAR");
    } catch (err) {
      console.warn("LOGOUT_CLEAR:", err.message);
    } finally {
      setUser(null);
      setIsLoggedIn(false);
    }
  };

  return (
    <AuthContext.Provider value={{
      isLoggedIn,
      user,
      isLoading,
      login,
      logout,
      setUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

export { AuthContext };
export default AuthProvider;