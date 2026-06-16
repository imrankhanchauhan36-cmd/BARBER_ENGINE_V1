//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeFeaturedSalons.js
// IC Salons style — horizontal scroll cards
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

const PLACEHOLDER_COLORS = ["#EEF0FF", "#FFF0F5", "#F0FFF4", "#FFFBEB", "#F0F4FF"];

function FeaturedCard({ salon, onPress }) {
  const name     = salon.basicInfo?.shopName || "Salon";
  const rating   = salon.rating?.count > 0
    ? (salon.rating.total / salon.rating.count).toFixed(1)
    : "New";
  const distance = salon.distance ? `${salon.distance.toFixed(1)} km` : null;
  const isOpen   = salon.business?.isShopOpen && !salon.business?.isForceClosed;
  const CATEGORY_LABEL = { MEN_ONLY: "Men's Salon", WOMEN_ONLY: "Women's Salon", UNISEX: "Unisex Salon" };
  const services = CATEGORY_LABEL[salon.basicInfo?.category] || salon.basicInfo?.category || "Unisex";

  // Discount badge — show if salon has offers
  const hasOffer = salon.offers?.length > 0;
  const offerText = hasOffer ? `${salon.offers[0]?.discountPercent || 10}% OFF` : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      {/* Image */}
      <View style={styles.imageBox}>
        {salon.coverUrl ? (
          <Image
            source={{ uri: salon.coverUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: PLACEHOLDER_COLORS[Math.abs(salon._id?.toString().charCodeAt(0) || 0) % PLACEHOLDER_COLORS.length] }]}>
            <Text style={styles.placeholderEmoji}>💈</Text>
            <Text style={styles.placeholderName} numberOfLines={1}>{(salon.basicInfo?.shopName || "S")[0].toUpperCase()}</Text>
          </View>
        )}

        {/* Offer badge */}
        {offerText && (
          <View style={styles.offerBadge}>
            <Text style={styles.offerText}>{offerText}</Text>
          </View>
        )}

        {/* Wishlist */}
        <TouchableOpacity style={styles.wishlistBtn} activeOpacity={0.8}>
          <Ionicons name="heart-outline" size={14} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.ratingRow}>
          <Ionicons name="star" size={11} color="#F59E0B" />
          <Text style={styles.rating}>{rating}</Text>
          {distance && (
            <>
              <View style={styles.dot} />
              <Text style={styles.distance}>{distance}</Text>
            </>
          )}
        </View>
        <Text style={styles.services} numberOfLines={1}>{services}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹₹</Text>
          <Text style={styles.priceLabel}>· 1 Person</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function HomeFeaturedSalons({ salons, onSalonPress, onViewAll }) {
  if (!salons?.length) return null;

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Nearby Salons</Text>
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7} style={styles.locationBtn}>
          <Ionicons name="navigate" size={12} color={COLORS.primary} />
          <Text style={styles.viewAll}>Use my location</Text>
        </TouchableOpacity>
      </View>

      {/* Horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {salons.slice(0, 6).map((salon) => (
          <FeaturedCard
            key={salon._id}
            salon={salon}
            onPress={() => onSalonPress?.(salon)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  locationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAll: {
    fontSize: 12,
    fontFamily: FONTS.medium,
    color: COLORS.primary,
  },
  list: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    width: 160,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  imageBox: {
    height: 110,
    backgroundColor: COLORS.surfaceAlt,
    position: "relative",
  },
  image: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
  },
  imagePlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  placeholderEmoji: { fontSize: 28 },
  placeholderName: { fontSize: 18, fontFamily: FONTS.black, color: COLORS.text.secondary },
  offerBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  offerText: {
    fontSize: 9,
    fontFamily: FONTS.bold,
    color: "#fff",
  },
  wishlistBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    padding: 10,
    gap: 3,
  },
  name: {
    fontSize: 13,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  rating: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.text.light,
  },
  distance: {
    fontSize: 11,
    fontFamily: FONTS.medium,
    color: COLORS.text.secondary,
  },
  services: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 2,
  },
  price: {
    fontSize: 11,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  priceLabel: {
    fontSize: 10,
    fontFamily: FONTS.regular,
    color: COLORS.text.light,
  },
});