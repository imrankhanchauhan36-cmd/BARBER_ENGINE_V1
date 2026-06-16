import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  ActivityIndicator, Alert, Platform, ScrollView, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import apiClient from "../../../shared/api/client";
import { COLORS, RADIUS, FONTS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";
import Svg, { Circle } from "react-native-svg";

const PURPLE = "#5C35E8";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const formatTime = (isoStr) => {
  const d = new Date(isoStr);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2,"0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

const DUMMY_DATA = {
  haircut: { image: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=200", desc: "Includes wash, cut & style", badge: "Expert Stylist" },
  beard:   { image: "https://images.unsplash.com/photo-1621605815971-ab890d2b52e2?w=200", desc: "Beard shaping & finishing",  badge: "Perfect Beard Shape" },
  facial:  { image: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=200", desc: "Deep cleansing & glow",      badge: "Glowing Skin" },
  spa:     { image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=200", desc: "Relaxing head & scalp spa",   badge: "Deep Nourishment" },
  default: { image: null, desc: "Premium salon service", badge: "Expert Stylist" },
};

const getDummy = (name = "") => {
  const lower = name.toLowerCase();
  for (const key of Object.keys(DUMMY_DATA)) {
    if (lower.includes(key)) return DUMMY_DATA[key];
  }
  return DUMMY_DATA.default;
};

// Circular timer component
function CircularTimer({ timeLeft, totalTime }) {
  const SIZE   = 160;
  const STROKE = 8;
  const R      = (SIZE - STROKE) / 2;
  const CIRCUM = 2 * Math.PI * R;
  const progress = totalTime > 0 ? timeLeft / totalTime : 0;
  const strokeDash = CIRCUM * progress;
  const isUrgent = timeLeft < 60;

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  const label = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;

  return (
    <View style={{ alignItems: "center", marginVertical: 8 }}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Svg width={SIZE} height={SIZE}>
          {/* Background circle */}
          <Circle cx={SIZE/2} cy={SIZE/2} r={R}
            stroke="#E5E7EB" strokeWidth={STROKE} fill="none" />
          {/* Progress circle */}
          <Circle cx={SIZE/2} cy={SIZE/2} r={R}
            stroke={isUrgent ? "#EF4444" : PURPLE}
            strokeWidth={STROKE} fill="none"
            strokeDasharray={`${strokeDash} ${CIRCUM}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${SIZE/2} ${SIZE/2})`}
          />
        </Svg>
        <View style={styles.timerInner}>
          <Text style={[styles.timerLabel, isUrgent && { color: "#EF4444" }]}>{label}</Text>
          <Text style={styles.timerSubLabel}>TIME LEFT</Text>
        </View>
      </View>
    </View>
  );
}

export default function BookingHoldScreen({ navigation, route }) {
  const { bookingId, lockUntil, salon, services = [], slot, totalPrice } = route.params || {};

  const TOTAL_TIME = 120; // 2 minutes
  const [timeLeft,     setTimeLeft]     = useState(TOTAL_TIME);
  const [isConfirming, setIsConfirming] = useState(false);

  const salonName     = salon?.basicInfo?.shopName || "Salon";
  const salonCity     = salon?.basicInfo?.address?.city || "Nearby";
  const totalDuration = services.reduce((sum, s) => sum + (parseInt(s.duration) || 0), 0);
  const TAX_RATE      = 0.05;
  const subtotal      = totalPrice || services.reduce((sum, s) => sum + (s.price || 0), 0);
  const taxes         = Math.round(subtotal * TAX_RATE);
  const total         = subtotal + taxes;

  useEffect(() => {
    if (!lockUntil) return;
    const lockTime = new Date(lockUntil).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.floor((lockTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) {
        Alert.alert("Slot Expired", "Your slot hold has expired. Please try again.",
          [{ text: "OK", onPress: () => navigation.goBack() }]);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [lockUntil]);

  const handlePayNow = async () => {
    setIsConfirming(true);
    try {
      const res = await apiClient.post("/api/v1/bookings/user/confirm", {
        bookingId,
        paymentId:         `PAY_${Date.now()}_DUMMY`,
        orderId:           `order_${Date.now()}`,
        razorpaySignature: "test_bypass",
      });
      if (res?.data?.success) {
        navigation.replace(ROUTES.BOOKING_SUCCESS, {
          booking: { _id: res.data.bookingId, otp: res.data.checkInOtp },
          salon, services, slot, totalPrice: total,
        });
      } else {
        Alert.alert("Error", res?.data?.message || "Payment failed.");
      }
    } catch (err) {
      Alert.alert("Error", err?.response?.data?.message || "Something went wrong.");
    } finally { setIsConfirming(false); }
  };

  const handleCancel = () => {
    Alert.alert("Cancel Booking", "Are you sure you want to cancel?", [
      { text: "No", style: "cancel" },
      { text: "Yes, Cancel", style: "destructive", onPress: () => navigation.goBack() },
    ]);
  };

  const slotDate = slot?.start ? new Date(slot.start) : new Date();
  const dateStr  = `Today, ${slotDate.getDate()} ${MONTHS[slotDate.getMonth()]} ${slotDate.getFullYear()}`;
  const timeStr  = slot?.start ? formatTime(slot.start) : "--";
  const bookingRef = `#BK${Date.now().toString().slice(-5)}`;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={handleCancel}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hold Your Booking</Text>
        <View style={styles.secureBadge}>
          <Ionicons name="shield-checkmark" size={14} color="#16A34A" />
          <Text style={styles.secureBadgeText}>Secure Booking</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>

        {/* TIMER CARD */}
        <View style={styles.timerCard}>
          <View style={styles.timerIconCircle}>
            <Ionicons name="time-outline" size={22} color={PURPLE} />
          </View>
          <Text style={styles.reservedTitle}>Appointment Reserved!</Text>
          <Text style={styles.reservedSub}>Your slot is reserved for 2 minutes.{"\n"}Complete payment before the timer expires.</Text>
          <CircularTimer timeLeft={timeLeft} totalTime={TOTAL_TIME} />
          <View style={styles.secureRow}>
            <Ionicons name="shield-outline" size={14} color={PURPLE} />
            <Text style={styles.secureText}>Your booking is safe and secure.</Text>
          </View>
          <Text style={styles.secureSubText}>Complete the payment to confirm your appointment.</Text>
        </View>

        {/* BOOKING SUMMARY */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Booking Summary</Text>
            <Text style={styles.bookingId}>Booking ID: {bookingRef}</Text>
          </View>

          {/* Salon Info */}
          <View style={styles.salonRow}>
            <View style={styles.salonLogo}>
              <Text style={styles.salonLogoText}>{salonName?.charAt(0) || "S"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.salonNameRow}>
                <Text style={styles.salonName}>{salonName}</Text>
                <Ionicons name="checkmark-circle" size={14} color={PURPLE} />
              </View>
              <View style={styles.salonMeta}>
                <Ionicons name="location-outline" size={11} color={COLORS.text.secondary} />
                <Text style={styles.salonMetaText}>{salonCity}</Text>
              </View>
            </View>
            <View style={styles.hygieneBadge}>
              <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
              <Text style={styles.hygieneBadgeText}>Hygiene Certified</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Services */}
          {services.map((item, index) => {
            const dummy = getDummy(item.name);
            const imgUri = item.imageUrl || item.image || dummy.image;
            const desc   = item.description || dummy.desc;
            const badge  = dummy.badge;
            return (
              <View key={item._id || index} style={styles.serviceRow}>
                <View style={styles.serviceImg}>
                  {imgUri
                    ? <Image source={{ uri: imgUri }} style={styles.serviceImgReal} resizeMode="cover" />
                    : <Ionicons name="cut-outline" size={20} color={PURPLE} />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.serviceName}>
                    {item.name?.charAt(0).toUpperCase() + item.name?.slice(1)}
                  </Text>
                  <Text style={styles.serviceDesc}>{desc}</Text>
                  <View style={styles.serviceBadge}>
                    <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                    <Text style={styles.serviceBadgeText}>{badge}</Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.servicePrice}>₹{item.price}</Text>
                  <Text style={styles.serviceDuration}>{item.duration} mins</Text>
                </View>
              </View>
            );
          })}

          <View style={styles.divider} />

          {/* Meta row */}
          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <View style={styles.metaIcon}>
                <Ionicons name="person-outline" size={16} color={PURPLE} />
              </View>
              <Text style={styles.metaLabel}>Barber</Text>
              <Text style={styles.metaValue}>Auto Assigned</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <View style={styles.metaIcon}>
                <Ionicons name="calendar-outline" size={16} color={PURPLE} />
              </View>
              <Text style={styles.metaLabel}>Date & Time</Text>
              <Text style={styles.metaValue}>{dateStr}</Text>
              <Text style={styles.metaValue}>{timeStr}</Text>
            </View>
            <View style={styles.metaDivider} />
            <View style={styles.metaItem}>
              <View style={styles.metaIcon}>
                <Ionicons name="time-outline" size={16} color={PURPLE} />
              </View>
              <Text style={styles.metaLabel}>Duration</Text>
              <Text style={styles.metaValue}>{totalDuration} mins</Text>
            </View>
          </View>
        </View>

        {/* PRICE DETAILS */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Price Details</Text>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Subtotal ({services.length} Services)</Text>
            <Text style={styles.priceValue}>₹{subtotal}</Text>
          </View>
          <View style={styles.priceRow}>
            <View style={styles.taxRow}>
              <Text style={styles.priceLabel}>Taxes & Charges</Text>
              <Ionicons name="information-circle-outline" size={13} color={COLORS.text.secondary} />
            </View>
            <Text style={styles.priceValue}>₹{taxes}</Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRow}>
            <Text style={styles.totalLabel}>Total Amount</Text>
            <Text style={styles.totalValue}>₹{total}</Text>
          </View>
        </View>

        {/* WARNING BANNER */}
        <View style={styles.warningBanner}>
          <Ionicons name="alert-circle-outline" size={18} color="#D97706" />
          <View style={{ flex: 1 }}>
            <Text style={styles.warningTitle}>Important: If the timer expires,</Text>
            <Text style={styles.warningText}>your slot will be released and booking will be cancelled automatically.</Text>
          </View>
        </View>

      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <View>
          <Text style={styles.footerLabel}>Total Payable</Text>
          <View style={styles.footerPriceRow}>
            <Text style={styles.footerPrice}>₹{total}</Text>
            <Ionicons name="information-circle-outline" size={14} color={COLORS.text.secondary} />
          </View>
        </View>
        <TouchableOpacity
          style={[styles.payBtn, (isConfirming || timeLeft === 0) && { opacity: 0.6 }]}
          onPress={handlePayNow}
          disabled={isConfirming || timeLeft === 0}
          activeOpacity={0.85}
        >
          {isConfirming
            ? <ActivityIndicator color="#fff" />
            : <>
                <Text style={styles.payBtnText}>Pay ₹{total} Securely</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
          }
        </TouchableOpacity>
      </View>
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.text.primary },
  secureBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  secureBadgeText: { fontSize: 11, fontFamily: FONTS.bold, color: "#16A34A" },

  // Timer card
  timerCard: {
    margin: 16, padding: 20,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    alignItems: "center", borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  timerIconCircle: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
    marginBottom: 12,
  },
  reservedTitle: { fontSize: 20, fontFamily: FONTS.bold, color: PURPLE, marginBottom: 6 },
  reservedSub:   { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center", lineHeight: 20 },
  timerInner: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: "center", alignItems: "center",
  },
  timerLabel:    { fontSize: 32, fontFamily: FONTS.bold, color: PURPLE },
  timerSubLabel: { fontSize: 10, fontFamily: FONTS.bold, color: COLORS.text.secondary, letterSpacing: 1.5, marginTop: 2 },
  secureRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  secureText: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  secureSubText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },

  // Cards
  card: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: COLORS.border,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bookingId: { fontSize: 11, fontFamily: FONTS.medium, color: PURPLE },

  // Salon
  salonRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  salonLogo: {
    width: 48, height: 48, borderRadius: 10,
    backgroundColor: "#1a1a1a", justifyContent: "center", alignItems: "center",
  },
  salonLogoText: { fontSize: 20, fontFamily: FONTS.bold, color: "#fff" },
  salonNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  salonName: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  salonMeta: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  salonMetaText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  hygieneBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  hygieneBadgeText: { fontSize: 10, fontFamily: FONTS.bold, color: "#16A34A" },

  divider: { height: 0.5, backgroundColor: COLORS.border, marginVertical: 12 },

  // Service row
  serviceRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12,
  },
  serviceImg: {
    width: 64, height: 64, borderRadius: RADIUS.md,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center", overflow: "hidden",
  },
  serviceImgReal: { width: "100%", height: "100%" },
  serviceName: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  serviceDesc: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  serviceBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  serviceBadgeText: { fontSize: 10, fontFamily: FONTS.medium, color: "#16A34A" },
  servicePrice: { fontSize: 15, fontFamily: FONTS.bold, color: PURPLE },
  serviceDuration: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },

  // Meta row
  metaRow: {
    flexDirection: "row", marginTop: 4,
    backgroundColor: "#F8F8FF", borderRadius: RADIUS.md,
    padding: 12,
  },
  metaItem: { flex: 1, alignItems: "center", gap: 4 },
  metaIcon: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  metaLabel: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  metaValue: { fontSize: 11, fontFamily: FONTS.bold, color: COLORS.text.primary, textAlign: "center" },
  metaDivider: { width: 0.5, backgroundColor: COLORS.border },

  // Price
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  priceLabel: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  priceValue: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },
  taxRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  priceDivider: { height: 0.5, backgroundColor: COLORS.border, marginVertical: 8 },
  totalLabel: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  totalValue: { fontSize: 18, fontFamily: FONTS.bold, color: PURPLE },

  // Warning
  warningBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#FFFBEB", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#FDE68A",
  },
  warningTitle: { fontSize: 13, fontFamily: FONTS.bold, color: "#92400E" },
  warningText:  { fontSize: 11, fontFamily: FONTS.regular, color: "#B45309", marginTop: 2, lineHeight: 16 },

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
  payBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingVertical: 14, marginLeft: 16,
  },
  payBtnText: { fontSize: 15, fontFamily: FONTS.bold, color: "#fff" },
});
