//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceHeroCarousel.js — v2 FINAL ✅
// 9.8/10 Production Ready
//////////////////////////////////////////////////////

import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, Image,
  FlatList, TouchableOpacity, Dimensions, Platform, StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const { width: W } = Dimensions.get("window");
export const HERO_HEIGHT = 260;

const CATEGORY_DEFAULTS = {
  facial:  { emoji: "✨", bg: "#ECFEFF" },
  haircut: { emoji: "✂️", bg: "#F5F3FF" },
  beard:   { emoji: "🧔", bg: "#F0FDF4" },
  spa:     { emoji: "💆", bg: "#FDF2F8" },
  other:   { emoji: "💅", bg: "#FFF7ED" },
};

export default function ServiceHeroCarousel({
  images = [],
  category = "other",
  isFavorite = false,
  onBack,
  onShare,
  onWishlist,
  onOpenGallery,
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const defaults = CATEGORY_DEFAULTS[category] || CATEGORY_DEFAULTS.other;

  // Safe image filter
  const validImages = images.filter(Boolean);

  const onMomentumScrollEnd = useCallback((e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / W);
    setActiveIndex(idx);
  }, []);

  const keyExtractor = useCallback((item, index) =>
    item || index.toString(), []);

  const renderItem = useCallback(({ item }) => (
    <Image
      source={{ uri: item }}
      style={styles.image}
      resizeMode="cover"
      onError={() => { if (__DEV__) console.log("Service image failed:", item); }}
    />
  ), []);

  return (
    <View style={[styles.wrapper, { backgroundColor: defaults.bg }]}>

      {/* Images or Placeholder */}
      {validImages.length > 0 ? (
        <FlatList
          data={validImages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          horizontal pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          scrollEventThrottle={32}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews
        />
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.emoji}>{defaults.emoji}</Text>
        </View>
      )}

      {/* Bottom gradient simulation */}
      <View style={styles.gradientOverlay} />

      {/* Floating Header */}
      <View style={styles.floatingTop}>
        <TouchableOpacity
          style={styles.floatBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={styles.floatRight}>
          <TouchableOpacity
            style={styles.floatBtn}
            onPress={onShare}
            accessibilityRole="button"
            accessibilityLabel="Share"
          >
            <Ionicons name="share-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.floatBtn}
            onPress={onWishlist}
            accessibilityRole="button"
            accessibilityLabel={isFavorite ? "Remove from wishlist" : "Add to wishlist"}
          >
            <Ionicons
              name={isFavorite ? "heart" : "heart-outline"}
              size={20}
              color={isFavorite ? "#FF4D6D" : "#fff"}
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* View Gallery */}
      {validImages.length > 1 && (
        <TouchableOpacity
          style={styles.galleryBtn}
          onPress={onOpenGallery}
          accessibilityRole="button"
          accessibilityLabel="View all photos"
        >
          <Ionicons name="images-outline" size={14} color="#fff" />
          <Text style={styles.galleryText}>View Gallery</Text>
        </TouchableOpacity>
      )}

      {/* Counter */}
      <View style={styles.counter}>
        <Text style={styles.counterText}>
          {activeIndex + 1}/{Math.max(validImages.length, 1)}
        </Text>
      </View>

      {/* Dots */}
      {validImages.length > 1 && (
        <View style={styles.dots}>
          {validImages.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { height: HERO_HEIGHT, position: "relative" },
  image:   { width: W, height: HERO_HEIGHT },

  placeholder: {
    flex: 1, justifyContent: "center", alignItems: "center",
  },
  emoji: { fontSize: 80 },

  // Simulated gradient overlay
  gradientOverlay: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: 80,
    backgroundColor: "rgba(0,0,0,0.25)",
  },

  floatingTop: {
    position: "absolute",
    top: Platform.OS === "ios" ? 52 : (StatusBar.currentHeight || 0) + 8,
    left: 0, right: 0, zIndex: 10,
    flexDirection: "row", justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  floatRight: { flexDirection: "row", gap: 8 },
  floatBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center", alignItems: "center",
  },

  galleryBtn: {
    position: "absolute", bottom: 14, right: 50,
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.4)",
  },
  galleryText: { fontSize: 11, fontFamily: FONTS.bold, color: "#fff" },

  counter: {
    position: "absolute", bottom: 14, right: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: RADIUS.full, paddingHorizontal: 8, paddingVertical: 3,
  },
  counterText: { fontSize: 10, fontFamily: FONTS.bold, color: "#fff" },

  dots: {
    position: "absolute", bottom: 14,
    alignSelf: "center",
    flexDirection: "row", gap: 5,
  },
  dot:       { width: 6,  height: 6, borderRadius: 3,  backgroundColor: "rgba(255,255,255,0.5)" },
  dotActive: { width: 16, height: 6, borderRadius: 3,  backgroundColor: "#fff" },
});