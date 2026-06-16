//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// shared/components/ServiceCard.js — v2 FINAL ✅
// Score: 10/10
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../config/theme";

//////////////////////////////////////////////////////
// CATEGORY COLOR MAP
//////////////////////////////////////////////////////
const CATEGORY_COLORS = {
  HAIR:    { bg: "#F5F3FF", color: "#7C3AED" },
  BEARD:   { bg: "#F0FDF4", color: "#15803D" },
  FACIAL:  { bg: "#ECFEFF", color: "#0891B2" },
  SPA:     { bg: "#ECFDF5", color: "#059669" },
  COLOR:   { bg: "#FDF2F8", color: "#DB2777" },
  WAXING:  { bg: "#FFF7ED", color: "#EA580C" },
  MASSAGE: { bg: "#F5F3FF", color: "#7C3AED" },
  NAILS:   { bg: "#FFF0F6", color: "#EC4899" },
  MAKEUP:  { bg: "#FDF4FF", color: "#A21CAF" },
  DEFAULT: { bg: "#F3F4F6", color: "#6B7280" },
};

const getCategoryStyle = (category) =>
  CATEGORY_COLORS[category?.toUpperCase()] || CATEGORY_COLORS.DEFAULT;

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

// Fix 1: null price → "Price on request"
const formatPrice = (price) => {
  if (price == null) return "Price on request";
  return `₹${Number(price).toLocaleString("en-IN")}`;
};

