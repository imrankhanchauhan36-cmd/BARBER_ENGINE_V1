import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
    StatusBar, Platform, ScrollView, Image, Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, FONTS } from "../../../config/theme";
import { ROUTES } from "../../../app/routes/routeNames";

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
  haircut: { image: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=200", desc: "Includes wash, cut & style" },
  beard:   { image: "https://images.unsplash.com/photo-1621605815971-ab890d2b52e2?w=200", desc: "Beard shaping & finishing" },
  facial:  { image: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?w=200", desc: "Deep cleansing & glow" },
  spa:     { image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=200", desc: "Relaxing head & scalp spa" },
  default: { image: null, desc: "Premium salon service" },
};

const getDummy = (name = "") => {
  const lower = name.toLowerCase();
  for (const key of Object.keys(DUMMY_DATA)) {
    if (lower.includes(key)) return DUMMY_DATA[key];
  }
  return DUMMY_DATA.default;
};

export default function BookingSuccessScreen({ navigation, route }) {
  const { booking, salon, services = [], slot, totalPrice } = route.params || {};

  const salonName  = salon?.basicInfo?.shopName || "Salon";
  const salonCity  = salon?.basicInfo?.address?.city || "Nearby";
  const otp = String(booking?.otp || "0000").padStart(4,"0");
  const otpDigits  = otp.split("");

  const salonLat = salon?.location?.geo?.coordinates?.[1] || null;
  const salonLng = salon?.location?.geo?.coordinates?.[0] || null;

  const handleDirections = () => {
    if (salonLat && salonLng) {
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&destination=${salonLat},${salonLng}`
      );
    }
  };
  const bookingId  = booking?._id ? `#BK${booking._id.slice(-5).toUpperCase()}` : "#BK72391";
  const totalDur   = services.reduce((sum, s) => sum + (parseInt(s.duration) || 0), 0);

  const TAX_RATE = 0.05;
  const subtotal = totalPrice || services.reduce((sum, s) => sum + (s.price || 0), 0);
  const taxes    = Math.round(subtotal * TAX_RATE);
  const total    = subtotal + taxes;

  const slotDate = slot?.start ? new Date(slot.start) : new Date();
  const dateStr  = `Today, ${slotDate.getDate()} ${MONTHS[slotDate.getMonth()]} ${slotDate.getFullYear()}`;
  const timeStr  = slot?.start ? formatTime(slot.start) : "--";

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.navigate(ROUTES.MAIN_TABS)}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.helpBtn}>
          <Text style={styles.helpText}>Help</Text>
          <Ionicons name="headset-outline" size={18} color={COLORS.text.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* SUCCESS ICON */}
        <View style={styles.successSection}>
          <View style={styles.confettiContainer}>
            {["#FF6B6B","#4ECDC4","#FFE66D","#A78BFA","#F97316"].map((color, i) => (
              <View key={i} style={[styles.confettiDot, {
                backgroundColor: color,
                top: [10,5,15,8,12][i],
                left: [20,80,140,200,260][i] % 300,
              }]} />
            ))}
          </View>
          <View style={styles.successCircle}>
            <View style={styles.successCircleInner}>
              <Ionicons name="checkmark" size={36} color="#fff" />
            </View>
          </View>
          <Text style={styles.successTitle}>Booking Confirmed!</Text>
          <Text style={styles.successSub}>Your appointment is confirmed.</Text>
          <Text style={styles.successSub2}>Show the OTP below to the barber at check-in</Text>
        </View>

        {/* OTP CARD */}
        <View style={styles.otpCard}>
          <View style={styles.otpCardHead}>
            <Text style={styles.otpTitle}>Your Check-in OTP</Text>
            <Text style={styles.resendText}>Show to barber</Text>
          </View>
          <View style={styles.otpRow}>
            {otpDigits.map((digit, i) => (
              <View key={i} style={styles.otpBox}>
                <Text style={styles.otpDigit}>{digit}</Text>
              </View>
            ))}
          </View>
          <View style={styles.otpNote}>
            <Ionicons name="shield-outline" size={13} color={COLORS.text.secondary} />
            <Text style={styles.otpNoteText}>Valid till your appointment. Show this to the barber at check-in.</Text>
          </View>
        </View>

        {/* BOOKING SUMMARY */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Booking Summary</Text>
            <View style={styles.bookingIdRow}>
              <Text style={styles.bookingIdText}>Booking ID: {bookingId}</Text>
              <Ionicons name="copy-outline" size={14} color={PURPLE} />
            </View>
          </View>

          {/* Salon */}
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
              <View style={styles.salonMeta}>
                <Ionicons name="calendar-outline" size={11} color={COLORS.text.secondary} />
                <Text style={styles.salonMetaText}>{dateStr} • {timeStr}</Text>
              </View>
            </View>
            <View style={styles.confirmedBadge}>
              <Text style={styles.confirmedText}>Confirmed</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Services */}
          {services.map((item, index) => {
            const dummy  = getDummy(item.name);
            const imgUri = item.imageUrl || item.image || dummy.image;
            const desc   = item.description || dummy.desc;
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
                  <View style={styles.durationBadge}>
                    <Text style={styles.durationBadgeText}>{item.duration} mins</Text>
                  </View>
                </View>
                <Text style={styles.servicePrice}>₹{item.price}</Text>
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
            <View style={styles.metaItem}>
              <View style={styles.metaIcon}>
                <Ionicons name="time-outline" size={16} color={PURPLE} />
              </View>
              <Text style={styles.metaLabel}>Duration</Text>
              <Text style={styles.metaValue}>{totalDur} mins</Text>
            </View>
            <View style={styles.metaItem}>
              <View style={styles.metaIcon}>
                <Ionicons name="wallet-outline" size={16} color={PURPLE} />
              </View>
              <Text style={styles.metaLabel}>Payment</Text>
              <Text style={styles.metaLabel}>Paid</Text>
              <Text style={styles.metaValueBold}>₹{total}</Text>
            </View>
          </View>
        </View>

        {/* PAYMENT SUMMARY */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Payment Summary</Text>
            <Text style={styles.paidVia}>Paid via UPI</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Total Amount</Text>
            <Text style={styles.priceValue}>₹{subtotal}</Text>
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.priceLabel}>Taxes & Charges</Text>
            <Text style={styles.priceValue}>₹{taxes}</Text>
          </View>
          <View style={styles.priceDivider} />
          <View style={styles.priceRow}>
            <Text style={styles.amountPaidLabel}>Amount Paid</Text>
            <Text style={styles.amountPaidValue}>₹{total}</Text>
          </View>
        </View>

        {/* BOTTOM BANNER */}
        <View style={styles.bottomBanner}>
          <View style={styles.bottomBannerLeft}>
            <View style={styles.calendarIcon}>
              <Ionicons name="calendar-outline" size={20} color={PURPLE} />
            </View>
            <View>
              <Text style={styles.bannerTitle}>We look forward to serving you!</Text>
              <Text style={styles.bannerSub}>Arrive on time and enjoy your premium experience.</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.addCalBtn}>
            <Ionicons name="calendar-outline" size={14} color={PURPLE} />
            <Text style={styles.addCalText}>Add to Calendar</Text>
          </TouchableOpacity>
          {salonLat && salonLng && (
            <TouchableOpacity style={styles.directionsBtn} onPress={handleDirections}>
              <Ionicons name="navigate-outline" size={14} color="#fff" />
              <Text style={styles.directionsBtnText}>Directions</Text>
            </TouchableOpacity>
          )}
        </View>

      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.homeBtn} onPress={() => navigation.navigate(ROUTES.MAIN_TABS)}>
          <Text style={styles.homeBtnText}>Back to Home</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.bookingsBtn}
          onPress={() => navigation.navigate(ROUTES.MAIN_TABS, { screen: "BookingsTab" })}>
          <Text style={styles.bookingsBtnText}>My Bookings</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
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
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.background,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  helpBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  helpText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },

  // Success section
  successSection: { alignItems: "center", paddingVertical: 24, paddingHorizontal: 24, backgroundColor: COLORS.background },
  confettiContainer: { position: "absolute", top: 0, left: 0, right: 0, height: 60 },
  confettiDot: { position: "absolute", width: 8, height: 8, borderRadius: 4 },
  successCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#DCFCE7", justifyContent: "center", alignItems: "center",
    marginBottom: 16,
  },
  successCircleInner: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "#16A34A", justifyContent: "center", alignItems: "center",
  },
  successTitle: { fontSize: 24, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 6 },
  successSub:   { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  successSub2:  { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center", marginTop: 4 },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  phoneNum: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  changeText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // OTP card
  otpCard: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: COLORS.border,
  },
  otpCardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  otpTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary, flex: 1 },
  resendText: { fontSize: 12, fontFamily: FONTS.medium, color: PURPLE },
  otpRow: { flexDirection: "row", gap: 8, justifyContent: "center", marginBottom: 14 },
  otpBox: {
    width: 44, height: 52, borderRadius: RADIUS.md,
    borderWidth: 1.5, borderColor: COLORS.border,
    justifyContent: "center", alignItems: "center",
    backgroundColor: COLORS.surface,
  },
  otpDigit: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.text.primary },
  otpNote: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 },
  otpNoteText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, flex: 1 },
  verifyBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingVertical: 14, alignItems: "center",
  },
  verifyBtnText: { fontSize: 15, fontFamily: FONTS.bold, color: "#fff" },

  // Cards
  card: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: COLORS.border,
  },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  cardTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bookingIdRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  bookingIdText: { fontSize: 11, fontFamily: FONTS.medium, color: PURPLE },
  paidVia: { fontSize: 12, fontFamily: FONTS.medium, color: PURPLE },

  // Salon
  salonRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  salonLogo: {
    width: 48, height: 48, borderRadius: 10,
    backgroundColor: "#1a1a1a", justifyContent: "center", alignItems: "center",
  },
  salonLogoText: { fontSize: 20, fontFamily: FONTS.bold, color: "#fff" },
  salonNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  salonName: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  salonMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  salonMetaText: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  confirmedBadge: {
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  confirmedText: { fontSize: 11, fontFamily: FONTS.bold, color: "#16A34A" },

  divider: { height: 0.5, backgroundColor: COLORS.border, marginVertical: 12 },

  // Service rows
  serviceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
  serviceImg: {
    width: 64, height: 64, borderRadius: RADIUS.md,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center", overflow: "hidden",
  },
  serviceImgReal: { width: "100%", height: "100%" },
  serviceName: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  serviceDesc: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  durationBadge: {
    marginTop: 4, alignSelf: "flex-start",
    backgroundColor: COLORS.surface, borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 2,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  durationBadgeText: { fontSize: 10, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  servicePrice: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },

  // Meta row
  metaRow: { flexDirection: "row", justifyContent: "space-around" },
  metaItem: { alignItems: "center", gap: 4 },
  metaIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  metaLabel: { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  metaValue: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.text.primary, textAlign: "center" },
  metaValueBold: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Price
  priceRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  priceLabel: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  priceValue: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.primary },
  priceDivider: { height: 0.5, backgroundColor: COLORS.border, marginVertical: 8 },
  amountPaidLabel: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  amountPaidValue: { fontSize: 18, fontFamily: FONTS.bold, color: PURPLE },

  // Bottom banner
  bottomBanner: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#DDD6FE", gap: 10,
  },
  bottomBannerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  calendarIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  bannerTitle: { fontSize: 12, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bannerSub:   { fontSize: 10, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  addCalBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1.5, borderColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  addCalText: { fontSize: 11, fontFamily: FONTS.bold, color: PURPLE },

  // Footer
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    paddingBottom: Platform.OS === "ios" ? 32 : 14,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5, borderTopColor: COLORS.border,
  },
  homeBtn: {
    flex: 1, paddingVertical: 14,
    backgroundColor: COLORS.surface, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border, alignItems: "center",
  },
  homeBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  bookingsBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, backgroundColor: PURPLE, borderRadius: RADIUS.lg, paddingVertical: 14,
  },
  bookingsBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },

  directionsBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#16A34A", borderRadius: RADIUS.lg,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  directionsBtnText: { fontSize: 11, fontFamily: FONTS.bold, color: "#fff" },
});
