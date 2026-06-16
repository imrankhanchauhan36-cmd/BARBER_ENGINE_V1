import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartSalonCard({ salon, onChangeSlot }) {
  const name = salon?.basicInfo?.shopName || "Salon";
  const city = salon?.basicInfo?.address?.city || "Nearby";
  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>{name?.charAt(0) || "S"}</Text>
        </View>
        <View>
          <Text style={styles.label}>Salon</Text>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            <Ionicons name="checkmark-circle" size={13} color={PURPLE} />
          </View>
          <View style={styles.meta}>
            <Ionicons name="location-outline" size={11} color={COLORS.text.secondary} />
            <Text style={styles.metaText}>{city}</Text>
          </View>
        </View>
      </View>
      <View style={styles.right}>
        <Text style={styles.label}>Next Available Slot</Text>
        <Text style={styles.slot}>Tap to Select Slot</Text>
        <TouchableOpacity style={styles.changeBtn} onPress={onChangeSlot}>
          <Text style={styles.changeBtnText}>Change Slot</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    flexDirection: "row", justifyContent: "space-between",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: COLORS.border, gap: 12,
  },
  left: { flexDirection: "row", gap: 10, flex: 1 },
  logo: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: "#1a1a1a", justifyContent: "center", alignItems: "center",
  },
  logoText: { fontSize: 18, fontFamily: FONTS.bold, color: "#fff" },
  label: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  meta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  metaText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  right: { alignItems: "flex-end", gap: 4 },
  slot: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },
  changeBtn: {
    borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  changeBtnText: { fontSize: 11, fontFamily: FONTS.medium, color: PURPLE },
});
