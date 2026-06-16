import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FONTS, COLORS, RADIUS } from "../../../../config/theme";

const PURPLE = "#5C35E8";

// Dummy fallback data by service name keyword
const DUMMY_DATA = {
  haircut: {
    image: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=400",
    desc: "Includes wash, cut & style",
    badge: "Expert Stylist",
  },
  hair: {
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400",
    desc: "Professional hair treatment",
    badge: "Expert Stylist",
  },
  beard: {
    image: "https://images.unsplash.com/photo-1621605815971-ab890d2b52e2?w=400",
    desc: "Beard shaping & finishing",
    badge: "Perfect Beard Shape",
  },
  facial: {
    image: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400",
    desc: "Deep cleansing & glow",
    badge: "Glowing Skin",
  },
  spa: {
    image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=400",
    desc: "Relaxing head & scalp spa",
    badge: "Deep Nourishment",
  },
  massage: {
    image: "https://images.unsplash.com/photo-1600334129128-685c5582fd35?w=400",
    desc: "Full body relaxation massage",
    badge: "Top Rated",
  },
  default: {
    image: null,
    desc: "Premium salon service",
    badge: "Expert Stylist",
  },
};

const getDummy = (name = "") => {
  const lower = name.toLowerCase();
  for (const key of Object.keys(DUMMY_DATA)) {
    if (lower.includes(key)) return DUMMY_DATA[key];
  }
  return DUMMY_DATA.default;
};

export default function CartItem({ item, index, onRemove }) {
  const dummy   = getDummy(item.name);
  const imgUri  = item.thumbnailImage || item.imageUrl || item.image || dummy.image;
  const desc    = item.description || dummy.desc;
  const badge   = item.badge || dummy.badge;

  return (
    <View style={styles.card}>
      {/* Image */}
      <View style={styles.imgBox}>
        {imgUri ? (
          <Image source={{ uri: imgUri }} style={styles.img} resizeMode="cover" />
        ) : (
          <View style={[styles.img, styles.imgFallback]}>
            <Ionicons name="cut-outline" size={28} color={PURPLE} />
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name?.charAt(0).toUpperCase() + item.name?.slice(1)}
        </Text>
        <Text style={styles.desc} numberOfLines={1}>{desc}</Text>
        <View style={styles.badge}>
          <Ionicons name="checkmark-circle" size={13} color="#16A34A" />
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      </View>

      {/* Price + Duration + Remove */}
      <View style={styles.right}>
        <Text style={styles.price}>₹{item.price}</Text>
        <Text style={styles.duration}>{item.duration} mins</Text>
        <TouchableOpacity style={styles.removeBtn} onPress={() => onRemove(item)}>
          <Ionicons name="close" size={15} color={COLORS.text.secondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 12,
    marginBottom: 10,
    gap: 12,
    borderWidth: 0.5,
    borderColor: COLORS.border,
  },
  imgBox: {
    width: 80, height: 80,
    borderRadius: RADIUS.md,
    overflow: "hidden",
  },
  img: { width: "100%", height: "100%" },
  imgFallback: {
    backgroundColor: "#F5F3FF",
    justifyContent: "center", alignItems: "center",
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  desc: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  badgeText: { fontSize: 11, fontFamily: FONTS.medium, color: "#16A34A" },
  right: { alignItems: "flex-end", gap: 6 },
  price: { fontSize: 16, fontFamily: FONTS.bold, color: PURPLE },
  duration: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  removeBtn: {
    width: 30, height: 30, borderRadius: 8,
    borderWidth: 1, borderColor: COLORS.border,
    justifyContent: "center", alignItems: "center",
  },
});
