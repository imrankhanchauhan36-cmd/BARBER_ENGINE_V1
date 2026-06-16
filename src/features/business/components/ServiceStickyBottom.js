//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceStickyBottom.js — v2 FINAL ✅
// 10/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

export default function ServiceStickyBottom({
  price,
  duration,
  isInCart = false,
  isBookingLoading = false,
  onCartAction,
  onBookSlot,
}) {
  const formattedPrice = price == null
    ? "₹--"
    : price === 0
      ? "Free"
      : `₹${Number(price).toLocaleString("en-IN")}`;

  return (
    <View style={styles.bottomBar}>
      {/* Price */}
      <View style={styles.priceCol}>
        <Text style={styles.priceLabel}>Starting From</Text>
        <Text style={styles.priceVal}>{formattedPrice}</Text>
        {duration > 0 && (
          <Text style={styles.durationText}>⏱ {duration} mins</Text>
        )}
      <Text style={styles.priceTax}>Incl. all taxes</Text>
      </View>

      {/* Buttons */}
      <View style={styles.buttonsRow}>

        {/* Add to Cart */}
        <TouchableOpacity
          style={[styles.cartBtn, isInCart && styles.cartBtnActive]}
          onPress={onCartAction}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={isInCart ? "Remove from cart" : "Add to cart"}
        >
          <Ionicons
            name={isInCart ? "checkmark-circle" : "bag-add-outline"}
            size={18}
            color={isInCart ? "#fff" : PURPLE}
          />
          <Text style={[styles.cartBtnText, isInCart && styles.cartBtnTextActive]}>
            {isInCart ? "Added" : "Add to Cart"}
          </Text>
        </TouchableOpacity>

        {/* Book Slot */}
        <TouchableOpacity
          style={[styles.bookBtn, isBookingLoading && styles.bookBtnLoading]}
          onPress={isBookingLoading ? null : onBookSlot}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel="Book a slot"
        >
          {isBookingLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="calendar-outline" size={18} color="#fff" />
          )}
          <View>
            <Text style={styles.bookBtnText}>
              {isBookingLoading ? "Booking..." : "Book Slot"}
            </Text>
            {!isBookingLoading && (
              <Text style={styles.bookBtnSub}>Choose Date & Time</Text>
            )}
          </View>
        </TouchableOpacity>

      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomBar: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === "ios" ? 28 : 12,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.border,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },

  priceCol:   { gap: 1 },
  priceLabel: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  priceVal:   { fontSize: 22, fontFamily: FONTS.bold,    color: PURPLE },
  priceTax:   { fontSize: 9,  fontFamily: FONTS.regular, color: COLORS.text.light },
  durationText: { fontSize: 10, fontFamily: FONTS.medium, color: PURPLE },

  buttonsRow: { flex: 1, flexDirection: "row", gap: 8 },

  cartBtn: {
    flex: 0.9,
    flexDirection: "row",
    alignItems: "center", justifyContent: "center",
    gap: 6,
    borderWidth: 1.5, borderColor: PURPLE,
    borderRadius: RADIUS.lg,
    paddingVertical: 12,
    backgroundColor: "#fff",
  },
  cartBtnActive:     { backgroundColor: PURPLE, borderColor: PURPLE },
  cartBtnText:       { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },
  cartBtnTextActive: { color: "#fff" },

  bookBtn: {
    flex: 1.3,
    flexDirection: "row",
    alignItems: "center", justifyContent: "center",
    gap: 10,
    backgroundColor: PURPLE,
    borderRadius: RADIUS.lg,
    paddingVertical: 12,
  },
  bookBtnLoading: { opacity: 0.75 },
  bookBtnText:    { fontSize: 15, fontFamily: FONTS.bold,    color: "#fff" },
  bookBtnSub:     { fontSize: 10, fontFamily: FONTS.regular, color: "rgba(255,255,255,0.8)" },
});