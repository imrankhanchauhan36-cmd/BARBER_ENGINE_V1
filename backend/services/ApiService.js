import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, REQUEST_TIMEOUT } from "../src/config/env";

export const ApiService = {

  request: async (endpoint, method = "GET", body = null, requiresAuth = false) => {
    try {
      const headers = { "Content-Type": "application/json" };

      if (requiresAuth) {
        const token = await AsyncStorage.getItem("AUTH_TOKEN");
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }

      const config = { method, headers };
      if (body) config.body = JSON.stringify(body);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const url = `${API_URL}${endpoint}`;
      console.log(`🚀 ${method} ${url}`);

      const response = await fetch(url, { ...config, signal: controller.signal });
      clearTimeout(timeout);

      const data = await response.json();
      console.log(`✅ ${method} ${endpoint} →`, response.status);

      // Token refresh logic
      if (response.status === 401) {
        const refreshed = await ApiService.refreshToken();
        if (refreshed) {
          return ApiService.request(endpoint, method, body, requiresAuth);
        }
      }

      return data;

    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("Request timeout. Check your connection.");
      }
      console.error(`❌ ${method} ${endpoint}:`, error.message);
      throw error;
    }
  },

  refreshToken: async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("REFRESH_TOKEN");
      if (!refreshToken) return false;

      const response = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-refresh-token": refreshToken,
        },
      });

      const data = await response.json();

      if (data?.accessToken) {
        await AsyncStorage.setItem("AUTH_TOKEN", data.accessToken);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  },
};
