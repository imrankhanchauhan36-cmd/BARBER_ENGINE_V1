import axios from "axios";
import { API_URL, REQUEST_TIMEOUT } from "../../config/env";

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.request.use(
  async (config) => {
    console.log(`🚀 API Request: ${config.method?.toUpperCase()} ${config.url}`);
    try {
      const AsyncStorage = require("@react-native-async-storage/async-storage").default;
      const token = await AsyncStorage.getItem("AUTH_TOKEN");
      if (token) config.headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    return config;
  },
  (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
  (response) => {
    console.log(`✅ API Response: ${response.config.url}`);
    return response;
  },
  async (error) => {
  
    console.log(
      "❌ API Error:",
      error?.response?.data ||
      error.message
    );
  
    //////////////////////////////////////////////////////
    // AUTO LOGOUT ON 401
    //////////////////////////////////////////////////////
    
    if (
      error?.response?.status === 401
    ) {
  
      try {

  
        const AsyncStorage =
          require(
            "@react-native-async-storage/async-storage"
          ).default;
  
        await AsyncStorage.multiRemove([
          "AUTH_TOKEN",
          "REFRESH_TOKEN",
          "USER_ID",
          "USER_PHONE",
          "USER_NAME",
        ]);
  
        console.log(
          "🔒 Session Expired"
        );

      } catch (e) {
        console.log(e);
      }
    }
  
  
  return Promise.reject(error);
}

);

export default apiClient;
