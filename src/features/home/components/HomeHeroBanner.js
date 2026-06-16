//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeHeroBanner.js — v2 FINAL ✅
//////////////////////////////////////////////////////

import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const { width: SCREEN_W } = Dimensions.get("window");
const CARD_W = SCREEN_W - 32;

const BANNERS = [
  {
    id: "1",
    title: "Glow This\nSeason ✨",
    subtitle: "Explore top salons near you\nand book your look.",
    cta: "Explore Salons",
    bg: "#EEEEFF",
    titleColor: "#3730A3",
    subtitleColor: "#6B7280",
    ctaBg: "#4F46E5",
    decorColor: "#C7D2FE",
    emoji: "💆‍♀️",
  },
  {
    id: "2",
    title: "First Booking\nFree 🎉",
    subtitle: "Get ₹100 off on your\nfirst appointment",
    cta: "Book Now",
    bg: "#131921",
    titleColor: "#FF9900",
    subtitleColor: "rgba(255,255,255,0.7)",
    ctaBg: "#FF9900",
    decorColor: "rgba(255,153,0,0.15)",
    emoji: "✂️",
  },
  {
    id: "3",
    title: "Premium\nSalons 👑",
    subtitle: "Handpicked top-rated\nsalons in your city",
    cta: "View Premium",
    bg: "#FFF7ED",
    titleColor: "#92400E",
    subtitleColor: "#78716C",
    ctaBg: "#D97706",
    decorColor: "#FDE68A",
    emoji: "💅",
  },
];

export default function HomeHeroBanner({ onCtaPress }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = (e) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_W + 12));
    setActiveIndex(idx);
  };

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        pagingEnabled={false}
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={CARD_W + 12}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {BANNERS.map((b, idx) => (
          <View key={b.id} style={[styles.card, { backgroundColor: b.bg, width: CARD_W }]}>

            {/* Decorative circles */}
            <View style={[styles.circle1, { backgroundColor: b.decorColor }]} />
            <View style={[styles.circle2, { backgroundColor: b.decorColor }]} />

            {/* Left content */}
            <View style={styles.leftContent}>
              <Text style={[styles.title, { color: b.titleColor }]}>{b.title}</Text>
              <Text style={[styles.subtitle, { color: b.subtitleColor }]}>{b.subtitle}</Text>
              <TouchableOpacity
                style={[styles.ctaBtn, { backgroundColor: b.ctaBg }]}
                onPress={() => onCtaPress?.(b)}
                activeOpacity={0.85}
              >
                <Text style={styles.ctaText}>{b.cta}</Text>
                <Ionicons name="arrow-forward" size={12} color="#fff" />
              </TouchableOpacity>
            </View>

            {/* Right — emoji decoration */}
            <View style={styles.rightDecor}>
              <View style={[styles.emojiCircle, { backgroundColor: b.decorColor }]}>
                <Text style={styles.emoji}>{b.emoji}</Text>
              </View>
            </View>

            {/* Slide counter */}
            <View style={styles.counter}>
              <Text style={[styles.counterText, { color: b.subtitleColor }]}>
                {idx + 1}/{BANNERS.length}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Dots */}
      <View style={styles.dots}>
        {BANNERS.map((_, i) => (
          <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 16 },

  card: {
    borderRadius: RADIUS.xl,
    padding: 20,
    height: 148,
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    position: "relative",
  },

  circle1: {
    position: "absolute",
    width: 120, height: 120, borderRadius: 60,
    top: -30, right: 60, opacity: 0.5,
  },
  circle2: {
    position: "absolute",
    width: 80, height: 80, borderRadius: 40,
    bottom: -20, right: 20, opacity: 0.4,
  },

  leftContent: { flex: 1, zIndex: 1 },
  title: {
    fontSize: 18,
    fontFamily: FONTS.bold,
    lineHeight: 24,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 11,
    fontFamily: FONTS.regular,
    lineHeight: 16,
    marginBottom: 12,
  },
  ctaBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.full,
  },
  ctaText: { fontSize: 12, fontFamily: FONTS.bold, color: "#fff" },

  rightDecor: { zIndex: 1, marginLeft: 12 },
  emojiCircle: {
    width: 72, height: 72, borderRadius: 36,
    justifyContent: "center", alignItems: "center",
  },
  emoji: { fontSize: 36 },

  counter: {
    position: "absolute", bottom: 10, right: 12,
    backgroundColor: "rgba(0,0,0,0.08)",
    borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  counterText: { fontSize: 10, fontFamily: FONTS.bold },

  dots: {
    flexDirection: "row", justifyContent: "center",
    gap: 5, marginTop: 8,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: COLORS.border },
  dotActive: { width: 16, backgroundColor: COLORS.primary },
});