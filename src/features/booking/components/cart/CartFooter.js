import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartFooter({ total, duration, onProceed }) {
  return (
    <View style={styles.footer}>
      <View>
        <Text style={styles.label}>Total Payable</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{total}</Text>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.text.secondary} />
        </View>
        {duration > 0 && <Text style={styles.durationText}>{duration} mins total</Text>}
        {duration > 0 && <Text style={styles.duration}>⏱ {duration} mins</Text>}
      </View>
      <TouchableOpacity style={styles.btn} onPress={onProceed} activeOpacity={0.85}>
        <Ionicons name="calendar-outline" size={18} color="#fff" />
        <Text style={styles.btnText}>Proceed to Select Slot</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    paddingBottom: Platform.OS === "ios" ? 32 : 14,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5, borderTopColor: COLORS.border,
  },
  label: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  price: { fontSize: 22, fontFamily: FONTS.bold, color: PURPLE },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 20, paddingVertical: 14,
  },
  btnText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
  duration: { fontSize: 10, fontFamily: FONTS.medium, color: "#5C35E8" },
});
