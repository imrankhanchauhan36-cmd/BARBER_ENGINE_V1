//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonServices.js — LOCKED ✅
// Exact screenshot — image + name + desc + inclusion
// + price + duration + View Details
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

// Fallback emoji per index
const FALLBACK = [
  { emoji: "✂️", bg: "#F5F3FF" },
  { emoji: "🧔", bg: "#F0FDF4" },
  { emoji: "✨", bg: "#ECFEFF" },
  { emoji: "💆", bg: "#FDF2F8" },
  { emoji: "💅", bg: "#FFF7ED" },
  { emoji: "💄", bg: "#EFF6FF" },
];

function ServiceRow({ service, index, onViewDetails }) {
  const fb = FALLBACK[index % FALLBACK.length];

  return (
    <View style={styles.row}>
      {/* Image */}
      <View style={styles.imgBox}>
        {(service.thumbnailImage || service.imageUrl) ? (
          <Image
            source={{ uri: service.thumbnailImage || service.imageUrl }}
            style={styles.img}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.imgFallback, { backgroundColor: fb.bg }]}>
            <Text style={styles.imgEmoji}>{fb.emoji}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name}>{service.name}</Text>
        {service.description ? (
          <Text style={styles.desc} numberOfLines={1}>{service.description}</Text>
        ) : null}
        {service.inclusions?.[0] ? (
          <View style={styles.inclusionRow}>
            <Ionicons name="checkmark-circle" size={12} color="#5C35E8" />
            <Text style={styles.inclusionText}>{service.inclusions[0]}</Text>
          </View>
        ) : null}
      </View>

      {/* Price + Duration + CTA */}
      <View style={styles.priceCol}>
        <Text style={styles.price}>₹{service.price}</Text>
        <Text style={styles.duration}>{service.duration} mins</Text>
        <TouchableOpacity
          style={styles.viewBtn}
          onPress={() => onViewDetails?.(service)}
          activeOpacity={0.8}
        >
          <Text style={styles.viewBtnText}>View Details</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function SalonServices({ services = [], onViewAll, onViewDetails }) {
  if (!services.length) return null;

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Services</Text>
        <TouchableOpacity onPress={onViewAll} activeOpacity={0.7}>
          <Text style={styles.viewAll}>View All</Text>
        </TouchableOpacity>
      </View>

      {/* Service rows */}
      {services.slice(0, 4).map((s, i) => (
        <ServiceRow
          key={s._id}
          service={s}
          index={i}
          onViewDetails={onViewDetails}
        />
      ))}
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
    overflow: "hidden",
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

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.borderLight,
  },

  // Image
  imgBox: {
    width: 70, height: 70,
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%" },
  imgFallback: {
    width: "100%", height: "100%",
    justifyContent: "center", alignItems: "center",
  },
  imgEmoji: { fontSize: 28 },

  // Info
  info: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  desc: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  inclusionRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  inclusionText:{ fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },

  // Price col
  priceCol: { alignItems: "flex-end", gap: 3 },
  price:    { fontSize: 14, fontFamily: FONTS.bold,    color: "#5C35E8" },
  duration: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  viewBtn: {
    borderWidth: 1,
    borderColor: "#5C35E8",
    borderRadius: RADIUS.md,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 2,
  },
  viewBtnText: { fontSize: 11, fontFamily: FONTS.bold, color: "#5C35E8" },
});