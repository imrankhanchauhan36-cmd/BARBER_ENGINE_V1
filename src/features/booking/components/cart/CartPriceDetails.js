import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartPriceDetails({ count, subtotal, discount, coupon, taxes, total, onRemoveCoupon }) {
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Price Details</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Subtotal ({count} Services)</Text>
        <Text style={styles.value}>₹{subtotal}</Text>
      </View>
      {discount > 0 && (
        <View style={styles.row}>
          <Text style={styles.label}>Discount</Text>
          <Text style={[styles.value, { color: "#16A34A" }]}>- ₹{discount}</Text>
        </View>
      )}
      {coupon ? (
        <View style={styles.row}>
          <Text style={styles.label}>Coupon <Text style={{ color: "#16A34A" }}>({coupon})</Text></Text>
          <Text style={[styles.value, { color: PURPLE }]} onPress={onRemoveCoupon}>Remove</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.taxRow}>
          <Text style={styles.label}>Taxes & Charges</Text>
          <Ionicons name="information-circle-outline" size={14} color={COLORS.text.secondary} />
        </View>
        <Text style={styles.value}>₹{taxes}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Text style={styles.totalLabel}>Total Amount</Text>
        <Text style={styles.totalValue}>₹{total}</Text>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 16 },
  title: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  label: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  value: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },
  taxRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  divider: { height: 0.5, backgroundColor: COLORS.border, marginVertical: 10 },
  totalLabel: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  totalValue: { fontSize: 17, fontFamily: FONTS.bold, color: PURPLE },
});
