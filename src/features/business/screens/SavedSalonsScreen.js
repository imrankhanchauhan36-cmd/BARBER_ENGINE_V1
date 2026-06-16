import React, { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, StatusBar, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";

const PURPLE = "#5C35E8";

const DUMMY_SALONS = [
  {
    id: "1", name: "The Glam House", discount: "20% OFF",
    categories: "Hair • Beauty • Makeup",
    city: "Koramangala, Bengaluru", distance: "2.3 km",
    rating: 4.7, reviews: "1.2k", isOpen: true, closingTime: "10:00 PM",
    image: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=400",
    tab: "recently",
  },
  {
    id: "2", name: "Looks & Layers Salon", discount: "15% OFF",
    categories: "Hair • Beauty • Nails",
    city: "Indiranagar, Bengaluru", distance: "3.1 km",
    rating: 4.6, reviews: "890", isOpen: true, closingTime: "9:30 PM",
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400",
    tab: "recently",
  },
  {
    id: "3", name: "The Luxe Studio", discount: "25% OFF",
    categories: "Hair • Beauty • Spa",
    city: "HSR Layout, Bengaluru", distance: "4.4 km",
    rating: 4.8, reviews: "1.5k", isOpen: true, closingTime: "10:00 PM",
    image: "https://images.unsplash.com/photo-1633681926022-84c23e8cb2d6?w=400",
    tab: "visited",
  },
  {
    id: "4", name: "Style Square Salon", discount: "10% OFF",
    categories: "Hair • Beauty • Makeup",
    city: "JP Nagar, Bengaluru", distance: "4.8 km",
    rating: 4.5, reviews: "670", isOpen: true, closingTime: "9:00 PM",
    image: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=400",
    tab: "offers",
  },
];

const TABS = [
  { key: "all",      label: "All",           count: 8 },
  { key: "recently", label: "Recently Added", count: 4 },
  { key: "visited",  label: "Visited",        count: 3 },
  { key: "offers",   label: "Offers",         count: 2 },
];

function SalonCard({ item, onRemove, onPress, onBook }) {
  return (
    <View style={styles.card}>
      {/* Image */}
      <View style={styles.cardImgBox}>
        <Image source={{ uri: item.image }} style={styles.cardImg} resizeMode="cover" />
        {item.discount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>{item.discount}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <TouchableOpacity style={styles.cardInfo} onPress={onPress} activeOpacity={0.8}>
        <View style={styles.cardInfoTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.salonName}>{item.name}</Text>
              <Ionicons name="checkmark-circle" size={14} color={PURPLE} />
            </View>
            <Text style={styles.categories}>{item.categories}</Text>
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={11} color={COLORS.text.secondary} />
              <Text style={styles.metaText}>{item.city}</Text>
            </View>
            <View style={styles.metaRow}>
              <Ionicons name="star" size={11} color="#F59E0B" />
              <Text style={styles.ratingText}>{item.rating} ({item.reviews})</Text>
              <View style={styles.dot} />
              <Text style={styles.distanceText}>{item.distance}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={[styles.openText, { color: item.isOpen ? "#16A34A" : "#EF4444" }]}>
                {item.isOpen ? "Open" : "Closed"}
              </Text>
              <Text style={styles.metaText}>• Closes {item.closingTime}</Text>
            </View>
          </View>

          {/* Right actions */}
          <View style={styles.cardActions}>
            <TouchableOpacity onPress={onRemove} style={styles.heartBtn}>
              <Ionicons name="heart" size={20} color={PURPLE} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.moreBtn}>
              <Ionicons name="ellipsis-vertical" size={18} color={COLORS.text.secondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Book Now */}
        <TouchableOpacity style={styles.bookBtn} onPress={onBook}>
          <Text style={styles.bookBtnText}>Book Now</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );
}

export default function SavedSalonsScreen({ navigation }) {
  const [salons,    setSalons]    = useState(DUMMY_SALONS);
  const [activeTab, setActiveTab] = useState("all");
  const [isEditing, setIsEditing] = useState(false);

  const filtered = activeTab === "all"
    ? salons
    : salons.filter(s => s.tab === activeTab);

  const removeSalon = (id) => {
    Alert.alert("Remove Salon", "Remove from saved salons?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setSalons(prev => prev.filter(s => s.id !== id)) },
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Saved Salons</Text>
          <Text style={styles.headerSub}>Your favorite salons, saved for you</Text>
        </View>
        <TouchableOpacity style={styles.editBtn} onPress={() => setIsEditing(!isEditing)}>
          <Ionicons name="pencil-outline" size={14} color={PURPLE} />
          <Text style={styles.editBtnText}>{isEditing ? "Done" : "Edit"}</Text>
        </TouchableOpacity>
      </View>

      {/* TABS */}
      <View style={styles.tabsRow}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label} ({tab.count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingBottom: 100, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          /* INFO BANNER */
          <View style={styles.infoBanner}>
            <View style={styles.infoBannerLeft}>
              <View style={styles.infoIcon}>
                <Ionicons name="heart" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoBannerTitle}>Your Favorites, Always with You</Text>
                <Text style={styles.infoBannerSub}>Book your favorite salons faster and get updates on offers & availability.</Text>
              </View>
            </View>
            <Ionicons name="storefront-outline" size={48} color="#DDD6FE" style={{ marginLeft: 8 }} />
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyBox}>
            <Ionicons name="heart-dislike-outline" size={56} color={COLORS.border} />
            <Text style={styles.emptyTitle}>No Saved Salons</Text>
            <Text style={styles.emptySub}>Tap the heart icon on any salon to save it here.</Text>
            <TouchableOpacity style={styles.exploreBtn} onPress={() => navigation.navigate(ROUTES.MAIN_TABS)}>
              <Text style={styles.exploreBtnText}>Explore Salons</Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={() => filtered.length > 0 ? (
          /* NOTIFICATION BANNER */
          <View style={styles.notifBanner}>
            <View style={styles.notifLeft}>
              <View style={styles.notifIcon}>
                <Ionicons name="notifications-outline" size={20} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifTitle}>Stay Updated</Text>
                <Text style={styles.notifSub}>Get notifications about offers, new services and availability of your saved salons.</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.notifBtn}>
              <Text style={styles.notifBtnText}>Enable Notifications</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        renderItem={({ item }) => (
          <SalonCard
            item={item}
            onRemove={() => removeSalon(item.id)}
            onPress={() => navigation.navigate(ROUTES.SALON_DETAIL, { salonId: item.id, salon: item })}
            onBook={() => navigation.navigate(ROUTES.SERVICE_SELECTION, { salonId: item.id, salon: item })}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#F8F8FF",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },

  // Header
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary },
  headerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  editBtn: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  editBtnText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Tabs
  tabsRow: {
    flexDirection: "row",
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
    paddingHorizontal: 16,
  },
  tab: { paddingVertical: 12, marginRight: 20 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: PURPLE },
  tabText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  tabTextActive: { fontFamily: FONTS.bold, color: PURPLE },

  // Info banner
  infoBanner: {
    flexDirection: "row", alignItems: "center",
    margin: 16, padding: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  infoBannerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  infoIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },
  infoBannerTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 4 },
  infoBannerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, lineHeight: 16 },

  // Card
  card: {
    flexDirection: "row",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border, overflow: "hidden",
  },
  cardImgBox: { position: "relative" },
  cardImg: { width: 110, height: "100%", minHeight: 140 },
  discountBadge: {
    position: "absolute", top: 8, left: 8,
    backgroundColor: "#1a1a1a", borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  discountText: { fontSize: 10, fontFamily: FONTS.bold, color: "#fff" },

  cardInfo: { flex: 1, padding: 12 },
  cardInfoTop: { flexDirection: "row", marginBottom: 10 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  salonName: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  categories: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginBottom: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  metaText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  ratingText: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.text.secondary },
  distanceText: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  openText: { fontSize: 11, fontFamily: FONTS.bold },

  cardActions: { alignItems: "center", gap: 8 },
  heartBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  moreBtn: { padding: 4 },

  bookBtn: {
    borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.md,
    paddingVertical: 8, alignItems: "center",
  },
  bookBtnText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Empty
  emptyBox: { alignItems: "center", paddingTop: 60, gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary },
  emptySub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center" },
  exploreBtn: {
    marginTop: 8, backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 28, paddingVertical: 12,
  },
  exploreBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },

  // Notification banner
  notifBanner: {
    margin: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  notifLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  notifIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  notifTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  notifSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2, lineHeight: 16 },
  notifBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingVertical: 12, alignItems: "center",
  },
  notifBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
});
