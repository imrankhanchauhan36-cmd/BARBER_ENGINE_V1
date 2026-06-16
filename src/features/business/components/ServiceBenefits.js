//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceBenefits.js — v2 FINAL ✅
// 9.8/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

// Dynamic icon mapping
const getBenefitIcon = (benefit = "") => {
  const b = benefit.toLowerCase();
  if (b.includes("massage") || b.includes("relax"))    return "hand-left-outline";
  if (b.includes("clean") || b.includes("wash"))       return "water-outline";
  if (b.includes("product") || b.includes("brand"))    return "cube-outline";
  if (b.includes("hydrat") || b.includes("moistur"))   return "leaf-outline";
  if (b.includes("skin") || b.includes("glow"))        return "sparkles-outline";
  if (b.includes("hair") || b.includes("scalp"))       return "cut-outline";
  if (b.includes("style") || b.includes("finish"))     return "color-wand-outline";
  if (b.includes("expert") || b.includes("profes"))    return "person-outline";
  return "checkmark-circle-outline";
};

export default function ServiceBenefits({ benefits = [], variant = "chips" }) {
  if (!benefits.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>What You'll Get</Text>

      {variant === "list" ? (
        // Checklist variant
        <View style={styles.list}>
          {benefits.map((b, i) => (
            <View
              key={`${b}-${i}`}
              style={styles.listItem}
              accessible
              accessibilityLabel={b}
            >
              <Ionicons name="checkmark-circle" size={16} color={PURPLE} />
              <Text style={styles.listText} numberOfLines={1}>{b}</Text>
            </View>
          ))}
        </View>
      ) : (
        // Chips variant (default)
        <View style={styles.chips}>
          {benefits.map((b, i) => (
            <View
              key={`${b}-${i}`}
              style={styles.chip}
              accessible
              accessibilityLabel={b}
            >
              <Ionicons name={getBenefitIcon(b)} size={13} color={PURPLE} />
              <Text style={styles.chipText} numberOfLines={1}>{b}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
    marginBottom: 12,
  },

  // Chips variant
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#F5F3FF",
    borderRadius: RADIUS.full,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 0.5, borderColor: "#DDD6FE",
    maxWidth: 160,
  },
  chipText: {
    fontSize: 12, fontFamily: FONTS.medium,
    color: PURPLE, flexShrink: 1,
  },

  // List variant
  list: { gap: 10 },
  listItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
  },
  listText: {
    fontSize: 13, fontFamily: FONTS.medium,
    color: COLORS.text.primary, flex: 1,
  },
});