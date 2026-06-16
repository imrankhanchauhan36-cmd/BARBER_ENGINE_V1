//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeRecentlyViewed.js — NEW ✅
// IC Salons exact style — horizontal recently viewed
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

function RecentCard({ salon, onPress }) {
  const name = salon.basicInfo?.shopName || "Salon";
  const distance = salon.distance ? `${salon.distance.toFixed(1)} km` : null;

  const ratingVal = salon.rating?.averageRating
    ?? (salon.rating?.count > 0
        ? (salon.rating.total / salon.rating.count)
        : null);
  const rating = ratingVal ? ratingVal.toFixed(1) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      {/* Image */}
      <View style={styles.imageBox}>
        {(salon.media?.coverImage?.url || salon.coverUrl) ? (
          <Image source={{ uri: salon.media?.coverImage?.url || salon.coverUrl }} style={styles.image} resizeMode="cover" />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Text style={styles.placeholderEmoji}>💈</Text>
          </View>
        )}
        {/* Rating overlay */}
        {rating && (
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={9} color="#F59E0B" />
            <Text style={styles.ratingText}>{rating}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {distance && (
          <Text style={styles.distance}>{distance}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function HomeRecentlyViewed({ salons = [], onSalonPress, onViewAll }) {
  if (!salons.length) return null;

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Recently Viewed</Text>
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      {/* Horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {salons.slice(0, 6).map((salon) => (
          <RecentCard
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
  wrapper:  { marginBottom: 24 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title:   { fontSize: 16, fontFamily: FONTS.bold,   color: COLORS.text.primary },
  viewAll: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.primary },

  list: { paddingHorizontal: 16, gap: 10 },

  card: {
    width: 100,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  imageBox: {
    height: 90,
    backgroundColor: COLORS.surfaceAlt,
    position: "relative",
  },
  image: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  imagePlaceholder: {
    flex: 1, justifyContent: "center", alignItems: "center",
  },
  placeholderEmoji: { fontSize: 28 },

  ratingBadge: {
    position: "absolute",
    bottom: 6, right: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: RADIUS.full,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  ratingText: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.text.primary },

  info:     { padding: 8, gap: 2 },
  name:     { fontSize: 11, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  distance: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
});