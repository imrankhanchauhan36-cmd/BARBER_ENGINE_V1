import { ROUTES } from "../routes/routeNames";
import React from "react";
import { Platform, View, Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../config/theme";
import HomeScreen           from "../../features/home/screens/HomeScreen";
import BookingHistoryScreen from "../../features/booking/screens/BookingHistoryScreen";
import ProfileScreen        from "../../features/profile/screens/ProfileScreen";
import SearchScreen         from "../../features/search/screens/SearchScreen";
import CartScreen from "../../features/booking/screens/CartScreen";
import useServiceSelection  from "../../features/booking/hooks/useServiceSelection";

const Tab = createBottomTabNavigator();

function CartTabIcon({ focused, color }) {
  const { selectedServices } = useServiceSelection();
  const count = selectedServices?.length || 0;
  return (
    <View style={{ position: "relative" }}>
      <Ionicons name={focused ? "cart" : "cart-outline"} size={22} color={color} />
      {count > 0 && (
        <View style={{
          position: "absolute", top: -4, right: -6,
          width: 16, height: 16, borderRadius: 8,
          backgroundColor: "#5C35E8",
          justifyContent: "center", alignItems: "center",
        }}>
          <Text style={{ fontSize: 9, color: "#fff", fontWeight: "bold" }}>{count}</Text>
        </View>
      )}
    </View>
  );
}

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:   "#5C35E8",
        tabBarInactiveTintColor: "#9CA3AF",
        tabBarStyle: {
          height:          Platform.OS === "ios" ? 80 : 62,
          paddingBottom:   Platform.OS === "ios" ? 22 : 8,
          paddingTop:      8,
          backgroundColor: "#FFFFFF",
          borderTopWidth:  0.5,
          borderTopColor:  "#F0F0F0",
          elevation:       10,
        },
        tabBarLabelStyle: { fontSize: 10, marginTop: 2 },
      })}
    >
      <Tab.Screen
        name={ROUTES.HOME}
        component={HomeScreen}
        options={{
          title: "Home",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.SEARCH}
        component={SearchScreen}
        options={{
          title: "Search",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "search" : "search-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name={ROUTES.BOOKINGS}
        component={BookingHistoryScreen}
        options={{
          title: "Bookings",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="CartTab"
        component={CartScreen}
        options={{
          title: "Cart",
          tabBarIcon: ({ focused, color }) => (
            <CartTabIcon focused={focused} color={color} />
          ),
        }}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.navigate(ROUTES.CART, { salonId: null, salon: null });
          },
        })}
      />
      <Tab.Screen
        name={ROUTES.PROFILE}
        component={ProfileScreen}
        options={{
          title: "Profile",
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? "person" : "person-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
