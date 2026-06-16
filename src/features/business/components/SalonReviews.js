//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonReviews.js — LOCKED ✅
// Exact screenshot — 2 cards side by side horizontal
// avatar + name + date + stars + review text
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

// Static placeholder reviews — replace with API
const PLACEHOLDER_REVIEWS = [
  {
    _id: "1",
    name: "Sneha R.",
    rating: 5,
    text: "Amazing haircut! Staff is very professional and the ambience is top-notch.",
    timeAgo: "2 days ago",
    avatarColor: "#FDF2F8",
    initial: "S",
  },
  {
    _id: "2",
    name: "Vikram N.",
    rating: 5,
    text: "Best salon in Koramangala. Highly recommended!",
    timeAgo: "1 week ago",
    avatarColor: "#EFF6FF",
    initial: "V",
  },
];

function ReviewCard({ review }) {
  return (
    <View style={styles.card}>
      {/* Top — avatar + name + date */}
      <View style={styles.cardTop}>
        <View style={[styles.avatar, { backgroundColor: review.avatarColor || COLORS.surfaceAlt }]}>
          {review.photoUrl ? (
            <Image source={{ uri: review.photoUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{review.initial || review.name?.charAt(0)}</Text>
          )}
        </View>
        <View style={styles.metaCol}>
          <Text style={styles.reviewerName}>{review.name}</Text>
          <Text style={styles.reviewDate}>{review.timeAgo}</Text>
        </View>
      </View>

      {/* Stars */}
      <View style={styles.starsRow}>
        {[1,2,3,4,5].map(i => (
          <Ionicons
            key={i}
            name={i <= review.rating ? "star" : "star-outline"}
            size={13}
            color="#F59E0B"
          />
        ))}
      </View>

      {/* Review text */}
      <Text style={styles.reviewText} numberOfLines={3}>
        {review.text}
      </Text>
    </View>
  );
}

export default function SalonReviews({ reviews, reviewCount = 0, onViewAll }) {
  const data = reviews?.length ? reviews : PLACEHOLDER_REVIEWS;
  // Always show with placeholder reviews

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Customer Reviews</Text>
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      {/* 2 cards side by side */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {data.slice(0, 4).map((r) => (
          <ReviewCard key={r._id} review={r} />
        ))}
      </ScrollView>

      {/* Dots indicator */}
      <View style={styles.dotsRow}>
        {data.slice(0, 4).map((_, i) => (
          <View key={i} style={[styles.dot, i === 0 && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    paddingBottom: 12,
    ...SHADOWS.card,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.bold,   color: COLORS.text.primary },
  viewAll:      { fontSize: 13, fontFamily: FONTS.medium, color: "#5C35E8" },

  list: {
    paddingHorizontal: 14,
    paddingTop: 14,
    gap: 12,
  },

  card: {
    width: 220,
    gap: 8,
  },

  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    overflow: "hidden",
    justifyContent: "center", alignItems: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: {
    fontSize: 16, fontFamily: FONTS.bold,
    color: COLORS.text.secondary,
  },
  metaCol:      { flex: 1 },
  reviewerName: { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  reviewDate:   { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.light },

  starsRow: { flexDirection: "row", gap: 2 },

  reviewText: {
    fontSize: 12,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
    lineHeight: 18,
  },

  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 5,
    marginTop: 10,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: COLORS.border,
  },
  dotActive: {
    width: 16,
    backgroundColor: "#5C35E8",
  },
});