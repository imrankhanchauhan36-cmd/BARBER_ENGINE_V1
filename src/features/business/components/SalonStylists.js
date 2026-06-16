//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/SalonStylists.js — LOCKED ✅
// Exact screenshot — horizontal, avatar + name + role
// + rating + services count
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

function StylistCard({ stylist }) {
  const name     = stylist.name || "Stylist";
  const role     = stylist.role || "Hair Expert";
  const rating   = stylist.rating || "4.8";
  const services = stylist.servicesCount
    ? `${stylist.servicesCount}+ Services`
    : null;

  return (
    <View style={styles.card}>
      {/* Avatar */}
      <View style={styles.avatarBox}>
        {stylist.photoUrl ? (
          <Image
            source={{ uri: stylist.photoUrl }}
            style={styles.avatarImg}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      {/* Info */}
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <Text style={styles.role} numberOfLines={1}>{role}</Text>

      {/* Rating */}
      <View style={styles.ratingRow}>
        <Ionicons name="star" size={11} color="#F59E0B" />
        <Text style={styles.ratingText}>{rating}</Text>
      </View>

      {/* Services count */}
      {services && (
        <Text style={styles.servicesText}>{services}</Text>
      )}
    </View>
  );
}

export default function SalonStylists({ staff = [], onViewAll }) {
  if (!staff.length) return null;

  return (
    <View style={styles.wrapper}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Top Stylists</Text>
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
        {staff.slice(0, 6).map((s, i) => (
          <StylistCard key={s._id || i} stylist={s} />
        ))}
      </ScrollView>
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
    paddingBottom: 14,
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
    gap: 20,
  },

  card: {
    alignItems: "center",
    gap: 4,
    width: 90,
  },

  // Avatar
  avatarBox: {
    width: 64, height: 64,
    borderRadius: 32,
    overflow: "hidden",
    marginBottom: 2,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarFallback: {
    width: "100%", height: "100%",
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: "center", alignItems: "center",
  },
  avatarInitial: {
    fontSize: 22, fontFamily: FONTS.bold,
    color: COLORS.text.secondary,
  },

  name:         { fontSize: 12, fontFamily: FONTS.bold,    color: COLORS.text.primary,   textAlign: "center" },
  role:         { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center" },
  ratingRow:    { flexDirection: "row", alignItems: "center", gap: 3 },
  ratingText:   { fontSize: 11, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  servicesText: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center" },
});