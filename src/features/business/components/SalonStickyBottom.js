//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonStickyBottom.js — LOCKED ✅
// Exact screenshot — Starting From + Book Appointment
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

export default function SalonStickyBottom({ minPrice, onBookAppointment }) {
  return (
    <View style={styles.wrapper}>
      {/* Left — Starting From + price */}
      <View style={styles.priceBox}>
        <Text style={styles.priceLabel}>Starting From</Text>
        <View style={styles.priceRow}>
          <Text style={styles.priceVal}>
            {minPrice ? `₹${minPrice}` : "₹₹"}
          </Text>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.text.light} />
        </View>
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Right — Book Appointment */}
      <TouchableOpacity
        style={styles.bookBtn}
        onPress={onBookAppointment}
        activeOpacity={0.88}
      >
        <Ionicons name="calendar-outline" size={18} color="#fff" />
        <Text style={styles.bookBtnText}>Book Appointment</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === "ios" ? 28 : 14,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    gap: 14,
  },

  // Price
  priceBox: { gap: 2 },
  priceLabel: {
    fontSize: 10,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  priceVal: {
    fontSize: 22,
    fontFamily: FONTS.bold,
    color: "#5C35E8",
  },

  // Divider
  divider: {
    width: 1,
    height: 36,
    backgroundColor: COLORS.border,
  },

  // Book button
  bookBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#5C35E8",
    borderRadius: RADIUS.lg,
    paddingVertical: 14,
  },
  bookBtnText: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: "#fff",
  },
});