//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceAddons.js — v3 FINAL ✅
// Reference matched — with dummy fallback
//////////////////////////////////////////////////////

import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

const DEFAULT_ADDONS = [
  { _id: "addon_1", id: "addon_1", name: "Hair Spa",       duration: "30 mins", price: 299, originalPrice: 499, emoji: "🧴" },
  { _id: "addon_2", id: "addon_2", name: "Beard Trim",     duration: "20 mins", price: 199, originalPrice: 299, emoji: "🧔" },
  { _id: "addon_3", id: "addon_3", name: "Facial Cleanup", duration: "30 mins", price: 349, originalPrice: 499, emoji: "✨" },
  { _id: "addon_4", id: "addon_4", name: "Hair Massage",   duration: "20 mins", price: 199, originalPrice: 499, emoji: "💆" },
];

export default function ServiceAddons({ addons, onAdd, onViewAll }) {
  const [selectedIds, setSelectedIds] = useState([]);

  const displayAddons = addons?.length ? addons : DEFAULT_ADDONS;

  const toggleAddon = (addon) => {
    setSelectedIds(prev =>
      prev.includes(addon.id)
        ? prev.filter(id => id !== addon.id)
        : [...prev, addon.id]
    );
    onAdd?.(addon);
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Recommended Add-ons</Text>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll}>
            <Text style={styles.viewAll}>View All</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      >
        {displayAddons.map((a, i) => {
          const isSelected = selectedIds.includes(a.id);
          const discount = a.originalPrice
            ? Math.round(((a.originalPrice - a.price) / a.originalPrice) * 100)
            : null;

          return (
            <View
              key={a.id || `addon-${i}`}
              style={[styles.card, isSelected && styles.cardSelected]}
            >
              {/* Emoji / Image */}
              <View style={styles.emojiBox}>
                <Text style={styles.emoji}>{a.emoji || "💅"}</Text>
              </View>

              {/* Info */}
              <Text style={styles.addonName} numberOfLines={1}>{a.name}</Text>
              <Text style={styles.addonDur}>{a.duration || (a.durationMinutes ? `${a.durationMinutes} mins` : "")}</Text>

              {/* Price row */}
              <View style={styles.priceRow}>
                <Text style={styles.addonPrice}>₹{Number(a.price).toLocaleString("en-IN")}</Text>
                {a.originalPrice && (
                  <Text style={styles.originalPrice}>₹{Number(a.originalPrice).toLocaleString("en-IN")}</Text>
                )}
              </View>

              {/* Add button */}
              <TouchableOpacity
                style={[styles.addBtn, isSelected && styles.addBtnSelected]}
                onPress={() => toggleAddon(a)}
              >
                <Ionicons
                  name={isSelected ? "checkmark" : "add"}
                  size={14}
                  color={isSelected ? "#fff" : PURPLE}
                />
                <Text style={[styles.addBtnText, isSelected && styles.addBtnTextSelected]}>
                  {isSelected ? "Added" : "+ Add"}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {selectedIds.length > 0 && (
        <View style={styles.selectedBanner}>
          <Ionicons name="checkmark-circle" size={14} color={PURPLE} />
          <Text style={styles.selectedText}>
            {selectedIds.length} add-on{selectedIds.length > 1 ? "s" : ""} selected
          </Text>
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
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  viewAll:      { fontSize: 12, fontFamily: FONTS.medium, color: PURPLE },

  list: { gap: 10 },

  card: {
    width: 130,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 10,
    borderWidth: 0.5, borderColor: COLORS.border,
    gap: 4,
  },
  cardSelected: {
    borderColor: PURPLE,
    backgroundColor: "#F5F3FF",
  },

  emojiBox: {
    width: 44, height: 44,
    borderRadius: 22,
    backgroundColor: "#F5F3FF",
    justifyContent: "center", alignItems: "center",
    marginBottom: 4,
  },
  emoji: { fontSize: 22 },

  addonName:     { fontSize: 12, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  addonDur:      { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  priceRow:      { flexDirection: "row", alignItems: "center", gap: 6 },
  addonPrice:    { fontSize: 13, fontFamily: FONTS.bold,    color: PURPLE },
  originalPrice: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.light, textDecorationLine: "line-through" },

  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4,
    marginTop: 4,
    borderWidth: 1.5, borderColor: PURPLE,
    borderRadius: RADIUS.md,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  addBtnSelected:     { backgroundColor: PURPLE, borderColor: PURPLE },
  addBtnText:         { fontSize: 12, fontFamily: FONTS.bold, color: PURPLE },
  addBtnTextSelected: { color: "#fff" },

  selectedBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10,
    backgroundColor: "#F5F3FF",
    borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  selectedText: { fontSize: 12, fontFamily: FONTS.bold, color: PURPLE },
});