//////////////////////////////////////////////////////
// user-app/src/shared/api/client.js
//
// ✅ Auto refresh token on 401
// ✅ Queue requests while refreshing
// ✅ Logout on refresh fail
//////////////////////////////////////////////////////

import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL, REQUEST_TIMEOUT } from "../../config/env";

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT,
  headers: { "Content-Type": "application/json" },
});

// ── Refresh control ────────────────────────────────
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (token) => {
  refreshSubscribers.forEach(cb => cb(token));
  refreshSubscribers = [];
};

// ── Logout helper ──────────────────────────────────
const clearSession = async () => {
  await AsyncStorage.multiRemove([
    "AUTH_TOKEN", "REFRESH_TOKEN",
    "USER_ID", "USER_PHONE", "USER_NAME", "USER_AVATAR",
  ]);
};

// ── Request interceptor ────────────────────────────
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const token = await AsyncStorage.getItem("AUTH_TOKEN");
      if (token) config.headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor ───────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // ✅ 401 — try refresh
    if (error?.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Queue if already refreshing
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((newToken) => {
            originalRequest.headers["Authorization"] = `Bearer ${newToken}`;
            resolve(apiClient(originalRequest));
          });
        });
      }

      isRefreshing = true;

      try {
        const refreshToken = await AsyncStorage.getItem("REFRESH_TOKEN");

        if (!refreshToken) throw new Error("No refresh token");

        // ✅ Call refresh API
        const res = await axios.post(
          `${API_URL}/api/auth/refresh`,
          {},
          { headers: { "x-refresh-token": refreshToken } }
        );

        const newAccessToken = res?.data?.accessToken;
        if (!newAccessToken) throw new Error("No access token");

        // Save new tokens
        await AsyncStorage.setItem("AUTH_TOKEN", newAccessToken);
        if (res?.data?.refreshToken) {
          await AsyncStorage.setItem("REFRESH_TOKEN", res.data.refreshToken);
        }

        onRefreshed(newAccessToken);
        originalRequest.headers["Authorization"] = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);

      } catch (refreshError) {
        // Refresh failed — logout
        await clearSession();
        console.log("🔒 Session expired — logged out");
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;