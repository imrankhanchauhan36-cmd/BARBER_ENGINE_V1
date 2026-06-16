import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  StatusBar, ActivityIndicator, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import apiClient from "../../../shared/api/client";
import { COLORS, RADIUS, FONTS } from "../../../config/theme";
import { useBooking } from "../../booking/store/BookingContext";
import { ROUTES } from "../../../app/routes/routeNames";

const PURPLE = "#5C35E8";
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const formatLabel = (isoStr) => {
  const d = new Date(isoStr);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

const generateDates = (timings = {}) => {
  const dates = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dayKey = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][d.getDay()];
    const isClosed = timings[dayKey]?.isClosed || false;
    dates.push({ date: d, dayName: DAYS[d.getDay()], dayKey, isClosed });
  }
  return dates;
};

export default function SlotSelectionScreen({ navigation, route }) {
  const { salonId, salon, services = [], totalDuration } = route.params || {};
  const { setSelectedSlot: saveSlot, setSelectedDate: saveDate } = useBooking();

  const totalPrice = services.reduce((sum, s) => sum + (s.price || 0), 0);
  const serviceIds = services
    .filter(s => s._id && s._id.length === 24)
    .map(s => s._id);
  const salonName  = salon?.basicInfo?.shopName || "Salon";
  const salonCity  = salon?.basicInfo?.address?.city || "Nearby";
  const dates      = generateDates(salon?.timings || {});

  const [selectedDate,  setSelectedDate]  = useState(dates.find(d => !d.isClosed) || dates[0]);
  const [slots,         setSlots]         = useState([]);
  const [selectedSlot,  setSelectedSlot]  = useState(null);
  const [isLoading,     setIsLoading]     = useState(false);
  const [isBooking,     setIsBooking]     = useState(false);
  const [activeFilter,  setActiveFilter]  = useState("all");

  const fetchSlots = useCallback(async () => {
    if (!selectedDate || selectedDate.isClosed) { setSlots([]); return; }
    setIsLoading(true);
    setSelectedSlot(null);
    try {
      const d = selectedDate.date;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const res = await apiClient.get("/api/v1/bookings/user/slots", {
        params: { salonId, date: dateStr, serviceDuration: parseInt(totalDuration) || 30, bufferTime: 5 },
      });
      if (res?.data?.success) setSlots(res.data.slots || []);
      else setSlots([]);
    } catch (err) {
      console.warn("SLOTS_FETCH:", err.message);
      setSlots([]);
    } finally { setIsLoading(false); }
  }, [selectedDate, salonId, totalDuration]);

  useEffect(() => { fetchSlots(); }, [fetchSlots]);

  const getFilteredSlots = () => {
    if (activeFilter === "all") return slots;
    return slots.filter(slot => {
      const h = new Date(slot.start).getHours();
      if (activeFilter === "morning")   return h >= 6  && h < 12;
      if (activeFilter === "afternoon") return h >= 12 && h < 18;
      if (activeFilter === "evening")   return h >= 18 && h < 22;
      return true;
    });
  };

  const handleConfirm = async () => {
    if (!selectedSlot) { Alert.alert("Select Slot", "Please select a time slot."); return; }
    setIsBooking(true);
    try {
      const d = selectedDate.date;
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      const res = await apiClient.post("/api/v1/bookings/user/lock", {
        salonId, date: dateStr,
        serviceDuration: parseInt(totalDuration) || 30, bufferTime: 5,
        requestedTime: selectedSlot.start, serviceRefs: serviceIds,
      });
      if (res?.data?.success) {
        saveSlot(selectedSlot);
        saveDate(selectedDate.date);
        navigation.navigate(ROUTES.BOOKING_HOLD, {
          bookingId: res.data.bookingId,
          lockUntil: res.data.lockUntil,
          salon, services, slot: selectedSlot, totalPrice,
        });
      } else {
        Alert.alert("Error", res?.data?.message || "Could not lock slot.");
      }
    } catch (err) {
      Alert.alert("Error", err?.response?.data?.message || "Something went wrong.");
    } finally { setIsBooking(false); }
  };

  const filteredSlots = getFilteredSlots();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Date & Time</Text>
        <TouchableOpacity style={styles.iconBtn}>
          <Ionicons name="heart-outline" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* ALMOST THERE BANNER */}
        <View style={styles.banner}>
          <View style={styles.bannerIcon}>
            <Ionicons name="calendar-outline" size={24} color={PURPLE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Almost there!</Text>
            <Text style={styles.bannerSub}>Choose your preferred date and time slot{"\n"}to confirm your appointment.</Text>
          </View>
          <TouchableOpacity style={styles.viewCartBtn} onPress={() => navigation.navigate(ROUTES.CART, { salonId, salon })}>
            <Ionicons name="cart-outline" size={14} color={PURPLE} />
            <Text style={styles.viewCartText}>View Cart</Text>
            {services.length > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{services.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* BOOKING SUMMARY */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCardTitle}>Your Booking Summary</Text>
          <View style={styles.summaryRow}>
            {/* Salon */}
            <View style={styles.summaryLeft}>
              <View style={styles.salonLogo}>
                <Text style={styles.salonLogoText}>{salonName?.charAt(0) || "S"}</Text>
              </View>
              <View>
                <View style={styles.salonNameRow}>
                  <Text style={styles.salonName}>{salonName}</Text>
                  <Ionicons name="checkmark-circle" size={13} color={PURPLE} />
                </View>
                <View style={styles.salonMeta}>
                  <Ionicons name="location-outline" size={11} color={COLORS.text.secondary} />
                  <Text style={styles.salonMetaText}>{salonCity}</Text>
                </View>
              </View>
            </View>

            {/* Services */}
            <View style={styles.summaryRight}>
              <Text style={styles.summaryServicesLabel}>Services ({services.length})</Text>
              <Text style={styles.summaryPrice}>₹{totalPrice}</Text>
              <TouchableOpacity style={styles.viewDetailsBtn}
                onPress={() => navigation.navigate(ROUTES.CART, { salonId, salon })}>
                <Text style={styles.viewDetailsBtnText}>View Details</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* DURATION + SELECTED DATE */}
        <View style={styles.durationCard}>
          <View style={styles.durationLeft}>
            <View style={styles.durationIcon}>
              <Ionicons name="time-outline" size={20} color={PURPLE} />
            </View>
            <View>
              <Text style={styles.durationLabel}>Duration</Text>
              <Text style={styles.durationValue}>Total {totalDuration} mins</Text>
            </View>
          </View>
          <View style={styles.durationRight}>
            <Text style={styles.durationLabel}>Selected Date</Text>
            <Text style={styles.selectedDateText}>
              {selectedDate
                ? `${selectedDate.dayName}, ${selectedDate.date.getDate()} ${MONTHS[selectedDate.date.getMonth()]}`
                : "Select a date"
              }
            </Text>
          </View>
        </View>

        {/* SELECT DATE */}
        <View style={styles.sectionPad}>
          <Text style={styles.sectionTitle}>Select Date</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRow}>
          {dates.map((d, i) => {
            const isSelected = selectedDate?.date.toDateString() === d.date.toDateString();
            const isToday = i === 0;
            return (
              <TouchableOpacity
                key={i}
                style={[styles.dateCard, isSelected && styles.dateCardActive, d.isClosed && styles.dateCardDisabled]}
                onPress={() => !d.isClosed && setSelectedDate(d)}
                activeOpacity={d.isClosed ? 1 : 0.8}
              >
                <Text style={[styles.dateDayName, isSelected && styles.dateTextActive]}>
                  {isToday ? "Today" : d.dayName}
                </Text>
                <Text style={[styles.dateNum, isSelected && styles.dateTextActive]}>
                  {d.date.getDate()}
                </Text>
                <Text style={[styles.dateMonth, isSelected && styles.dateTextActive, d.isClosed && { color: "#EF4444" }]}>
                  {d.isClosed ? "Closed" : MONTHS[d.date.getMonth()]}
                </Text>
              </TouchableOpacity>
            );
          })}
          <View style={styles.dateArrow}>
            <Ionicons name="chevron-forward" size={16} color={COLORS.text.secondary} />
          </View>
        </ScrollView>

        {/* TIME FILTER */}
        <View style={styles.sectionPad}>
          <Text style={styles.sectionTitle}>Select Time Slot</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {[
            { key: "all",       label: "All Slots",  icon: "calendar-outline",    sub: null },
            { key: "morning",   label: "Morning",    icon: "sunny-outline",       sub: "6 AM - 12 PM" },
            { key: "afternoon", label: "Afternoon",  icon: "partly-sunny-outline",sub: "12 PM - 6 PM" },
            { key: "evening",   label: "Evening",    icon: "moon-outline",        sub: "6 PM - 10 PM" },
          ].map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, activeFilter === f.key && styles.filterChipActive]}
              onPress={() => setActiveFilter(f.key)}
            >
              <Ionicons name={f.icon} size={14} color={activeFilter === f.key ? PURPLE : COLORS.text.secondary} />
              <Text style={[styles.filterLabel, activeFilter === f.key && styles.filterLabelActive]}>{f.label}</Text>
              {f.sub && <Text style={styles.filterSub}>{f.sub}</Text>}
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* PEAK HOURS BANNER */}
        <View style={styles.peakBanner}>
          <Ionicons name="flash" size={14} color="#16A34A" />
          <Text style={styles.peakText}>
            <Text style={{ fontFamily: FONTS.bold }}>Peak Hours</Text>{"  "}Slots are filling fast. Book now to avoid disappointment!
          </Text>
        </View>

        {/* SLOTS */}
        <View style={styles.slotsHeader}>
          <Text style={styles.sectionTitle}>Available Slots</Text>
          <Text style={styles.slotsNote}>Showing slots in IST</Text>
        </View>

        {selectedDate?.isClosed ? (
          <View style={styles.emptyBox}>
            <Ionicons name="storefront-outline" size={40} color={COLORS.border} />
            <Text style={styles.emptyText}>Salon is closed on this day</Text>
          </View>
        ) : isLoading ? (
          <View style={styles.emptyBox}>
            <ActivityIndicator size="large" color={PURPLE} />
            <Text style={styles.emptyText}>Loading slots...</Text>
          </View>
        ) : filteredSlots.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={40} color={COLORS.border} />
            <Text style={styles.emptyText}>No slots available</Text>
            <Text style={styles.emptySubText}>Try a different date or time</Text>
          </View>
        ) : (
          <View style={styles.slotsGrid}>
            {filteredSlots.map((slot, i) => {
              const isSelected = selectedSlot?.start === slot.start;
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.slotChip, isSelected && styles.slotChipActive]}
                  onPress={() => setSelectedSlot(slot)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.slotText, isSelected && styles.slotTextActive]}>
                    {slot.label || formatLabel(slot.start)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* REQUEST TIME BANNER */}
        <View style={styles.requestTimeBanner}>
          <View style={styles.requestTimeLeft}>
            <Ionicons name="time-outline" size={16} color="#D97706" />
            <View>
              <Text style={styles.requestTimeTitle}>Prefer a specific time?</Text>
              <Text style={styles.requestTimeSub}>You can request a specific time and we'll try to accommodate.</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.requestTimeBtn}>
            <Text style={styles.requestTimeBtnText}>Request Time</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Total Payable</Text>
          <View style={styles.footerPriceRow}>
            <Text style={styles.footerPrice}>₹{totalPrice}</Text>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.text.secondary} />
          </View>
        </View>
        <TouchableOpacity
          style={[styles.confirmBtn, (!selectedSlot || isBooking) && { opacity: 0.6 }]}
          onPress={handleConfirm}
          disabled={!selectedSlot || isBooking}
          activeOpacity={0.85}
        >
          {isBooking
            ? <ActivityIndicator color="#fff" />
            : <>
                <Ionicons name="calendar-outline" size={18} color="#fff" />
                <Text style={styles.confirmBtnText}>Confirm Appointment</Text>
              </>
          }
        </TouchableOpacity>
      </View>
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.text.primary },

  // Banner
  banner: {
    flexDirection: "row", alignItems: "center",
    margin: 16, padding: 14,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE", gap: 12,
  },
  bannerIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  bannerTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bannerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  viewCartBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 6, position: "relative",
  },
  viewCartText: { fontSize: 11, fontFamily: FONTS.bold, color: PURPLE },
  cartBadge: {
    position: "absolute", top: -6, right: -6,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },
  cartBadgeText: { fontSize: 9, fontFamily: FONTS.bold, color: "#fff" },

  // Summary card
  summaryCard: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: COLORS.border,
  },
  summaryCardTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 12 },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  salonLogo: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: "#1a1a1a", justifyContent: "center", alignItems: "center",
  },
  salonLogoText: { fontSize: 18, fontFamily: FONTS.bold, color: "#fff" },
  salonNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  salonName: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  salonMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  salonMetaText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  summaryRight: { alignItems: "flex-end", gap: 4 },
  summaryServicesLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  summaryPrice: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary },
  viewDetailsBtn: {
    borderWidth: 1, borderColor: PURPLE, borderRadius: RADIUS.md,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  viewDetailsBtnText: { fontSize: 11, fontFamily: FONTS.medium, color: PURPLE },

  // Duration card
  durationCard: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 20,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: COLORS.border,
  },
  durationLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  durationIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  durationLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  durationValue: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  durationRight: { alignItems: "flex-end" },
  selectedDateText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE, marginTop: 2 },

  // Section
  sectionPad: { paddingHorizontal: 16, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },

  // Date row
  dateRow: { paddingHorizontal: 16, gap: 8, marginBottom: 20, alignItems: "center" },
  dateCard: {
    width: 62, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface, borderWidth: 0.5, borderColor: COLORS.border,
    paddingVertical: 10, alignItems: "center", gap: 2,
  },
  dateCardActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  dateCardDisabled: { opacity: 0.4 },
  dateDayName: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  dateNum: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.text.primary },
  dateMonth: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  dateTextActive: { color: "#fff" },
  dateArrow: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, borderWidth: 0.5, borderColor: COLORS.border,
    justifyContent: "center", alignItems: "center",
  },

  // Filter
  filterRow: { paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  filterChipActive: { borderColor: PURPLE, backgroundColor: "#F5F3FF" },
  filterLabel: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  filterLabelActive: { color: PURPLE, fontFamily: FONTS.bold },
  filterSub: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  // Peak banner
  peakBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  peakText: { fontSize: 12, fontFamily: FONTS.regular, color: "#15803D", flex: 1 },

  // Slots
  slotsHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, marginBottom: 12,
  },
  slotsNote: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  slotsGrid: {
    flexDirection: "row", flexWrap: "wrap",
    paddingHorizontal: 16, gap: 10, marginBottom: 16,
  },
  slotChip: {
    width: "22%", paddingVertical: 12,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    borderWidth: 0.5, borderColor: COLORS.border,
    alignItems: "center",
  },
  slotChipActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  slotText: { fontSize: 12, fontFamily: FONTS.medium, color: PURPLE },
  slotTextActive: { color: "#fff", fontFamily: FONTS.bold },

  // Empty
  emptyBox: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  emptySubText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.light },

  // Request time
  requestTimeBanner: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#FFFBEB", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#FDE68A", gap: 10,
  },
  requestTimeLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  requestTimeTitle: { fontSize: 13, fontFamily: FONTS.bold, color: "#92400E" },
  requestTimeSub: { fontSize: 11, fontFamily: FONTS.regular, color: "#B45309", marginTop: 2 },
  requestTimeBtn: {
    borderWidth: 1.5, borderColor: "#D97706", borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  requestTimeBtnText: { fontSize: 12, fontFamily: FONTS.bold, color: "#D97706" },

  // Footer
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
    paddingBottom: Platform.OS === "ios" ? 32 : 14,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5, borderTopColor: COLORS.border,
  },
  footerLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  footerPriceRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  footerPrice: { fontSize: 22, fontFamily: FONTS.bold, color: PURPLE },
  confirmBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingVertical: 14, marginLeft: 16,
  },
  confirmBtnText: { fontSize: 15, fontFamily: FONTS.bold, color: "#fff" },
});
