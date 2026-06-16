import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartHeader({ onBack, onClear }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity style={styles.backBtn} onPress={onBack}>
        <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
      </TouchableOpacity>
      <Text style={styles.title}>Your Cart</Text>
      <View style={styles.right}>
        <TouchableOpacity style={styles.iconBtn} onPress={onClear}>
          <Ionicons name="trash-outline" size={20} color={COLORS.text.secondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn}>
          <Ionicons name="heart-outline" size={20} color={COLORS.text.secondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  title: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.text.primary },
  right: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
});
