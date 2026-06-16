//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeCategories.js — v3 FINAL ✅
// Reference: IC Salons exact layout
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const CATEGORIES = [
  { key: "HAIR",    label: "Hair",    icon: "cut-outline",          color: "#7C3AED", bg: "#F5F3FF" },
  { key: "BEARD",   label: "Beard",   icon: "man-outline",          color: "#15803D", bg: "#F0FDF4" },
  { key: "FACIAL",  label: "Facial",  icon: "sparkles-outline",     color: "#0891B2", bg: "#ECFEFF" },
  { key: "SPA",     label: "Spa",     icon: "leaf-outline",         color: "#059669", bg: "#ECFDF5" },
  { key: "COLOR",   label: "Color",   icon: "color-palette-outline", color: "#DB2777", bg: "#FDF2F8" },
  { key: "WAXING",  label: "Waxing",  icon: "flame-outline",        color: "#EA580C", bg: "#FFF7ED" },
  { key: "MASSAGE", label: "Massage", icon: "body-outline",         color: "#7C3AED", bg: "#F5F3FF" },
  { key: "MORE",    label: "More",    icon: "grid-outline",         color: "#6B7280", bg: "#F3F4F6" },
];

export default function HomeCategories({ onSelect, activeCategory }) {
  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={styles.item}
              onPress={() => onSelect?.(cat.key)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={cat.label}
              accessibilityState={{ selected: isActive }}
            >
              <View style={[
                styles.iconBox,
                {
                  backgroundColor: isActive ? cat.color : cat.bg,
                  borderWidth: isActive ? 0 : 1,
                  borderColor: isActive ? "transparent" : cat.color + "25",
                }
              ]}>
                <Ionicons
                  name={cat.icon}
                  size={17}
                  color={isActive ? "#fff" : cat.color}
                />
              </View>
              <Text style={[
                styles.label,
                {
                  color: isActive ? cat.color : COLORS.text.secondary,
                  fontFamily: isActive ? FONTS.bold : FONTS.regular,
                }
              ]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 8,
  },
  row: {
    paddingHorizontal: 16,
    gap: 14,
    paddingVertical: 4,
  },
  item: {
    alignItems: "center",
    gap: 5,
    minWidth: 48,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    fontSize: 10,
    textAlign: "center",
  },
});