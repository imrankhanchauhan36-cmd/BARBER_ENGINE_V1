//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonOfferBanner.js — LOCKED ✅
// Exact screenshot — light purple bg, % badge, View Offer
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

export default function SalonOfferBanner({ offer, onViewOffer }) {
  // Use offer from backend or fallback
  const title    = offer?.title    || "Get 20% OFF";
  const subtitle = offer?.subtitle || "On all Hair Services";
  const validTill= offer?.validTill|| "Valid till 31 May 2024";

  return (
    <View style={styles.wrapper}>
      {/* % badge icon */}
      <View style={styles.iconBadge}>
        <Text style={styles.iconText}>%</Text>
      </View>

      {/* Text */}
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.valid}>{validTill}</Text>
      </View>

      {/* CTA */}
      <TouchableOpacity style={styles.viewBtn} onPress={onViewOffer} activeOpacity={0.8}>
        <Text style={styles.viewBtnText}>View Offer</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 12,
    padding: 14,
    backgroundColor: "#F5F3FF",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: "#EDE9FE",
    gap: 12,
  },
  iconBadge: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: "#5C35E8",
    justifyContent: "center",
    alignItems: "center",
  },
  iconText: {
    fontSize: 18,
    fontFamily: FONTS.black,
    color: "#fff",
  },
  content: { flex: 1, gap: 2 },
  title: {
    fontSize: 13,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
  },
  valid: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    color: COLORS.text.light,
  },
  viewBtn: {
    borderWidth: 1.5,
    borderColor: "#5C35E8",
    borderRadius: RADIUS.md,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  viewBtnText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: "#5C35E8",
  },
});