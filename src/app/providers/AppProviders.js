import React from "react";

import { AppStoreProvider } from "../store/appStore";

import {
  BookingProvider,
} from "../../features/booking/store/BookingContext";

import { AuthProvider } from "../../features/auth/store/AuthContext";

console.log("AppStoreProvider =", AppStoreProvider);
console.log("AuthProvider =", AuthProvider);
console.log("BookingProvider =", BookingProvider);

const AppProviders = ({ children }) => {
  return (
    <AppStoreProvider>
      <AuthProvider>
        <BookingProvider>
          {children}
        </BookingProvider>
      </AuthProvider>
    </AppStoreProvider>
  );
};

export default AppProviders;