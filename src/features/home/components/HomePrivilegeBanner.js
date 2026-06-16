//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomePrivilegeBanner.js — FINAL ✅
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

export default function HomePrivilegeBanner({ savedAmount, onJoin, isMember = false }) {
  const saved = savedAmount || 0;

  return (
    <TouchableOpacity style={styles.wrapper} onPress={onJoin} activeOpacity={0.92}>
      <View style={styles.circle1} />
      <View style={styles.circle2} />

      <View style={styles.iconBox}>
        <Ionicons name="diamond" size={28} color={COLORS.primary} />
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>IC Privilege</Text>
        {isMember && saved > 0 ? (
          <Text style={styles.subtitle}>
            You saved ₹{saved.toLocaleString("en-IN")} this month
          </Text>
        ) : (
          <Text style={styles.subtitle}>
            Join now & get exclusive offers{"\n"}and salon benefits.
          </Text>
        )}
      </View>

      <View style={styles.joinBtn}>
        <Text style={styles.joinText}>{isMember ? "View" : "Join Now"}</Text>
        <Ionicons name="arrow-forward" size={12} color={COLORS.secondary} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 32,
    backgroundColor: COLORS.secondary,
    borderRadius: RADIUS.xl,
    padding: 16,
    gap: 12,
    overflow: "hidden",
    position: "relative",
    ...SHADOWS.card,
  },
  circle1: {
    position: "absolute",
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: "rgba(255,153,0,0.08)",
    top: -40, right: 80,
  },
  circle2: {
    position: "absolute",
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(255,153,0,0.06)",
    bottom: -20, right: 20,
  },
  iconBox: {
    width: 52, height: 52,
    borderRadius: RADIUS.md,
    backgroundColor: "rgba(255,153,0,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: { flex: 1, gap: 3 },
  title: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.primary,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    color: "rgba(255,255,255,0.75)",
    lineHeight: 16,
  },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  joinText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
    color: COLORS.secondary,
  },
});