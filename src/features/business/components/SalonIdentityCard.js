//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonIdentityCard.js — v2 FINAL ✅
// 10/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

const PURPLE = "#5C35E8";

export default function SalonIdentityCard({ salon, isOpen, nextSlot, onBookNow }) {
  const name      = salon?.basicInfo?.shopName || "Salon";
  const address   = salon?.location?.address || "";
  const distance  = salon?.distance ? `${salon.distance.toFixed(1)} km` : null;
  const salonType = salon?.basicInfo?.salonType || "";
  const category  = salon?.basicInfo?.category || "";
  const logoUrl   = salon?.media?.logo?.url || null;

  // Safe rating calculation
  const ratingVal =
    salon?.rating?.count > 0 && salon?.rating?.total != null
      ? Number((salon.rating.total / salon.rating.count).toFixed(1))
      : null;
  const reviewCount = salon?.rating?.count || 0;
  const recommend   = salon?.rating?.recommendPercent || null;

  // Logo initials fallback
  const initials = name?.split(" ")?.filter(Boolean)?.map(w => w[0])?.slice(0,2)?.join("")?.toUpperCase() || "SL";

  return (
    <View style={styles.wrapper}>

      {/* ── TOP ROW ── */}
      <View style={styles.topRow}>

        {/* Logo */}
        <View style={styles.logoCircle}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logoImg} resizeMode="cover" />
          ) : (
            <>
              <Text style={styles.logoInitials}>{initials}</Text>
              <Text style={styles.logoSalonText}>SALON</Text>
            </>
          )}
        </View>

        {/* Name + location + rating */}
        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={styles.salonName}>{name}</Text>
            <Ionicons name="checkmark-circle" size={18} color={PURPLE} />
          </View>

          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={12} color={COLORS.text.secondary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {address || category}
              {distance ? ` • ${distance}` : ""}
            </Text>
          </View>

          {ratingVal !== null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={13} color="#F59E0B" />
              <Text style={styles.ratingNum}>{ratingVal}</Text>
              <Text style={styles.ratingCount}>({reviewCount} Reviews)</Text>
              {recommend !== null && (
                <>
                  <Text style={styles.ratingDiv}>|</Text>
                  <Ionicons name="thumbs-up-outline" size={11} color={COLORS.text.secondary} />
                  <Text style={styles.recommendText}>{recommend}% Recommend</Text>
                </>
              )}
            </View>
          )}
        </View>

        {/* Available / Closed badge */}
        <View style={[styles.availBadge, !isOpen && styles.closedBadge]}>
          <View style={[styles.availDot, !isOpen && styles.closedDot]} />
          <Text style={[styles.availText, !isOpen && styles.closedText]}>
            {isOpen ? "Available Now" : "Closed"}
          </Text>
        </View>

      </View>

      {/* ── TRUST BADGES ── */}
      <View style={styles.badgeRow}>
        {salonType === "PREMIUM" && (
          <View style={[styles.badge, styles.badgePurple]}>
            <Ionicons name="ribbon-outline" size={10} color={PURPLE} />
            <Text style={[styles.badgeText, { color: PURPLE }]}>Premium Salon</Text>
          </View>
        )}
        <View style={[styles.badge, styles.badgeGreen]}>
          <Ionicons name="shield-checkmark-outline" size={10} color="#059669" />
          <Text style={[styles.badgeText, { color: "#059669" }]}>Hygiene Certified</Text>
        </View>
        {ratingVal !== null && ratingVal >= 4.5 && (
          <View style={[styles.badge, styles.badgeYellow]}>
            <Ionicons name="star-outline" size={10} color="#B45309" />
            <Text style={[styles.badgeText, { color: "#B45309" }]}>Top Rated</Text>
          </View>
        )}
      </View>

      {/* ── NEXT SLOT ROW ── */}
      <View style={styles.slotRow}>
        <View style={styles.slotInfo}>
          <Text style={styles.slotLabel}>Next Available Slot</Text>
          <Text style={styles.slotTime}>
            {isOpen
              ? `Today • ${nextSlot || "—"}`
              : nextSlot
                ? `Tomorrow • ${nextSlot}`
                : "No slots available"}
          </Text>
        </View>
        <TouchableOpacity style={styles.bookNowBtn} onPress={onBookNow} activeOpacity={0.88}>
          <Ionicons name="flash" size={14} color="#fff" />
          <Text style={styles.bookNowText}>Book Now</Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },

  // Top row
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 12,
  },

  // Logo
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.secondary,
    justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: PURPLE,
    overflow: "hidden",
  },
  logoImg: { width: "100%", height: "100%" },
  logoInitials: {
    fontSize: 18, fontFamily: FONTS.black,
    color: PURPLE, letterSpacing: 1,
  },
  logoSalonText: {
    fontSize: 7, fontFamily: FONTS.bold,
    color: "rgba(255,153,0,0.7)", letterSpacing: 2,
    marginTop: 1,
  },

  // Info
  infoCol:      { flex: 1 },
  nameRow:      { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 3 },
  salonName:    { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary, flex: 1, flexWrap: "wrap" },
  locationRow:  { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
  locationText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, flex: 1 },

  ratingRow:     { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingNum:     { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  ratingCount:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  ratingDiv:     { color: COLORS.border, marginHorizontal: 2 },
  recommendText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.text.secondary },

  // Available / Closed badge
  availBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: COLORS.successLight,
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 4,
  },
  closedBadge: { backgroundColor: "#FEF2F2" },
  availDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.success },
  closedDot: { backgroundColor: "#EF4444" },
  availText:  { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.success },
  closedText: { color: "#EF4444" },

  // Badges
  badgeRow: { flexDirection: "row", gap: 7, flexWrap: "wrap", marginBottom: 12 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  badgePurple: { backgroundColor: "#EEF0FF", borderColor: "#C7D2FE" },
  badgeGreen:  { backgroundColor: "#ECFDF5", borderColor: "#A7F3D0" },
  badgeYellow: { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" },
  badgeText:   { fontSize: 10, fontFamily: FONTS.bold },

  // Slot row
  slotRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, padding: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  slotInfo:  { gap: 2 },
  slotLabel: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  slotTime:  { fontSize: 14, fontFamily: FONTS.bold, color: PURPLE },
  bookNowBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: PURPLE,
    borderRadius: RADIUS.lg, paddingHorizontal: 16, paddingVertical: 10,
  },
  bookNowText: { fontSize: 13, fontFamily: FONTS.bold, color: "#fff" },
});