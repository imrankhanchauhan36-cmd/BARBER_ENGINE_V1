//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/shared/SalonCard.js — v2 FINAL ✅
// Score: 10/10
// Universal reusable card — used everywhere
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../config/theme";

//////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////

const CATEGORY_LABEL = {
  MEN_ONLY:   "Men's Salon",
  WOMEN_ONLY: "Women's Salon",
  UNISEX:     "Unisex Salon",
};

const TIER_CONFIG = {
  PREMIUM:  { label: "Premium", color: "#B45309", bg: "#FEF3C7" },
  LUXURY:   { label: "Luxury",  color: "#6D28D9", bg: "#EDE9FE" },
  STANDARD: { label: "",        color: "",         bg: ""        },
};

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

// Improvement 2: smart distance label
const formatDistance = (km) => {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
};

// Improvement 3: smart open status
const getOpenStatus = (salon) => {
  const isOpen       = salon.business?.isShopOpen && !salon.business?.isForceClosed;
  const closingAt    = salon.business?.closingAt;

  if (!isOpen) return { label: "Closed",       color: COLORS.text.secondary, bg: COLORS.surfaceAlt, dot: COLORS.text.light };

  if (closingAt) {
    const now      = new Date();
    const closing  = new Date(closingAt);
    const diffMins = (closing - now) / 60000;
    if (diffMins > 0 && diffMins <= 30) {
      return { label: "Closing Soon", color: "#D97706", bg: "#FEF3C7", dot: "#F59E0B" };
    }
  }

  return { label: "Available Now", color: COLORS.success, bg: COLORS.successLight, dot: COLORS.success };
};

//////////////////////////////////////////////////////
// MAIN EXPORT
//////////////////////////////////////////////////////

export default function SalonCard({
  salon,
  onPress,
  onWishlist,
  isFavorite = false,
  style,
  variant = "vertical",
}) {
  if (!salon) return null;

  const name        = salon.basicInfo?.shopName || "Salon";
  const category    = CATEGORY_LABEL[salon.basicInfo?.category] || "";
  const tier        = TIER_CONFIG[salon.basicInfo?.tier] || null;
  const address     = salon.location?.address || "";
  const distanceKm  = salon.distance ?? null;
  const distLabel   = formatDistance(distanceKm);
  const openStatus  = getOpenStatus(salon);
  const coverUrl    = salon.media?.coverImage?.url || salon.coverUrl || null;

  // Rating
  const ratingVal   = salon.rating?.averageRating
    ?? (salon.rating?.count > 0 ? (salon.rating.total / salon.rating.count) : null);
  const rating      = ratingVal ? ratingVal.toFixed(1) : null;
  const reviewCount = salon.rating?.reviewCount ?? salon.rating?.count ?? 0;

  // Amenities
  const hasAC      = salon.basicInfo?.amenities?.hasAC;
  const hasWifi    = salon.basicInfo?.amenities?.hasWifi;
  const hasParking = salon.basicInfo?.amenities?.hasParking;

  // Booking stats
  const totalBookings = salon.bookingStats?.totalBookings ?? null;
  const bookingLabel  = totalBookings
    ? totalBookings >= 1000
      ? `Booked ${(totalBookings / 1000).toFixed(1)}k times`
      : `Booked ${totalBookings} times`
    : null;

  const sharedProps = {
    salon, name, category, tier, address, distLabel,
    openStatus, coverUrl, rating, reviewCount,
    hasAC, hasWifi, hasParking, bookingLabel,
    onPress, onWishlist, isFavorite, style,
  };

  if (variant === "horizontal") return <SalonCardHorizontal {...sharedProps} />;
  return <SalonCardVertical {...sharedProps} />;
}

