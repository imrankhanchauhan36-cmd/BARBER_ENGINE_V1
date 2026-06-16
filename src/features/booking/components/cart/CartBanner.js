import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";
const PURPLE = "#5C35E8";
export default function CartBanner({ onAddMore }) {
  return (
    <View style={styles.banner}>
      <View style={styles.left}>
        <View style={styles.bagIcon}>
          <Ionicons name="bag-handle-outline" size={22} color={PURPLE} />
        </View>
        <View>
          <Text style={styles.title}>Complete your booking</Text>
          <Text style={styles.sub}>Add services, choose barber &{"\n"}pick a time slot.</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.addBtn} onPress={onAddMore}>
        <Ionicons name="add" size={13} color={PURPLE} />
        <Text style={styles.addText}>Add More Services</Text>
      </TouchableOpacity>
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    margin: 16, padding: 14,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  left: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  bagIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  title: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  sub: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  addText: { fontSize: 11, fontFamily: FONTS.bold, color: PURPLE },
});
