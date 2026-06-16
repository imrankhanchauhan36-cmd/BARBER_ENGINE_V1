//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeAvailableNow.js — v6 FINAL ✅
// Width 210, height 135, green next slot
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

const PURPLE = "#5C35E8";
const GREEN  = "#16A34A";
const MAX_AVAILABLE = 6;

function AvailableNowCard({ salon, onPress, onBookNow, onWishlist }) {
  const name     = salon.basicInfo?.shopName || "Salon";
  const coverUrl = salon.media?.coverImage?.url || salon.coverUrl || null;
  const distance = salon.distance != null
    ? salon.distance < 1
      ? `${Math.round(salon.distance * 1000)} m`
      : `${salon.distance.toFixed(1)} km`
    : null;

  const ratingVal = salon.rating?.averageRating
    ?? (salon.rating?.count > 0 ? (salon.rating.total / salon.rating.count) : null);
  const rating  = ratingVal ? ratingVal.toFixed(1) : "New";
  const reviews = salon.rating?.reviewCount ?? salon.rating?.count ?? 0;
  const nextSlot = salon.nextSlot || null;
  const isFav    = salon.isFavorite || false;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>

      {/* IMAGE */}
      <View style={styles.imageBox}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="storefront-outline" size={34} color={COLORS.border} />
          </View>
        )}
        <View style={styles.availableBadge}>
          <View style={styles.availableDot} />
          <Text style={styles.availableText}>Available Now</Text>
        </View>
        <TouchableOpacity
          style={styles.wishlistBtn}
          onPress={() => onWishlist?.(salon)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isFav ? "heart" : "heart-outline"}
            size={14}
            color={isFav ? "#EF4444" : "#fff"}
          />
        </TouchableOpacity>
      </View>

      {/* INFO */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>

        <View style={styles.metaRow}>
          <Ionicons name="star" size={11} color="#F59E0B" />
          <Text style={styles.rating}>{rating}</Text>
          {reviews > 0 && <Text style={styles.reviews}>({reviews})</Text>}
          {distance && (
            <>
              <View style={styles.dot} />
              <Text style={styles.distance}>{distance}</Text>
            </>
          )}
        </View>

        {/* Fix: green next slot */}
        {nextSlot && (
          <View style={styles.slotRow}>
            <Ionicons name="time-outline" size={11} color={GREEN} />
            <Text style={styles.slotText}>Next Slot: {nextSlot}</Text>
          </View>
        )}
      </View>

      {/* BOOK NOW */}
      <TouchableOpacity style={styles.bookBtn} onPress={onBookNow} activeOpacity={0.85}>
        <Text style={styles.bookBtnText}>Book Now</Text>
      </TouchableOpacity>

    </TouchableOpacity>
  );
}

export default function HomeAvailableNow({
  salons = [], onSalonPress, onBookNow, onWishlist, onViewAll,
}) {
  const availableSalons = [...(salons || [])]
    .filter(s => s.availableNow === true || (s.business?.isShopOpen && !s.business?.isForceClosed))
    .slice(0, MAX_AVAILABLE);

  if (!availableSalons.length) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.header}>
          <Text style={styles.title}>Available Now</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="storefront-outline" size={32} color={COLORS.border} />
          <Text style={styles.emptyTitle}>No salons available right now</Text>
          <Text style={styles.emptySubtitle}>Try nearby salons below</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Text style={styles.title}>Available Now</Text>
        <TouchableOpacity onPress={() => onViewAll?.()} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {availableSalons.map((salon) => (
          <AvailableNowCard
            key={salon._id}
            salon={salon}
            onPress={() => onSalonPress?.(salon)}
            onBookNow={() => onBookNow?.(salon)}
            onWishlist={onWishlist}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 24 },
  header: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, marginBottom: 12,
  },
  title:   { fontSize: 16, fontFamily: FONTS.bold,   color: COLORS.text.primary },
  viewAll: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.primary },
  list:    { paddingHorizontal: 16, gap: 12 },

  // Fix 1: width 210
  card: {
    width: 145,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  // Fix 2: height 135
  imageBox: { height: 80, backgroundColor: COLORS.surfaceAlt, position: "relative" },
  image:    { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  imagePlaceholder: { flex: 1, justifyContent: "center", alignItems: "center" },

  availableBadge: {
    position: "absolute", top: 8, left: 8,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(22,163,74,0.9)",
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3,
  },
  availableDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#86EFAC" },
  availableText: { fontSize: 9, fontFamily: FONTS.bold, color: "#fff" },

  wishlistBtn: {
    position: "absolute", top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.3)",
    justifyContent: "center", alignItems: "center",
  },

  info:     { padding: 10, gap: 4 },
  name:     { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  metaRow:  { flexDirection: "row", alignItems: "center", gap: 3 },
  rating:   { fontSize: 11, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  reviews:  { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  dot:      { width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.text.light },
  distance: { fontSize: 11, fontFamily: FONTS.medium,  color: COLORS.text.secondary },

  slotRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  // Fix 3: green color
  slotText: { fontSize: 10, fontFamily: FONTS.medium, color: GREEN },

  bookBtn: {
    backgroundColor: PURPLE,
    marginHorizontal: 10, marginBottom: 10,
    paddingVertical: 9, borderRadius: RADIUS.md,
    alignItems: "center",
  },
  bookBtnText: { fontSize: 12, fontFamily: FONTS.bold, color: "#fff" },

  emptyState: {
    alignItems: "center", paddingVertical: 24, gap: 6,
    marginHorizontal: 16, backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg, borderWidth: 0.5, borderColor: COLORS.border,
  },
  emptyTitle:    { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.secondary },
  emptySubtitle: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.light },
});