//////////////////////////////////////////////////////
// VERTICAL CARD — Available Now, Search Results
//////////////////////////////////////////////////////
function SalonCardVertical({
  salon, name, category, tier, address, distLabel,
  openStatus, coverUrl, rating, reviewCount,
  hasAC, hasWifi, hasParking, bookingLabel,
  onPress, onWishlist, isFavorite, style,
}) {
  return (
    <TouchableOpacity
      style={[styles.card, style]}
      onPress={onPress}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${openStatus.label}, ${distLabel || ""}`}
    >
      {/* IMAGE */}
      <View style={styles.imageBox}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="storefront-outline" size={32} color={COLORS.border} />
          </View>
        )}

        {/* Top badges */}
        <View style={styles.topBadges}>
          {tier?.label ? (
            <View style={[styles.tierBadge, { backgroundColor: tier.bg }]}>
              <Text style={[styles.tierText, { color: tier.color }]}>{tier.label}</Text>
            </View>
          ) : <View />}

          <View style={[styles.statusBadge, {
            backgroundColor: openStatus.label === "Available Now"
              ? "rgba(22,163,74,0.88)"
              : openStatus.label === "Closing Soon"
              ? "rgba(217,119,6,0.88)"
              : "rgba(100,100,100,0.82)"
          }]}>
            <View style={[styles.statusDot, { backgroundColor: openStatus.dot }]} />
            <Text style={styles.statusText}>{openStatus.label}</Text>
          </View>
        </View>

        {/* Wishlist */}
        <TouchableOpacity
          style={styles.wishlistBtn}
          onPress={(event) => { event?.stopPropagation?.(); onWishlist?.(salon); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Ionicons
            name={isFavorite ? "heart" : "heart-outline"}
            size={16}
            color={isFavorite ? "#EF4444" : "#fff"}
          />
        </TouchableOpacity>

        {/* Rating */}
        {rating && (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={10} color="#F59E0B" />
            <Text style={styles.ratingText}>{rating}</Text>
            {reviewCount > 0 && <Text style={styles.reviewText}>({reviewCount})</Text>}
          </View>
        )}
      </View>

      {/* INFO */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>

        <View style={styles.metaRow}>
          {!rating && (
            <View style={styles.newBadge}>
              <Ionicons name="star" size={10} color="#F59E0B" />
              <Text style={styles.newText}>New</Text>
            </View>
          )}
          {distLabel && (
            <>
              {!rating && <View style={styles.dot} />}
              <Text style={styles.distance}>{distLabel}</Text>
            </>
          )}
        </View>

        {/* Improvement 1: show address */}
        {address ? (
          <Text style={styles.address} numberOfLines={1}>{address}</Text>
        ) : null}

        <View style={styles.tagRow}>
          {category ? (
            <View style={styles.tag}>
              <Text style={styles.tagText}>{category}</Text>
            </View>
          ) : null}
          {hasAC && (
            <View style={styles.amenity}>
              <Ionicons name="snow-outline" size={9} color={COLORS.info} />
              <Text style={styles.amenityText}>AC</Text>
            </View>
          )}
          {hasWifi && (
            <View style={styles.amenity}>
              <Ionicons name="wifi-outline" size={9} color={COLORS.info} />
              <Text style={styles.amenityText}>WiFi</Text>
            </View>
          )}
          {hasParking && (
            <View style={styles.amenity}>
              <Ionicons name="car-outline" size={9} color={COLORS.info} />
              <Text style={styles.amenityText}>Parking</Text>
            </View>
          )}
        </View>

        {/* Booking stats */}
        {bookingLabel && (
          <View style={styles.bookingRow}>
            <Ionicons name="checkmark-circle" size={10} color={COLORS.success} />
            <Text style={styles.bookingText}>{bookingLabel}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

//////////////////////////////////////////////////////
// HORIZONTAL CARD — Nearby Salons list
//////////////////////////////////////////////////////
function SalonCardHorizontal({
  salon, name, category, tier, address, distLabel,
  openStatus, coverUrl, rating, reviewCount,
  hasAC, hasWifi, hasParking, bookingLabel,
  onPress, onWishlist, isFavorite, style,
}) {
  return (
    <TouchableOpacity
      style={[styles.hCard, style]}
      onPress={onPress}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${openStatus.label}`}
    >
      {/* Image */}
      <View style={styles.hImageBox}>
        {coverUrl ? (
          <Image source={{ uri: coverUrl }} style={styles.hImage} resizeMode="cover" />
        ) : (
          <View style={styles.hImagePlaceholder}>
            <Ionicons name="storefront-outline" size={24} color={COLORS.border} />
          </View>
        )}
        {tier?.label ? (
          <View style={[styles.hOfferBadge, { backgroundColor: tier.bg }]}>
            <Text style={[styles.hOfferText, { color: tier.color }]}>{tier.label}</Text>
          </View>
        ) : null}
      </View>

      {/* Info */}
      <View style={styles.hInfo}>
        <View style={styles.hTopRow}>
          <Text style={styles.hName} numberOfLines={1}>{name}</Text>
          <TouchableOpacity
            onPress={(event) => { event?.stopPropagation?.(); onWishlist?.(salon); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={isFavorite ? "heart" : "heart-outline"}
              size={16}
              color={isFavorite ? "#EF4444" : COLORS.text.light}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.hMetaRow}>
          <Ionicons name="star" size={10} color="#F59E0B" />
          <Text style={styles.hRating}>{rating || "New"}</Text>
          {reviewCount > 0 && <Text style={styles.hReviews}>({reviewCount})</Text>}
          {distLabel && <><View style={styles.dot} /><Text style={styles.hDistance}>{distLabel}</Text></>}
        </View>

        {/* Improvement 1: category + address */}
        {category ? <Text style={styles.hCategory}>{category}</Text> : null}
        {address ? <Text style={styles.hAddress} numberOfLines={1}>{address}</Text> : null}

        <View style={styles.hBottomRow}>
          <View style={[styles.hStatusChip, { backgroundColor: openStatus.bg }]}>
            <View style={[styles.hStatusDot, { backgroundColor: openStatus.dot }]} />
            <Text style={[styles.hStatusText, { color: openStatus.color }]}>
              {openStatus.label}
            </Text>
          </View>

          {(hasAC || hasWifi || hasParking) && (
            <View style={styles.hAmenities}>
              {hasAC && <Ionicons name="snow-outline" size={11} color={COLORS.info} />}
              {hasWifi && <Ionicons name="wifi-outline" size={11} color={COLORS.info} />}
              {hasParking && <Ionicons name="car-outline" size={11} color={COLORS.info} />}
            </View>
          )}
        </View>

        {salon.nextSlot && (
          <View style={styles.hSlotRow}>
            <Ionicons name="time-outline" size={9} color="#16A34A" />
            <Text style={styles.hSlotText}>Next Slot: {salon.nextSlot}</Text>
          </View>
        )}
        {bookingLabel && (
          <View style={styles.hBookingRow}>
            <Ionicons name="checkmark-circle" size={9} color={COLORS.success} />
            <Text style={styles.hBookingText}>{bookingLabel}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

//////////////////////////////////////////////////////
// STYLES
//////////////////////////////////////////////////////
const styles = StyleSheet.create({
  // ── VERTICAL ──
  card: {
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    overflow: "hidden",
    ...SHADOWS.card,
  },
  imageBox: { height: 128, backgroundColor: COLORS.surface, position: "relative" },
  image: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  imagePlaceholder: { flex: 1, justifyContent: "center", alignItems: "center" },
  topBadges: {
    position: "absolute", top: 8, left: 8, right: 8,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  tierBadge: { borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3 },
  tierText:  { fontSize: 9, fontFamily: FONTS.bold },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3,
  },
  statusDot:  { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontFamily: FONTS.bold, color: "#fff" },
  wishlistBtn: {
    position: "absolute", top: 8, right: 8,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center", alignItems: "center",
  },
  ratingBadge: {
    position: "absolute", bottom: 8, right: 8,
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3,
  },
  ratingText:  { fontSize: 10, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  reviewText:  { fontSize: 9,  fontFamily: FONTS.regular, color: COLORS.text.secondary },
  info:        { padding: 10 },
  name:        { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 3 },
  metaRow:     { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  newBadge:    { flexDirection: "row", alignItems: "center", gap: 3 },
  newText:     { fontSize: 10, fontFamily: FONTS.bold, color: "#F59E0B" },
  dot:         { width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.text.light },
  distance:    { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  address:     { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.light, marginBottom: 5 },
  tagRow:      { flexDirection: "row", gap: 5, flexWrap: "wrap", marginBottom: 4 },
  tag:         { backgroundColor: COLORS.surfaceAlt, borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText:     { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  amenity:     { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: COLORS.infoLight, borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2 },
  amenityText: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.info },
  bookingRow:  { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  bookingText: { fontSize: 9, fontFamily: FONTS.regular, color: COLORS.success },

  // ── HORIZONTAL ──
  hCard: {
    flexDirection: "row",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    marginBottom: 10,
    overflow: "hidden",
    ...SHADOWS.card,
  },
  hImageBox:        { width: 96, backgroundColor: COLORS.surfaceAlt, position: "relative" },
  hImage:           { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  hImagePlaceholder:{ flex: 1, justifyContent: "center", alignItems: "center" },
  hOfferBadge:      { position: "absolute", bottom: 6, left: 6, borderRadius: RADIUS.full, paddingHorizontal: 6, paddingVertical: 2 },
  hOfferText:       { fontSize: 8, fontFamily: FONTS.bold },
  hInfo:            { flex: 1, padding: 10, gap: 3, justifyContent: "center" },
  hTopRow:          { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  hName:            { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary, flex: 1, marginRight: 8 },
  hMetaRow:         { flexDirection: "row", alignItems: "center", gap: 3 },
  hRating:          { fontSize: 10, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  hReviews:         { fontSize: 9,  fontFamily: FONTS.regular, color: COLORS.text.secondary },
  hDistance:        { fontSize: 10, fontFamily: FONTS.medium,  color: COLORS.text.secondary },
  hCategory:        { fontSize: 10, fontFamily: FONTS.medium,  color: COLORS.text.secondary },
  hAddress:         { fontSize: 9,  fontFamily: FONTS.regular, color: COLORS.text.light },
  hBottomRow:       { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  hStatusChip:      { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: RADIUS.full, paddingHorizontal: 7, paddingVertical: 3 },
  hStatusDot:       { width: 5, height: 5, borderRadius: 3 },
  hStatusText:      { fontSize: 9, fontFamily: FONTS.bold },
  hAmenities:       { flexDirection: "row", alignItems: "center", gap: 4 },
  hBookingRow:      { flexDirection: "row", alignItems: "center", gap: 3 },
  hBookingText:     { fontSize: 9, fontFamily: FONTS.regular, color: COLORS.success },
  hSlotRow:         { flexDirection: "row", alignItems: "center", gap: 3 },
  hSlotText:        { fontSize: 9, fontFamily: FONTS.medium, color: "#16A34A" },
});