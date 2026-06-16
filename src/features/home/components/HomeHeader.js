//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeHeader.js — v8 FINAL ✅
// Men / Women / Unisex tabs
//////////////////////////////////////////////////////

import React, { useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";
import { useStoredUserName } from "../hooks/useStoredUserName";
import { cleanLocation } from "../../../utils/location.utils";

const PURPLE = "#5C35E8";
const PINK   = "#EC4899";
const GREEN  = "#059669";

const CATEGORY_TABS = [
  {
    key:          "male",
    label:        "Men",
    emoji:        "👨",
    activeBg:     PURPLE,
    activeBorder: PURPLE,
    activeText:   "#fff",
    activeSub:    "rgba(255,255,255,0.75)",
    subLabel:     "Men's Salon",
    tabBg:        "#F8F8FF",
    tabBorder:    "#E8E4FF",
  },
  {
    key:          "female",
    label:        "Women",
    emoji:        "👩",
    activeBg:     "#FFF0F6",
    activeBorder: PINK,
    activeText:   PINK,
    activeSub:    "#BE185D",
    subLabel:     "Women's Salon",
    tabBg:        "#FFF0F6",
    tabBorder:    "#FBCFE8",
  },
  {
    key:          "unisex",
    label:        "Unisex",
    emoji:        "✂️",
    activeBg:     "#ECFDF5",
    activeBorder: GREEN,
    activeText:   GREEN,
    activeSub:    "#047857",
    subLabel:     "Unisex Salon",
    tabBg:        "#F0FDF4",
    tabBorder:    "#BBF7D0",
  },
];

const getGreeting = () => {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return "Good Morning";
  if (h >= 12 && h < 17) return "Good Afternoon";
  return "Good Evening";
};

export default function HomeHeader({
  navigation, user, locationName,
  gender = "male", onGenderChange,
  unreadCount = 0,
}) {
  const displayName = useStoredUserName(user);
  const badgeCount  = unreadCount > 99 ? "99+" : unreadCount;
  const greeting    = getGreeting();
  const location    = useMemo(() => cleanLocation(locationName), [locationName]);
  const isDetecting = !locationName || locationName === "Detecting...";

  return (
    <View style={styles.wrapper}>

      {/* ── Row 1: Location + Bell ── */}
      <View style={styles.row1}>
        <TouchableOpacity
          style={styles.locationRow}
          onPress={() => navigation.navigate(ROUTES.LOCATION_PICKER)}
          accessibilityRole="button"
          accessibilityLabel="Change location"
        >
          <Ionicons name="location" size={14} color={PURPLE} />
          {isDetecting ? (
            <View style={styles.detectingRow}>
              <ActivityIndicator size={10} color={PURPLE} />
              <Text style={styles.detectingText}>Detecting...</Text>
            </View>
          ) : (
            <Text style={styles.locationText} numberOfLines={1}>{location}</Text>
          )}
          <Ionicons name="chevron-down" size={12} color={COLORS.text.secondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.bellBtn}
          onPress={() => navigation.navigate(ROUTES.NOTIFICATIONS)}
          accessibilityRole="button"
          accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${badgeCount} unread` : ""}`}
        >
          <Ionicons name="notifications-outline" size={22} color={COLORS.text.primary} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Row 2: Greeting ── */}
      <View style={styles.row2}>
        <Text style={styles.greeting}>
          {displayName ? `${greeting}, ${displayName} 👋` : `${greeting} 👋`}
        </Text>
        <Text style={styles.tagline}>Find your perfect salon</Text>
      </View>

      {/* ── Row 3: Search Full Width ── */}
      <TouchableOpacity
        style={styles.searchBox}
        onPress={() => navigation.navigate(ROUTES.SEARCH)}
        accessibilityRole="search"
        accessibilityLabel="Search haircut, beard, facial or salons"
      >
        <Ionicons name="search-outline" size={15} color={COLORS.text.light} />
        <Text style={styles.searchText}>Search haircut, beard, facial...</Text>
        <View style={styles.filterChip}>
          <Ionicons name="options-outline" size={13} color={PURPLE} />
          <Text style={styles.filterText}>Filter</Text>
        </View>
      </TouchableOpacity>

      {/* ── Row 4: Category Tabs — Men / Women / Unisex ── */}
      <View style={styles.tabRow}>
        {CATEGORY_TABS.map((tab) => {
          const isActive = gender === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                { backgroundColor: tab.tabBg, borderColor: tab.tabBorder },
                isActive && { backgroundColor: tab.activeBg, borderColor: tab.activeBorder },
              ]}
              onPress={() => onGenderChange?.(tab.key)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`${tab.label} salon`}
              accessibilityState={{ selected: isActive }}
            >
              <Text style={styles.tabEmoji}>{tab.emoji}</Text>
              <View>
                <Text style={[styles.tabLabel, isActive && { color: tab.activeText }]}>
                  {tab.label}
                </Text>
                <Text style={[styles.tabSub, isActive && { color: tab.activeSub }]}>
                  {tab.subLabel}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
    gap: 10,
  },
  row1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4, flex: 1, marginRight: 8 },
  locationText: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary, flexShrink: 1 },
  detectingRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  detectingText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  bellBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 0.5, borderColor: COLORS.border,
    justifyContent: "center", alignItems: "center",
  },
  badge: {
    position: "absolute", top: 3, right: 3,
    minWidth: 14, height: 14, borderRadius: 7,
    backgroundColor: "#EF4444",
    justifyContent: "center", alignItems: "center",
    paddingHorizontal: 2,
  },
  badgeText: { fontSize: 8, fontFamily: FONTS.bold, color: "#fff" },
  row2: { gap: 2 },
  greeting: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary },
  tagline:  { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  searchText: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.light },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: PURPLE + "12",
    borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  filterText: { fontSize: 11, fontFamily: FONTS.bold, color: PURPLE },
  tabRow: { flexDirection: "row", gap: 8 },
  tab: {
    flex: 1,
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
  },
  tabEmoji: { fontSize: 16 },
  tabLabel: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.text.primary },
  tabSub:   { fontSize: 9, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 1 },
});