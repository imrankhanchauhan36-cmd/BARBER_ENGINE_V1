//////////////////////////////////////////////////////
// hooks/useStoredUserName.js — v3 FINAL ✅
//////////////////////////////////////////////////////

import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const useStoredUserName = (fallbackUser) => {
  const [storedName, setStoredName] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const n = await AsyncStorage.getItem("USER_NAME");
        if (mounted && n && n !== "Customer") setStoredName(n);
      } catch (err) {
        console.warn("AsyncStorage read failed:", err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const rawName     = storedName || fallbackUser?.name || "";
  // Fix 1: empty string fallback instead of "There"
  const displayName = rawName && rawName !== "Customer"
    ? rawName.split(" ")[0]
    : "";

  return displayName;
};