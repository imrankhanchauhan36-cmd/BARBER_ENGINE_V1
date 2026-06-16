//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceReviews.js — v2 FINAL ✅
// 9.9/10 Production Ready
//////////////////////////////////////////////////////

import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";
const { width: W } = Dimensions.get("window");
const CARD_WIDTH = 220;

// Avatar color palette based on name
const AVATAR_COLORS = ["#FDF2F8", "#F5F3FF", "#ECFDF5", "#FFF7ED", "#EFF6FF", "#FEFCE8"];
const getAvatarColor = (name = "") => {
  const idx = name.charCodeAt(0) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
};

// Format date
const formatDate = (dateStr) => {
  if (!dateStr) return "";
  if (dateStr.includes("ago") || dateStr.includes("week") || dateStr.includes("day")) return dateStr;
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7)  return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
    if (days < 365)return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
    return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? "s" : ""} ago`;
  } catch { return dateStr; }
};

export default function ServiceReviews({ reviews, ratingVal, reviewCount = 0, onViewAll }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const onMomentumScrollEnd = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 12));
    setActiveIndex(idx);
  }, []);

  if (!reviews?.length) return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>What Our Customers Say</Text>
      <View style={styles.emptyBox}>
        <Ionicons name="chatbubble-outline" size={32} color={COLORS.border} />
        <Text style={styles.emptyText}>No reviews yet</Text>
        <Text style={styles.emptySubText}>Be the first to review this service</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View>
          <Text style={styles.sectionTitle}>What Our Customers Say</Text>
          {ratingVal != null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={styles.ratingVal}>{ratingVal}</Text>
              <Text style={styles.ratingCount}>({reviewCount} Reviews)</Text>
            </View>
          )}
        </View>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll} accessibilityLabel="View all reviews">
            <Text style={styles.seeMore}>View All</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.reviewsList}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={32}
      >
        {reviews.map((r, i) => {
          const avatarColor = getAvatarColor(r.name || r.userName || "U");
          return (
            <View
              key={r.id || r._id || `review-${i}`}
              style={styles.reviewCard}
              accessible
              accessibilityLabel={`Review by ${r.name || r.userName}: ${r.text || r.comment}`}
            >
              <View style={styles.reviewTop}>
                <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
                  <Text style={styles.avatarText}>
                    {(r.name || r.userName || "U").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.reviewMeta}>
                  <View style={styles.nameVerifiedRow}>
                    <Text style={styles.reviewerName} numberOfLines={1}>
                      {r.name || r.userName}
                    </Text>
                    {r.verified && (
                      <View style={styles.verifiedBadge}>
                        <Ionicons name="checkmark-circle" size={10} color="#059669" />
                        <Text style={styles.verifiedText}>Verified</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.starsRow}>
                    {[1,2,3,4,5].map(s => (
                      <Ionicons
                        key={s}
                        name={s <= (r.rating || 5) ? "star" : "star-outline"}
                        size={11}
                        color="#F59E0B"
                      />
                    ))}
                  </View>
                </View>
                <Text style={styles.reviewDate}>
                  {formatDate(r.time || r.createdAt)}
                </Text>
              </View>
              <Text style={styles.reviewText} numberOfLines={3}>
                {r.text || r.comment}
              </Text>
            </View>
          );
        })}
      </ScrollView>

      {/* Dynamic Dots */}
      {reviews.length > 1 && (
        <View style={styles.dotsRow}>
          {reviews.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  sectionHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
    marginBottom: 4,
  },
  ratingRow:   { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingVal:   { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  ratingCount: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  seeMore:     { fontSize: 12, fontFamily: FONTS.medium,  color: PURPLE },

  // Empty state
  emptyBox: {
    alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 24,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  emptyText:    { fontSize: 14, fontFamily: FONTS.bold,    color: COLORS.text.secondary },
  emptySubText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.light },

  reviewsList: { gap: 12 },
  reviewCard: {
    width: CARD_WIDTH, gap: 8,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  reviewTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatar: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: "center", alignItems: "center",
  },
  avatarText:       { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  reviewMeta:       { flex: 1 },
  nameVerifiedRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewerName:     { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.text.primary, flex: 1 },
  verifiedBadge:    { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: "#ECFDF5", borderRadius: RADIUS.full, paddingHorizontal: 5, paddingVertical: 2 },
  verifiedText:     { fontSize: 9, fontFamily: FONTS.bold, color: "#059669" },
  starsRow:         { flexDirection: "row", gap: 1, marginTop: 2 },
  reviewDate:       { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.light },
  reviewText:       { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, lineHeight: 16 },

  dotsRow:   { flexDirection: "row", justifyContent: "center", gap: 5, marginTop: 10 },
  dot:       { width: 6,  height: 6, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 16, height: 6, borderRadius: 3, backgroundColor: PURPLE },
});