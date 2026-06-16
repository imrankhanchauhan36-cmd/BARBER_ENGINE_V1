import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartCoupon({ value, onChange, onApply }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.banner}>
        <View style={styles.bannerLeft}>
          <View style={styles.icon}>
            <Text style={styles.iconText}>%</Text>
          </View>
          <View>
            <Text style={styles.bannerTitle}>Save Extra with Coupons</Text>
            <Text style={styles.bannerSub}>Apply a coupon code & save more</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={COLORS.text.secondary} />
      </TouchableOpacity>
      <View style={styles.inputRow}>
        <View style={styles.inputBox}>
          <Ionicons name="pricetag-outline" size={16} color={COLORS.text.secondary} />
          <TextInput
            placeholder="Enter coupon code"
            placeholderTextColor={COLORS.text.secondary}
            value={value}
            onChangeText={onChange}
            style={styles.input}
            autoCapitalize="characters"
          />
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={onApply}>
          <Text style={styles.applyText}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 16 },
  banner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: 14, backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE", marginBottom: 12,
  },
  bannerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },
  iconText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
  bannerTitle: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bannerSub: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  inputRow: { flexDirection: "row", gap: 10 },
  inputBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  input: { flex: 1, fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },
  applyBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 20, justifyContent: "center",
  },
  applyText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
});
