import Constants from "expo-constants";

//////////////////////////////////////////////////////
// AUTO IP DETECTION — No manual change needed!
//////////////////////////////////////////////////////

const getLocalURL = () => {
  try {
    const debuggerHost =
      Constants.expoConfig?.hostUri ||
      Constants.manifest?.debuggerHost ||
      Constants.manifest2?.extra?.expoGo?.debuggerHost;

    if (debuggerHost) {
      const ip = debuggerHost.split(":")[0];
      return `http://${ip}:6060`;
    }
  } catch {}

  // Fallback
  return "http://192.168.31.108:6060";
};

const CONFIG = {
  LOCAL:      getLocalURL(),
  PRODUCTION: "https://barber-engine-v1.onrender.com",
};

export const BASE_URL        = __DEV__ ? CONFIG.LOCAL : CONFIG.PRODUCTION;
export const API_URL         = BASE_URL;
export const REQUEST_TIMEOUT = 15000;

console.log("🌍 API BASE URL:", BASE_URL);