import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const AMENITY_CONFIG = [
  { key: "sanitizedTools", icon: "color-wand-outline",       label: "Sanitized Tools" },
  { key: "hasAC",          icon: "snow-outline",             label: "AC Available"    },
  { key: "hasWifi",        icon: "wifi-outline",             label: "Free Wi-Fi"      },
  { key: "hasParking",     icon: "car-outline",              label: "Parking"         },
  { key: "cardAccepted",   icon: "card-outline",             label: "Card Accepted"   },
  { key: "cleanSafe",      icon: "shield-checkmark-outline", label: "Clean & Safe"    },
];

export default function SalonAmenities({ amenities = {} }) {
  const active = AMENITY_CONFIG.filter(a => amenities[a.key]);
  if (!active.length) return null;

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {active.map((a) => (
          <View key={a.key} style={styles.item}>
            <Ionicons name={a.icon} size={20} color={COLORS.primary} />
            <Text style={styles.label}>{a.label}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    marginHorizontal: 16,
    marginVertical: 12,
    backgroundColor: COLORS.background,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 4,
    paddingVertical: 12,
    gap: 0,
  },
  item: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    minWidth: 65,
  },
  label: {
    fontSize: 9,
    fontFamily: FONTS.medium,
    color: COLORS.text.secondary,
    textAlign: "center",
  },
});