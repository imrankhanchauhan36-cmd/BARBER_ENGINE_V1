//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeNearbySalons.js — v4 FINAL ✅
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import SalonCard from "../../../shared/components/SalonCard";

// Improvement 2: named constant
const MAX_NEARBY = 5;

export default function HomeNearbySalons({
  salons = [], onSalonPress, onWishlist, onViewAll,
}) {
  // Improvement 1 + 5: safe array + ?? instead of ||
  const sortedSalons = [...(salons || [])]
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .slice(0, MAX_NEARBY);

  if (!sortedSalons.length) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>Nearby Salons</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="location-outline" size={32} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No salons nearby</Text>
          <Text style={styles.emptySubtitle}>Try expanding your search radius</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Nearby Salons</Text>
        {/* Improvement 4: safe onViewAll call */}
        <TouchableOpacity onPress={() => onViewAll?.()} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      {sortedSalons.map((salon) => (
        <SalonCard
          key={salon._id}
          salon={salon}
          variant="horizontal"
          onPress={() => onSalonPress?.(salon)}
          onWishlist={() => onWishlist?.(salon)}
          isFavorite={salon.isFavorite || false}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 16, marginBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title:   { fontSize: 16, fontFamily: FONTS.bold,   color: COLORS.text.primary },
  viewAll: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.primary },
  emptyState: {
    alignItems: "center", paddingVertical: 24, gap: 6,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  emptyTitle:    { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.secondary },
  emptySubtitle: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.light },
});