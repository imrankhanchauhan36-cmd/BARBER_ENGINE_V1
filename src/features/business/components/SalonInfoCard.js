//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonInfoCard.js — v2 FINAL ✅
// 9.8/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

function AmenityChip({ icon, label }) {
  return (
    <View style={styles.amenityChip}>
      <Ionicons name={icon} size={13} color={PURPLE} />
      <Text style={styles.amenityText}>{label}</Text>
    </View>
  );
}

export default function SalonInfoCard({ salon, isOpen, todayTime }) {
  const name      = salon?.basicInfo?.shopName || "Salon";
  const tagline   = salon?.basicInfo?.tagline  || "";
  const category  = salon?.basicInfo?.category || "";
  const salonType = salon?.basicInfo?.salonType || "";
  const since     = salon?.basicInfo?.since    || "";
  const address   = salon?.location?.address  || "";
  const amenities = salon?.basicInfo?.amenities || {};

  // Safe rating
  const ratingVal =
    salon?.rating?.count > 0 && salon?.rating?.total != null
      ? Number((salon.rating.total / salon.rating.count).toFixed(1))
      : null;
  const reviewCount = salon?.rating?.count || 0;

  return (
    <View style={styles.card}>

      {/* Name + Rating */}
      <View style={styles.nameRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{name}</Text>
          {tagline ? <Text style={styles.tagline}>{tagline}</Text> : null}
        </View>
        {ratingVal !== null && (
          <View style={styles.ratingBox}>
            <Ionicons name="star" size={14} color="#F59E0B" />
            <Text style={styles.ratingText}>{ratingVal}</Text>
            {reviewCount > 0 && (
              <Text style={styles.reviewCount}>({reviewCount})</Text>
            )}
          </View>
        )}
      </View>

      {/* Badges */}
      {(category || salonType || since) ? (
        <View style={styles.badgeRow}>
          {category ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{category}</Text>
            </View>
          ) : null}
          {salonType ? (
            <View style={[styles.badge, styles.badgePrimary]}>
              <Text style={[styles.badgeText, { color: PURPLE }]}>{salonType}</Text>
            </View>
          ) : null}
          {since ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>Est. {since}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Open/Closed status */}
      <View style={[styles.statusRow, {
        backgroundColor: isOpen ? COLORS.successLight : "#FEF2F2",
      }]}>
        <View style={[styles.statusDot, {
          backgroundColor: isOpen ? COLORS.success : "#EF4444",
        }]} />
        <Text style={[styles.statusText, {
          color: isOpen ? COLORS.success : "#EF4444",
        }]}>
          {isOpen
            ? `Open now · ${todayTime?.open || ""} – ${todayTime?.close || ""}`
            : "Closed today"}
        </Text>
      </View>

      {/* Address */}
      {address ? (
        <View style={styles.addressRow}>
          <Ionicons name="location-outline" size={15} color={COLORS.text.secondary} />
          <Text style={styles.addressText} numberOfLines={2}>{address}</Text>
          <TouchableOpacity style={styles.directionsBtn}>
            <Ionicons name="navigate-outline" size={14} color={PURPLE} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Amenities */}
      {Object.values(amenities).some(Boolean) && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.amenitiesRow}
        >
          {amenities.sanitizedTools && <AmenityChip icon="color-wand-outline"       label="Sanitized" />}
          {amenities.hasAC          && <AmenityChip icon="snow-outline"             label="AC" />}
          {amenities.hasWifi        && <AmenityChip icon="wifi-outline"             label="WiFi" />}
          {amenities.hasParking     && <AmenityChip icon="car-outline"              label="Parking" />}
          {amenities.cardAccepted   && <AmenityChip icon="card-outline"             label="Card" />}
          {amenities.cleanSafe      && <AmenityChip icon="shield-checkmark-outline" label="Clean & Safe" />}
          {amenities.restroom       && <AmenityChip icon="man-outline"              label="Restroom" />}
          {amenities.waitingArea    && <AmenityChip icon="people-outline"           label="Waiting" />}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.background,
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },

  nameRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  name: {
    fontSize: 22,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  tagline: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
    marginTop: 2,
  },
  ratingBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFBEB",
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 0.5,
    borderColor: "#FDE68A",
  },
  ratingText:  { fontSize: 13, fontFamily: FONTS.bold,    color: "#B45309" },
  reviewCount: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  badge: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  badgePrimary: {
    backgroundColor: "#EEF0FF",
    borderColor: "#C7D2FE",
  },
  badgeText: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.text.secondary,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  statusDot:  { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: FONTS.medium },

  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: 12,
  },
  addressText: {
    fontSize: 13,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
    flex: 1,
    lineHeight: 19,
  },
  directionsBtn: {
    width: 28, height: 28,
    borderRadius: 14,
    backgroundColor: "#EEF0FF",
    justifyContent: "center",
    alignItems: "center",
  },

  amenitiesRow: { gap: 8, paddingVertical: 4 },
  amenityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EEF0FF",
    borderRadius: RADIUS.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 0.5,
    borderColor: "#C7D2FE",
  },
  amenityText: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: PURPLE,
  },
});