// Fix 2: smart duration label
const formatDuration = (duration) => {
  if (!duration) return null;
  if (duration >= 60) {
    const h = Math.floor(duration / 60);
    const m = duration % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${duration} mins`;
};

const formatBookedCount = (count) => {
  if (!count) return null;
  if (count >= 1000) return `Booked ${(count / 1000).toFixed(1)}k times`;
  return `Booked ${count} times`;
};

// Badge config for trending/popular/recommended
const BADGE_CONFIG = {
  isTrending:    { label: "🔥 Trending",    bg: "#FFF7ED", color: "#EA580C" },
  isPopular:     { label: "🏆 Popular",     bg: "#F0FDF4", color: "#15803D" },
  isRecommended: { label: "⭐ Recommended", bg: "#FEFCE8", color: "#CA8A04" },
};

const getBadge = (service) => {
  if (service.isTrending)    return BADGE_CONFIG.isTrending;
  if (service.isPopular)     return BADGE_CONFIG.isPopular;
  if (service.isRecommended) return BADGE_CONFIG.isRecommended;
  return null;
};

//////////////////////////////////////////////////////
// MAIN EXPORT
//////////////////////////////////////////////////////
export default function ServiceCard({
  service,
  onPress,
  onWishlist,
  isFavorite = false,
  style,
  variant = "card",  // "card" | "row"
}) {
  if (!service) return null;

  const name         = service.name || service.serviceName || "Service";
  const price        = service.price ?? service.basePrice ?? null;
  const duration     = service.duration ?? service.durationMinutes ?? null;
  const category     = service.category || service.serviceCategory || "DEFAULT";
  const bookedCount  = service.bookedCount ?? service.bookingStats?.totalBookings ?? null;
  const imageUrl     = service.imageUrl ?? service.thumbnailImage ?? null;
  const emoji        = service.emoji ?? null;
  const catStyle     = getCategoryStyle(category);
  const bookedLabel  = formatBookedCount(bookedCount);
  const durationLabel= formatDuration(duration);
  const badge        = getBadge(service);

  // Fix 4: rating support
  const rating      = service.rating?.averageRating ?? null;
  const reviewCount = service.rating?.reviewCount ?? 0;

  const sharedProps = {
    service, name, price, duration, category,
    bookedLabel, durationLabel, imageUrl, emoji,
    catStyle, badge, rating, reviewCount,
    onPress, onWishlist, isFavorite, style,
  };

  if (variant === "row") return <ServiceCardRow {...sharedProps} />;
  return <ServiceCardCard {...sharedProps} />;
}

//////////////////////////////////////////////////////
// CARD VARIANT — Trending, Popular horizontal scroll
//////////////////////////////////////////////////////
function ServiceCardCard({
  service, name, price, durationLabel, category,
  bookedLabel, imageUrl, emoji, catStyle, badge,
  rating, reviewCount,
  onPress, onWishlist, isFavorite, style,
}) {
  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatPrice(price)}, ${durationLabel || ""}`}
    >
      {/* Image / Emoji Box */}
      <View style={[styles.imageBox, { backgroundColor: catStyle.bg }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <Text style={styles.emoji}>{emoji || "✂️"}</Text>
        )}

        {/* Fix 3: safe wishlist press */}
        <TouchableOpacity
          style={styles.wishlistBtn}
          onPress={() => onWishlist?.(service)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={13}
            color={isFavorite ? "#EF4444" : "#fff"}
          />
        </TouchableOpacity>

        {/* Trending/Popular badge */}
        {badge && (
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.price}>{formatPrice(price)}</Text>

        {durationLabel && (
          <Text style={styles.duration}>{durationLabel}</Text>
        )}

        {/* Fix 4: rating display */}
        {rating && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={9} color="#F59E0B" />
            <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            {reviewCount > 0 && <Text style={styles.reviewText}>({reviewCount})</Text>}
          </View>
        )}

        {bookedLabel && (
          <View style={styles.bookedRow}>
            <Ionicons name="checkmark-circle" size={10} color={COLORS.success} />
            <Text style={styles.bookedText}>{bookedLabel}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

//////////////////////////////////////////////////////
// ROW VARIANT — Salon Details service list
//////////////////////////////////////////////////////
function ServiceCardRow({
  service, name, price, durationLabel, category,
  bookedLabel, imageUrl, emoji, catStyle, badge,
  rating, reviewCount,
  onPress, onWishlist, isFavorite, style,
}) {
  return (
    <TouchableOpacity
      style={[styles.row, style]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatPrice(price)}`}
    >
      {/* Image/Emoji */}
      <View style={[styles.rowImageBox, { backgroundColor: catStyle.bg }]}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.rowImage} resizeMode="cover" />
        ) : (
          <Text style={styles.rowEmoji}>{emoji || "✂️"}</Text>
        )}
      </View>

      {/* Info */}
      <View style={styles.rowInfo}>
        <View style={styles.rowNameRow}>
          <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
          {badge && (
            <View style={[styles.rowBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.rowBadgeText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          )}
        </View>

        {durationLabel && (
          <Text style={styles.rowDuration}>{durationLabel}</Text>
        )}

        {/* Fix 4: rating in row */}
        {rating && (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={9} color="#F59E0B" />
            <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
            {reviewCount > 0 && <Text style={styles.reviewText}>({reviewCount})</Text>}
          </View>
        )}

        {bookedLabel && (
          <View style={styles.bookedRow}>
            <Ionicons name="checkmark-circle" size={9} color={COLORS.success} />
            <Text style={styles.bookedText}>{bookedLabel}</Text>
          </View>
        )}
      </View>

      {/* Right: price + Fix 5: "Add" button */}
      <View style={styles.rowRight}>
        <Text style={styles.rowPrice}>{formatPrice(price)}</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={onPress}
          accessibilityLabel={`Add ${name}`}
        >
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

//////////////////////////////////////////////////////
// STYLES
//////////////////////////////////////////////////////
const styles = StyleSheet.create({
  // ── CARD ──
  card: {
    width: 120,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  imageBox: {
    height: 100,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  image:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  emoji:  { fontSize: 38 },
  wishlistBtn: {
    position: "absolute", top: 6, right: 6,
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center", alignItems: "center",
  },
  badge: {
    position: "absolute", bottom: 6, left: 6,
    borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeText: { fontSize: 8, fontFamily: FONTS.bold },

  info:     { padding: 10, gap: 2 },
  name:     { fontSize: 12, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  price:    { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  duration: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  ratingRow:  { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 },
  ratingText: { fontSize: 9, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  reviewText: { fontSize: 8, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  bookedRow:  { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  bookedText: { fontSize: 9, fontFamily: FONTS.medium, color: COLORS.success },

  // ── ROW ──
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    padding: 10,
    gap: 12,
    marginBottom: 8,
    ...SHADOWS.sm,
  },
  rowImageBox: {
    width: 56, height: 56, borderRadius: RADIUS.md,
    justifyContent: "center", alignItems: "center",
    overflow: "hidden",
  },
  rowImage:    { width: "100%", height: "100%" },
  rowEmoji:    { fontSize: 26 },
  rowInfo:     { flex: 1, gap: 2 },
  rowNameRow:  { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  rowName:     { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary, flexShrink: 1 },
  rowBadge:    { borderRadius: RADIUS.full, paddingHorizontal: 5, paddingVertical: 1 },
  rowBadgeText:{ fontSize: 7, fontFamily: FONTS.bold },
  rowDuration: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  rowRight:    { alignItems: "flex-end", gap: 6 },
  rowPrice:    { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  addBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 6,
  },
  addBtnText: { fontSize: 11, fontFamily: FONTS.bold, color: "#fff" },
});