//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceBrandsInfo.js — v2 FINAL ✅
// 9.8/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

const PURPLE = "#5C35E8";

export default function ServiceBrandsInfo({ benefits = [], brandsUsed = [], suitableFor = [] }) {
  if (!benefits.length && !brandsUsed.length && !suitableFor.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Service Information</Text>

      <View style={styles.card}>
        <View style={styles.threeColRow}>

          {/* Benefits */}
          {benefits.length > 0 && (
            <View style={styles.col}>
              <Text style={styles.colTitle}>Benefits</Text>
              {benefits.slice(0, 5).map((b, i) => (
                <View key={`benefit-${b}-${i}`} style={styles.checkRow} accessible accessibilityLabel={b}>
                  <Ionicons name="checkmark-circle" size={13} color={PURPLE} />
                  <Text style={styles.checkText} numberOfLines={2}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {benefits.length > 0 && brandsUsed.length > 0 && (
            <View style={styles.colDivider} />
          )}

          {/* Brands Used */}
          {brandsUsed.length > 0 && (
            <View style={styles.col}>
              <Text style={styles.colTitle}>Brands Used</Text>
              {brandsUsed.slice(0, 5).map((b, i) => (
                <View key={`brand-${b}-${i}`} style={styles.brandChip} accessible accessibilityLabel={b}>
                  <Text style={styles.brandText} numberOfLines={2}>{b}</Text>
                </View>
              ))}
            </View>
          )}

          {brandsUsed.length > 0 && suitableFor.length > 0 && (
            <View style={styles.colDivider} />
          )}

          {/* Best For */}
          {suitableFor.length > 0 && (
            <View style={styles.col}>
              <Text style={styles.colTitle}>Best For</Text>
              {suitableFor.slice(0, 5).map((s, i) => (
                <View key={`suitable-${s}-${i}`} style={styles.checkRow} accessible accessibilityLabel={s}>
                  <Ionicons name="person-outline" size={13} color={PURPLE} />
                  <Text style={styles.checkText} numberOfLines={2}>{s}</Text>
                </View>
              ))}
            </View>
          )}

        </View>
      </View>
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

  card: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    padding: 14,
    ...SHADOWS.card,
  },

  threeColRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },

  col: { flex: 1, gap: 6, minWidth: 80 },

  colDivider: {
    width: 0.5,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },

  colTitle: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
    marginBottom: 4,
  },

  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  checkText: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
    flex: 1,
  },

  brandChip: {
    backgroundColor: "#F5F3FF",
    borderRadius: RADIUS.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: "#DDD6FE",
    alignSelf: "flex-start",
  },
  brandText: {
    fontSize: 10,
    fontFamily: FONTS.bold,
    color: PURPLE,
  },
});