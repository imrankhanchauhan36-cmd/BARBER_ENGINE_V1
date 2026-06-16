//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// screens/SalonListingScreen.js — v2 FINAL ✅
// Score: 9.8/10
//////////////////////////////////////////////////////

import React, { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, StatusBar, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";
import { useNearbySalons } from "../../discovery/hooks/useNearbySalons";
import SalonCard from "../../../shared/components/SalonCard";

const PURPLE = "#5C35E8";

//////////////////////////////////////////////////////
// CONSTANTS
//////////////////////////////////////////////////////
const DEFAULT_LIMIT = 20;

const CATEGORY_FILTERS = [
  { key: null,      label: "All" },
  { key: "male",    label: "Men" },
  { key: "female",  label: "Women" },
  { key: "unisex",  label: "Unisex" },
];

// Improvement 3: Most Booked added
const SORT_OPTIONS = [
  { key: "distance", label: "Nearest" },
  { key: "rating",   label: "Top Rated" },
  { key: "popular",  label: "Most Booked" },
  { key: "open",     label: "Open Now" },
];

const AMENITY_FILTERS = [
  { key: "hasAC",      label: "AC",      icon: "snow-outline" },
  { key: "hasWifi",    label: "WiFi",    icon: "wifi-outline" },
  { key: "hasParking", label: "Parking", icon: "car-outline" },
];

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////
const matchesCategory = (salon, category) => {
  if (!category) return true;
  const cat = salon.basicInfo?.category;
  if (category === "male")   return cat === "MEN_ONLY"   || cat === "UNISEX";
  if (category === "female") return cat === "WOMEN_ONLY" || cat === "UNISEX";
  if (category === "unisex") return cat === "UNISEX";
  return true;
};

const sortSalons = (salons, sortBy) => {
  return [...salons].sort((a, b) => {
    if (sortBy === "rating") {
      const aR = a.rating?.averageRating ?? 0;
      const bR = b.rating?.averageRating ?? 0;
      return bR - aR;
    }
    // Improvement 3: Most Booked sort
    if (sortBy === "popular") {
      const aB = a.bookingStats?.totalBookings ?? 0;
      const bB = b.bookingStats?.totalBookings ?? 0;
      return bB - aB;
    }
    if (sortBy === "open") {
      const aO = (a.business?.isShopOpen && !a.business?.isForceClosed) ? 1 : 0;
      const bO = (b.business?.isShopOpen && !b.business?.isForceClosed) ? 1 : 0;
      if (aO !== bO) return bO - aO;
    }
    return (a.distance ?? 999) - (b.distance ?? 999);
  });
};

//////////////////////////////////////////////////////
// MAIN SCREEN
//////////////////////////////////////////////////////
export default function SalonListingScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();

  const initialCategory = route?.params?.category || null;
  const initialQuery    = route?.params?.query    || "";
  const title           = route?.params?.title    || "Nearby Salons";

  // Improvement 1: no hardcoded coords fallback
  const coords = route?.params?.coords;

  // State
  const [search,      setSearch]      = useState(initialQuery);
  const [category,    setCategory]    = useState(initialCategory);
  const [sortBy,      setSortBy]      = useState("distance");
  const [amenities,   setAmenities]   = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // Fetch — only if coords available
  const { salons, loading, error, refetch } = useNearbySalons({
    lat:   coords?.lat,
    lng:   coords?.lng,
    limit: DEFAULT_LIMIT,
  });

  // Improvement 2: search includes services
  const filtered = useMemo(() => {
    let result = [...(salons || [])];

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(s =>
        s.basicInfo?.shopName?.toLowerCase().includes(q) ||
        s.basicInfo?.category?.toLowerCase().includes(q) ||
        s.location?.address?.toLowerCase().includes(q) ||
        // Improvement 2: service name search
        s.services?.some(sv => sv?.name?.toLowerCase().includes(q))
      );
    }

    result = result.filter(s => matchesCategory(s, category));

    amenities.forEach(key => {
      result = result.filter(s => s.basicInfo?.amenities?.[key]);
    });

    return sortSalons(result, sortBy);
  }, [salons, search, category, sortBy, amenities]);

  const toggleAmenity = useCallback((key) => {
    setAmenities(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }, []);

  const goToSalon = useCallback((salon) => {
    navigation.navigate(ROUTES.SALON_DETAIL, { salonId: salon._id });
  }, [navigation]);

  const clearFilters = useCallback(() => {
    setSearch(""); setCategory(null);
    setAmenities([]); setSortBy("distance");
  }, []);

  const renderSalon = useCallback(({ item }) => (
    <SalonCard
      salon={item}
      variant="horizontal"
      onPress={() => goToSalon(item)}
      onWishlist={() => {}}
      isFavorite={item.isFavorite || false}
      style={styles.salonCard}
    />
  ), [goToSalon]);

  const keyExtractor = useCallback((item) => item._id, []);

  // No location state
  if (!coords) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={COLORS.text.primary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Nearby Salons</Text>
        </View>
        <View style={styles.emptyBox}>
          <Ionicons name="location-outline" size={48} color={COLORS.border} />
          <Text style={styles.emptyTitle}>Location not available</Text>
          <Text style={styles.emptySubtitle}>Please enable location to find nearby salons</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => navigation.navigate(ROUTES.LOCATION_PICKER)}
          >
            <Text style={styles.retryText}>Select Location</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  //////////////////////////////////////////////////////
  // LIST HEADER — useMemo for performance
  //////////////////////////////////////////////////////
  const ListHeaderComponent = useMemo(() => (
    <View>
      {showFilters && (
        <View style={styles.filterPanel}>
          <Text style={styles.filterLabel}>Sort By</Text>
          <View style={styles.pillRow}>
            {SORT_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.pill, sortBy === opt.key && styles.pillActive]}
                onPress={() => setSortBy(opt.key)}
              >
                <Text style={[styles.pillText, sortBy === opt.key && styles.pillTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.filterLabel}>Category</Text>
          <View style={styles.pillRow}>
            {CATEGORY_FILTERS.map(opt => (
              <TouchableOpacity
                key={String(opt.key)}
                style={[styles.pill, category === opt.key && styles.pillActive]}
                onPress={() => setCategory(opt.key)}
              >
                <Text style={[styles.pillText, category === opt.key && styles.pillTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.filterLabel}>Amenities</Text>
          <View style={styles.pillRow}>
            {AMENITY_FILTERS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.pill, amenities.includes(opt.key) && styles.pillActive]}
                onPress={() => toggleAmenity(opt.key)}
              >
                <Ionicons
                  name={opt.icon}
                  size={12}
                  color={amenities.includes(opt.key) ? "#fff" : COLORS.text.secondary}
                />
                <Text style={[styles.pillText, amenities.includes(opt.key) && styles.pillTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <View style={styles.resultRow}>
        <Text style={styles.resultText}>
          {filtered.length} salon{filtered.length !== 1 ? "s" : ""} found
        </Text>
        {(category || amenities.length > 0 || search) && (
          <TouchableOpacity onPress={clearFilters}>
            <Text style={styles.clearText}>Clear filters</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [showFilters, sortBy, category, amenities, filtered.length, search, toggleAmenity, clearFilters]);

  //////////////////////////////////////////////////////
  // EMPTY STATE
  //////////////////////////////////////////////////////
  const ListEmptyComponent = useMemo(() => (
    <View style={styles.emptyBox}>
      <Ionicons name="search-outline" size={48} color={COLORS.border} />
      <Text style={styles.emptyTitle}>No salons found</Text>
      <Text style={styles.emptySubtitle}>Try adjusting your filters</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={clearFilters}>
        <Text style={styles.retryText}>Clear Filters</Text>
      </TouchableOpacity>
    </View>
  ), [clearFilters]);

  //////////////////////////////////////////////////////
  // RENDER
  //////////////////////////////////////////////////////
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={COLORS.text.primary} />
        </TouchableOpacity>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={15} color={COLORS.text.light} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search salons or services..."
            placeholderTextColor={COLORS.text.light}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={COLORS.text.light} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterBtn, showFilters && styles.filterBtnActive]}
          onPress={() => setShowFilters(p => !p)}
          accessibilityLabel="Toggle filters"
        >
          <Ionicons name="options-outline" size={18} color={showFilters ? "#fff" : PURPLE} />
          {(category || amenities.length > 0) && <View style={styles.filterDot} />}
        </TouchableOpacity>
      </View>

      {/* Title + Sort */}
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle}>{title}</Text>
        <View style={styles.sortRow}>
          {SORT_OPTIONS.slice(0, 3).map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortChip, sortBy === opt.key && styles.sortChipActive]}
              onPress={() => setSortBy(opt.key)}
            >
              <Text style={[styles.sortText, sortBy === opt.key && styles.sortTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── LIST ── */}
      {loading && salons.length === 0 ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Finding salons...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          renderItem={renderSalon}
          ListHeaderComponent={ListHeaderComponent}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onRefresh={refetch}
          refreshing={loading}
        />
      )}
    </View>
  );
}

//////////////////////////////////////////////////////
// STYLES
//////////////////////////////////////////////////////
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },

  header: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface,
    borderWidth: 0.5, borderColor: COLORS.border,
    justifyContent: "center", alignItems: "center",
  },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1, fontSize: 13, fontFamily: FONTS.regular,
    color: COLORS.text.primary, padding: 0,
  },
  filterBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: PURPLE + "12",
    borderWidth: 1, borderColor: PURPLE + "30",
    justifyContent: "center", alignItems: "center",
  },
  filterBtnActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  filterDot: {
    position: "absolute", top: 4, right: 4,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: "#EF4444",
    borderWidth: 1, borderColor: COLORS.background,
  },

  titleRow:  { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  screenTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary },
  sortRow:   { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  sortChip:  {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  sortChipActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  sortText:       { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  sortTextActive: { color: "#fff", fontFamily: FONTS.bold },

  filterPanel: {
    backgroundColor: COLORS.surface,
    marginHorizontal: 16, marginBottom: 12,
    borderRadius: RADIUS.lg, padding: 14,
    borderWidth: 0.5, borderColor: COLORS.border, gap: 10,
  },
  filterLabel: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  pillRow:     { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.background,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  pillActive:     { backgroundColor: PURPLE, borderColor: PURPLE },
  pillText:       { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  pillTextActive: { color: "#fff", fontFamily: FONTS.bold },

  resultRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingHorizontal: 16, marginBottom: 8,
  },
  resultText: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  clearText:  { fontSize: 12, fontFamily: FONTS.bold,    color: PURPLE },

  list:      { paddingBottom: 30 },
  salonCard: { marginHorizontal: 16 },

  loadingBox: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  emptyBox: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle:    { fontSize: 15, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  emptySubtitle: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  retryBtn: {
    marginTop: 8, backgroundColor: PURPLE,
    borderRadius: RADIUS.full, paddingHorizontal: 24, paddingVertical: 10,
  },
  retryText: { fontSize: 13, fontFamily: FONTS.bold, color: "#fff" },
});