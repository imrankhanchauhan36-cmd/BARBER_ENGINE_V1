//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// screens/HomeScreen.js — v6 FINAL ✅
// useUpcomingBooking hook connected
//////////////////////////////////////////////////////

import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, ActivityIndicator, RefreshControl, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { useAuth }             from "../../auth/hooks/useAuth";
import { useNearbySalons }     from "../../discovery/hooks/useNearbySalons";
import useUpcomingBooking      from "../hooks/useUpcomingBooking";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";
import { ROUTES }              from "../../../app/routes/routeNames";

import HomeHeader              from "../components/HomeHeader";
import HomeHeroBanner          from "../components/HomeHeroBanner";
import HomeCategories          from "../components/HomeCategories";
import HomeAvailableNow        from "../components/HomeAvailableNow";
import HomeUpcomingAppointment from "../components/HomeUpcomingAppointment";
import HomeNearbySalons        from "../components/HomeNearbySalons";
import HomeTrendingServices    from "../components/HomeTrendingServices";
import HomeRecentlyViewed      from "../components/HomeRecentlyViewed";
import HomePrivilegeBanner     from "../components/HomePrivilegeBanner";

export default function HomeScreen({ navigation }) {
  const { user } = useAuth();

  const [activeCategory,  setActiveCategory]  = useState(null);
  const [locationName,    setLocationName]    = useState("Detecting...");
  const [locationGranted, setLocationGranted] = useState(null);
  const [coords,          setCoords]          = useState({ lat: 28.0073, lng: 77.7482 });
  const [gender,          setGender]          = useState("male");
  const [recentlyViewed,  setRecentlyViewed]  = useState([]);

  // ── Upcoming booking hook ─────────────────────────────
  const { booking: upcomingBooking, refetch: refetchBooking } = useUpcomingBooking();

  // ── Location ──────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          setLocationGranted(false);
          setLocationName("Select Location");
          return;
        }
        setLocationGranted(true);
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setCoords({ lat: latitude, lng: longitude });
        const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
        if (place) {
          const raw = [place.subregion || place.city, place.region].filter(Boolean).join(", ");
          setLocationName(raw
            .replace(/\s*(Division|District|Tehsil|Taluka)\s*/gi, "")
            .replace(/,\s*,/g, ",")
            .trim() || "Your location");
        }
      } catch {
        setLocationGranted(false);
        setLocationName("Select Location");
      }
    })();
  }, []);

  // ── Fetch user profile ───────────────────────────────
  const { setUser } = useAuth();
  React.useEffect(() => {
    (async () => {
      try {
        const apiClient    = require('../../../shared/api/client').default;
        const AsyncStorage = require('@react-native-async-storage/async-storage').default;
        const res = await apiClient.get('/api/user/me');
        if (res?.data?.success && res.data.user) {
          const u = res.data.user;
          if (u.name)  await AsyncStorage.setItem('USER_NAME',  u.name);
          if (u.phone) await AsyncStorage.setItem('USER_PHONE', u.phone);
          setUser(prev => ({ ...prev, name: u.name || prev?.name, phone: u.phone || prev?.phone }));
        }
      } catch {}
    })();
  }, []);

  // ── Nearby salons ─────────────────────────────────────
  const { salons, loading, error, refetch } = useNearbySalons({
    lat: coords.lat, lng: coords.lng, limit: 20,
  });

  // ── Combined refresh ──────────────────────────────────
  const handleRefresh = useCallback(() => {
    refetch();
    refetchBooking();
  }, [refetch, refetchBooking]);

  // ── Filter: gender/category + sort ───────────────────
  const filtered = React.useMemo(() => {
    return salons
      .filter((s) => {
        const salonCat = s.basicInfo?.category;
        const matchGender =
          gender === "male"   ? (salonCat === "MEN_ONLY"   || salonCat === "UNISEX") :
          gender === "female" ? (salonCat === "WOMEN_ONLY" || salonCat === "UNISEX") :
          gender === "unisex" ? (salonCat === "UNISEX") :
          true;
        return matchGender;
      })
      .sort((a, b) => {
        const aAvail = (a.business?.isShopOpen && !a.business?.isForceClosed) ? 1 : 0;
        const bAvail = (b.business?.isShopOpen && !b.business?.isForceClosed) ? 1 : 0;
        if (aAvail !== bAvail) return bAvail - aAvail;
        return (a.distance || 999) - (b.distance || 999);
      });
  }, [salons, gender]);

  const salonCount     = filtered.length;
  const availableCount = filtered.filter(
    s => s.business?.isShopOpen && !s.business?.isForceClosed
  ).length;

  // ── Handlers ──────────────────────────────────────────
  const goToSalon = useCallback((salon) => {
    navigation.navigate(ROUTES.SALON_DETAIL, { salonId: salon._id });
    setRecentlyViewed((prev) => {
      if (prev.find((s) => s._id === salon._id)) return prev;
      return [salon, ...prev].slice(0, 6);
    });
  }, [navigation]);

  const goToBooking = useCallback((salon) => {
    navigation.navigate(ROUTES.SLOT_SELECTION, { salonId: salon._id });
  }, [navigation]);

  // ── Error state ────────────────────────────────────────
  if (error && salons.length === 0) {
    return (
      <View style={styles.centerBox}>
        <Ionicons name="cloud-offline-outline" size={48} color={COLORS.border} />
        <Text style={styles.centerTitle}>Could not load salons</Text>
        <Text style={styles.centerText}>Check your internet connection</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={refetch}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Loading state ──────────────────────────────────────
  if (loading && salons.length === 0) {
    return (
      <View style={styles.centerBox}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.centerText}>Finding salons near you...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <HomeHeader
        navigation={navigation}
        user={user}
        locationName={locationName}
        gender={gender}
        onGenderChange={setGender}
        salonCount={salonCount}
        availableCount={availableCount}
        unreadCount={0}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={handleRefresh}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Location denied banner */}
        {locationGranted === false && (
          <TouchableOpacity style={styles.locationBanner} activeOpacity={0.85}>
            <Ionicons name="location-outline" size={14} color={COLORS.warning} />
            <Text style={styles.locationBannerText}>Enable location for better results</Text>
            <Text style={styles.locationBannerCta}>Enable →</Text>
          </TouchableOpacity>
        )}

        <HomeHeroBanner onCtaPress={() => navigation.navigate(ROUTES.SEARCH)} />

        <HomeCategories
          activeCategory={activeCategory}
          onSelect={(cat) => setActiveCategory(activeCategory === cat ? null : cat)}
        />

        <HomeAvailableNow
          salons={filtered}
          onSalonPress={goToSalon}
          onBookNow={goToBooking}
          onWishlist={(salon) => {}}
          onViewAll={() => navigation.navigate(ROUTES.SEARCH)}
        />

        {/* Only shows when user has upcoming booking */}
        <HomeUpcomingAppointment
          booking={upcomingBooking}
          onTrack={() => navigation.navigate(ROUTES.BOOKINGS)}
        />

        <HomeNearbySalons
          salons={filtered}
          onSalonPress={goToSalon}
          onWishlist={(salon) => {}}
          onViewAll={() => navigation.navigate(ROUTES.SEARCH)}
        />

        <HomeTrendingServices
          onServicePress={() => navigation.navigate(ROUTES.SEARCH)}
          onWishlist={(service) => {}}
          onViewAll={() => navigation.navigate(ROUTES.SEARCH)}
        />

        <HomeRecentlyViewed
          salons={recentlyViewed}
          onSalonPress={goToSalon}
          onViewAll={() => {}}
        />

        <HomePrivilegeBanner
          isMember={false}
          savedAmount={0}
          onJoin={() => {}}
        />

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  centerBox: {
    flex: 1, justifyContent: "center", alignItems: "center",
    backgroundColor: COLORS.background, gap: 12, padding: 24,
  },
  centerTitle: { fontSize: 16, fontFamily: FONTS.bold,    color: COLORS.text.primary },
  centerText:  { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  retryBtn: {
    marginTop: 8, backgroundColor: COLORS.primary,
    borderRadius: RADIUS.full, paddingHorizontal: 28, paddingVertical: 10,
  },
  retryText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
  locationBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.warningLight, borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: COLORS.warning + "40",
  },
  locationBannerText: { flex: 1, fontSize: 12, fontFamily: FONTS.regular, color: COLORS.warning },
  locationBannerCta:  { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.warning },
});