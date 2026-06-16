import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { View, ActivityIndicator } from "react-native";

import { useAuth } from "../../features/auth/store/AuthContext";
import { COLORS } from "../../../constants/colors";
import { ROUTES } from "../routes/routeNames";

import MainTabs               from "./MainTabs";
import LoginScreen            from "../../features/auth/screens/LoginScreen";
import SalonDetailScreen      from "../../features/business/screens/SalonDetailScreen";
import ServiceDetailScreen    from "../../features/business/screens/ServiceDetailScreen";   // ✅ fixed
import ServiceSelectionScreen from "../../features/business/screens/ServiceSelectionScreen";
import BarberSelectionScreen  from "../../features/business/screens/BarberSelectionScreen";
import SavedSalonsScreen      from "../../features/business/screens/SavedSalonsScreen";
import SlotSelectionScreen    from "../../features/booking/screens/SlotSelectionScreen";
import BookingSuccessScreen   from "../../features/booking/screens/BookingSuccessScreen";
import BookingDetailScreen    from "../../features/booking/screens/BookingDetailScreen";
import BookingHoldScreen      from "../../features/booking/screens/BookingHoldScreen";
import ReviewScreen           from "../../features/reviews/screens/ReviewScreen";
import PaymentScreen          from "../../features/payments/screens/PaymentScreen";
import EditProfileScreen      from "../../features/settings/screens/EditProfileScreen";
import NotificationsScreen    from "../../features/notifications/screens/NotificationsScreen";
//import SearchScreen           from "../../features/search/screens/SearchScreen";           // ✅ new

const Stack = createNativeStackNavigator();

const AppNavigator = () => {
  const { isLoggedIn, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.background }}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isLoggedIn ? (
          <Stack.Screen name={ROUTES.LOGIN} component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name={ROUTES.MAIN_TABS}        component={MainTabs} />
            <Stack.Screen name={ROUTES.SALON_DETAIL}     component={SalonDetailScreen} />
            <Stack.Screen name={ROUTES.SERVICE_DETAIL}   component={ServiceDetailScreen} />
            <Stack.Screen name={ROUTES.SERVICE_SELECTION}component={ServiceSelectionScreen} />
            <Stack.Screen name={ROUTES.BARBER_SELECTION} component={BarberSelectionScreen} />
            <Stack.Screen name={ROUTES.SLOT_SELECTION}   component={SlotSelectionScreen} />
            <Stack.Screen name={ROUTES.REVIEW}           component={ReviewScreen} />
            <Stack.Screen name={ROUTES.PAYMENT}          component={PaymentScreen} />
            <Stack.Screen name={ROUTES.BOOKING_SUCCESS}  component={BookingSuccessScreen} />
            <Stack.Screen name={ROUTES.BOOKING_DETAIL}   component={BookingDetailScreen} />
            <Stack.Screen name={ROUTES.BOOKING_HOLD}     component={BookingHoldScreen} />
            <Stack.Screen name={ROUTES.EDIT_PROFILE}     component={EditProfileScreen} />
            <Stack.Screen name={ROUTES.SAVED_SALONS}     component={SavedSalonsScreen} />
            <Stack.Screen name={ROUTES.NOTIFICATIONS}    component={NotificationsScreen} />
            {/* <Stack.Screen name={ROUTES.SEARCH}          component={SearchScreen} /> */}
            {/* <Stack.Screen name={ROUTES.LOCATION_PICKER} component={SearchScreen} /> */}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator;