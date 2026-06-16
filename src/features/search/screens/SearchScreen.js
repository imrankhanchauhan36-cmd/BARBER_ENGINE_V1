import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  Platform, ScrollView, TextInput, Image, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";
import apiClient from "../../../shared/api/client";

const PURPLE = "#5C35E8";

const POPULAR = [
  { label: "Haircut",    icon: "cut-outline" },
  { label: "Hair Spa",   icon: "water-outline" },
  { label: "Facial",     icon: "happy-outline" },
  { label: "Beard Trim", icon: "man-outline" },
  { label: "Manicure",   icon: "hand-left-outline" },
  { label: "Pedicure",   icon: "footsteps-outline" },
];

const CATEGORIES = [
  { label: "Hair",          icon: "cut-outline" },
  { label: "Beauty",        icon: "sparkles-outline" },
  { label: "Makeup",        icon: "color-palette-outline" },
  { label: "Nails",         icon: "hand-right-outline" },
  { label: "Skin Care",     icon: "leaf-outline" },
  { label: "Spa & Massage", icon: "flower-outline" },
];

const FILTERS = ["Near Me", "Top Rated", "Offers", "Open Now"];

const DUMMY_SALONS = [
  {
    _id: "1", name: "The Glam House",
    image: "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=400",
    city: "Koramangala, Bengaluru", distance: "1.2 km",
    rating: 4.8, reviews: "1.2K", discount: "20% OFF",
    startingFrom: 299, isOpen: true, closingTime: "9:00 PM",
    categories: ["Hair", "Beauty", "Makeup"],
  },
  {
    _id: "2", name: "Looks & Layers Salon",
    image: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400",
    city: "HSR Layout, Bengaluru", distance: "2.1 km",
    rating: 4.7, reviews: "980", discount: "15% OFF",
    startingFrom: 249, isOpen: true, closingTime: "10:00 PM",
    categories: ["Hair", "Beauty", "Nails"],
  },
  {
    _id: "3", name: "The Luxe Studio",
    image: "https://images.unsplash.com/photo-1633681926022-84c23e8cb2d6?w=400",
    city: "Indiranagar, Bengaluru", distance: "2.8 km",
    rating: 4.9, reviews: "1.5K", discount: "10% OFF",
    startingFrom: 399, isOpen: true, closingTime: "9:30 PM",
    categories: ["Hair", "Beauty", "Spa"],
  },
];

function SalonCard({ salon, onPress }) {
  return (
    <TouchableOpacity style={styles.salonCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.salonImgBox}>
        <Image source={{ uri: salon.image }} style={styles.salonImg} resizeMode="cover" />
        {salon.discount && (
          <View style={styles.discountBadge}>
            <Text style={styles.discountText}>{salon.discount}</Text>
          </View>
        )}
      </View>
      <View style={styles.salonInfo}>
        <View style={styles.salonTopRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.salonNameRow}>
              <Text style={styles.salonName}>{salon.name}</Text>
              <Ionicons name="checkmark-circle" size={14} color={PURPLE} />
            </View>
            <Text style={styles.salonCity}>{salon.city} • {salon.distance}</Text>
            <View style={styles.salonMetaRow}>
              <Ionicons name="star" size={12} color="#F59E0B" />
              <Text style={styles.salonRating}>{salon.rating} ({salon.reviews})</Text>
              <View style={styles.dot} />
              <Text style={[styles.salonOpen, { color: salon.isOpen ? "#16A34A" : "#EF4444" }]}>
                {salon.isOpen ? "Open" : "Closed"}
              </Text>
              <Text style={styles.salonClose}>• Closes {salon.closingTime}</Text>
            </View>
          </View>
          <View style={styles.salonRight}>
            <TouchableOpacity style={styles.heartBtn}>
              <Ionicons name="heart-outline" size={18} color={COLORS.text.secondary} />
            </TouchableOpacity>
            <Text style={styles.startingFrom}>Starting from</Text>
            <Text style={styles.salonPrice}>₹{salon.startingFrom}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.viewServicesBtn} onPress={onPress}>
          <Text style={styles.viewServicesBtnText}>View Services</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen({ navigation }) {
  const [query,          setQuery]          = useState("");
  const [salons,         setSalons]         = useState(DUMMY_SALONS);
  const [recentSearches, setRecentSearches] = useState(["Haircut near me", "Facial", "Hair Spa", "Beard Trim"]);
  const [activeFilter,   setActiveFilter]   = useState("Near Me");
  const [isSearching,    setIsSearching]    = useState(false);

  const fetchSalons = useCallback(async (q = "") => {
    try {
      const res = await apiClient.get("/api/discovery/salons", { params: { search: q, limit: 10 } });
      if (res?.data?.success && res.data.salons?.length > 0) {
        setSalons(res.data.salons);
      } else {
        setSalons(DUMMY_SALONS);
      }
    } catch {
      setSalons(DUMMY_SALONS);
    }
  }, []);

  useEffect(() => { fetchSalons(); }, []);

  const handleSearch = (text) => {
    setQuery(text);
    if (text.length > 2) {
      setIsSearching(true);
      fetchSalons(text);
    } else if (text.length === 0) {
      setIsSearching(false);
      fetchSalons();
    }
  };

  const handleSearchSubmit = () => {
    if (query.trim()) {
      setRecentSearches(prev => [query, ...prev.filter(r => r !== query)].slice(0, 5));
      setIsSearching(true);
      fetchSalons(query);
    }
  };

  const removeRecent = (item) => setRecentSearches(prev => prev.filter(r => r !== item));
  const clearAll = () => setRecentSearches([]);

  const goToSalon = (salon) => {
    navigation.navigate(ROUTES.SALON_DETAIL, {
      salonId: salon._id,
      salon,
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Search</Text>
          <Text style={styles.headerSub}>Find the best salons & services near you</Text>
        </View>
        <TouchableOpacity style={styles.locationBtn}>
          <Ionicons name="location-outline" size={14} color={PURPLE} />
          <Text style={styles.locationText}>Koramangala, Bengaluru</Text>
          <Ionicons name="chevron-down" size={14} color={PURPLE} />
        </TouchableOpacity>
      </View>

      {/* SEARCH BAR */}
      <View style={styles.searchBarBox}>
        <Ionicons name="search-outline" size={18} color={COLORS.text.secondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for salons, services, style..."
          placeholderTextColor={COLORS.text.secondary}
          value={query}
          onChangeText={handleSearch}
          onSubmitEditing={handleSearchSubmit}
          returnKeyType="search"
        />
        <TouchableOpacity>
          <Ionicons name="mic-outline" size={20} color={PURPLE} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* POPULAR SEARCHES */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Popular Searches</Text>
          <TouchableOpacity><Text style={styles.viewAll}>View All</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
          {POPULAR.map((item, i) => (
            <TouchableOpacity key={i} style={styles.popularChip}
              onPress={() => { setQuery(item.label); handleSearch(item.label); }}>
              <Ionicons name={item.icon} size={14} color={PURPLE} />
              <Text style={styles.popularChipText}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* CATEGORIES */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Browse by Categories</Text>
          <TouchableOpacity><Text style={styles.viewAll}>View All</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {CATEGORIES.map((cat, i) => (
            <TouchableOpacity key={i} style={styles.categoryItem}
              onPress={() => { setQuery(cat.label); handleSearch(cat.label); }}>
              <View style={styles.categoryIcon}>
                <Ionicons name={cat.icon} size={22} color={PURPLE} />
              </View>
              <Text style={styles.categoryLabel}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* NEARBY SALONS */}
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Nearby Salons</Text>
        </View>

        {/* FILTER CHIPS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
              onPress={() => setActiveFilter(f)}
            >
              {f === "Near Me" && <Ionicons name="location-outline" size={13} color={activeFilter === f ? "#fff" : COLORS.text.secondary} />}
              {f === "Top Rated" && <Ionicons name="star-outline" size={13} color={activeFilter === f ? "#fff" : COLORS.text.secondary} />}
              {f === "Offers" && <Ionicons name="pricetag-outline" size={13} color={activeFilter === f ? "#fff" : COLORS.text.secondary} />}
              {f === "Open Now" && <Ionicons name="time-outline" size={13} color={activeFilter === f ? "#fff" : COLORS.text.secondary} />}
              <Text style={[styles.filterChipText, activeFilter === f && styles.filterChipTextActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.filterBtn}>
            <Ionicons name="filter-outline" size={14} color={PURPLE} />
            <Text style={styles.filterBtnText}>Filter</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* SALON CARDS */}
        {salons.map(salon => (
          <SalonCard key={salon._id} salon={salon} onPress={() => goToSalon(salon)} />
        ))}

        {/* OFFERS BANNER */}
        <View style={styles.offerBanner}>
          <View style={styles.offerLeft}>
            <View style={styles.offerIcon}>
              <Text style={{ fontSize: 28 }}>🏷️</Text>
            </View>
            <View>
              <Text style={styles.offerTitle}>Exclusive Offers Await!</Text>
              <Text style={styles.offerSub}>Explore top salons with amazing discounts</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.viewOffersBtn}>
            <Text style={styles.viewOffersBtnText}>View Offers</Text>
          </TouchableOpacity>
        </View>

        {/* RECENT SEARCHES */}
        {recentSearches.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Recent Searches</Text>
              <TouchableOpacity onPress={clearAll}>
                <Text style={styles.viewAll}>Clear All</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.recentRow}>
              {recentSearches.map((item, i) => (
                <View key={i} style={styles.recentChip}>
                  <Ionicons name="time-outline" size={13} color={COLORS.text.secondary} />
                  <Text style={styles.recentChipText}>{item}</Text>
                  <TouchableOpacity onPress={() => removeRecent(item)}>
                    <Ionicons name="close" size={14} color={COLORS.text.secondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },

  // Header
  header: {
    flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between",
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
  },
  headerTitle: { fontSize: 26, fontFamily: FONTS.bold, color: COLORS.text.primary },
  headerSub:   { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  locationBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  locationText: { fontSize: 12, fontFamily: FONTS.bold, color: PURPLE },

  // Search bar
  searchBarBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: FONTS.regular, color: COLORS.text.primary },

  // Section
  sectionHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, marginBottom: 12, marginTop: 4,
  },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary },
  viewAll: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Popular
  popularRow: { paddingHorizontal: 16, gap: 8, marginBottom: 20 },
  popularChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  popularChipText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },

  // Categories
  categoriesRow: { paddingHorizontal: 16, gap: 16, marginBottom: 20 },
  categoryItem: { alignItems: "center", gap: 8 },
  categoryIcon: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  categoryLabel: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.primary, textAlign: "center" },

  // Filters
  filterRow: { paddingHorizontal: 16, gap: 8, marginBottom: 16, alignItems: "center" },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  filterChipActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  filterChipText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  filterChipTextActive: { color: "#fff", fontFamily: FONTS.bold },
  filterBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  filterBtnText: { fontSize: 13, fontFamily: FONTS.medium, color: PURPLE },

  // Salon card
  salonCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border, overflow: "hidden",
  },
  salonImgBox: { position: "relative" },
  salonImg: { width: "100%", height: 160 },
  discountBadge: {
    position: "absolute", top: 10, left: 10,
    backgroundColor: PURPLE, borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  discountText: { fontSize: 11, fontFamily: FONTS.bold, color: "#fff" },
  salonInfo: { padding: 14 },
  salonTopRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 12 },
  salonNameRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  salonName: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary },
  salonCity: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginBottom: 4 },
  salonMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  salonRating: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: COLORS.text.secondary },
  salonOpen: { fontSize: 12, fontFamily: FONTS.bold },
  salonClose: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  salonRight: { alignItems: "flex-end", gap: 4 },
  heartBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border, marginBottom: 4,
  },
  startingFrom: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  salonPrice: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary },
  viewServicesBtn: {
    alignItems: "center", paddingVertical: 10,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
  },
  viewServicesBtnText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Offers banner
  offerBanner: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#DDD6FE", gap: 10,
  },
  offerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  offerIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  offerTitle: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  offerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  viewOffersBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  viewOffersBtnText: { fontSize: 12, fontFamily: FONTS.bold, color: "#fff" },

  // Recent searches
  recentRow: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 16, gap: 8, marginBottom: 16 },
  recentChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  recentChipText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.primary },
});
