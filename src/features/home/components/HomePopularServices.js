//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomePopularServices.js — v3 FINAL ✅
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import ServiceCard from "../../../shared/components/ServiceCard";

const MAX_POPULAR = 10;

const MOCK_POPULAR = [
  { id: "1", name: "Hair Spa",   price: 999,  duration: 60, emoji: "💆", category: "SPA",    isPopular: true },
  { id: "2", name: "Makeup",     price: 2499, duration: 90, emoji: "💄", category: "MAKEUP" },
  { id: "3", name: "Facial",     price: 1299, duration: 60, emoji: "✨", category: "FACIAL", isRecommended: true },
  { id: "4", name: "Gel Nails",  price: 1199, duration: 45, emoji: "💅", category: "NAILS" },
  { id: "5", name: "Beard Trim", price: 299,  duration: 30, emoji: "🧔", category: "BEARD" },
];

export default function HomePopularServices({
  services, onServicePress, onWishlist, onViewAll,
}) {
  // Fix 1: ?? instead of ternary + Fix 2: slice
  const data = (services ?? MOCK_POPULAR).slice(0, MAX_POPULAR);

  // Fix 3: empty state
  if (!data.length) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>Popular Services</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="sparkles-outline" size={28} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No services available</Text>
          <Text style={styles.emptySubtitle}>Check back later</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Popular Services</Text>
        <TouchableOpacity onPress={() => onViewAll?.()} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {data.map((service) => (
          <ServiceCard
            key={service.id || service._id}
            service={service}
            variant="card"
            onPress={() => onServicePress?.(service)}
            onWishlist={() => onWishlist?.(service)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper:  { marginBottom: 24 },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, marginBottom: 12,
  },
  title:   { fontSize: 16, fontFamily: FONTS.bold,   color: COLORS.text.primary },
  viewAll: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.primary },
  list:    { paddingHorizontal: 16, gap: 12 },
  emptyState: {
    alignItems: "center", paddingVertical: 20, gap: 5,
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: COLORS.border,
  },
  emptyTitle:    { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.secondary },
  emptySubtitle: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.light },
});