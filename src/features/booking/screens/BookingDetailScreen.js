import React, { useState, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, ScrollView, Platform, Alert,
} from "react-native";
import apiClient from "../../../shared/api/client";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, FONTS } from "../../../config/theme";

//////////////////////////////////////////////////////
// HELPERS
//////////////////////////////////////////////////////

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const formatDate = (isoStr) => {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

const formatTime = (isoStr) => {
  if (!isoStr) return "--";
  const d = new Date(isoStr);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
};

const STATUS_CONFIG = {
  CONFIRMED:  { label: "Confirmed",  color: "#16A34A", bg: "#DCFCE7" },
  CHECKED_IN: { label: "Checked In", color: "#1D4ED8", bg: "#DBEAFE" },
  ONGOING:    { label: "Ongoing",    color: "#5B21B6", bg: "#EDE9FE" },
  COMPLETED:  { label: "Completed",  color: "#374151", bg: "#F3F4F6" },
  CANCELLED:  { label: "Cancelled",  color: "#991B1B", bg: "#FEE2E2" },
  NO_SHOW:    { label: "No Show",    color: "#9A3412", bg: "#FFF7ED" },
  HOLD:       { label: "Pending",    color: "#854D0E", bg: "#FEF9C3" },
  EXPIRED:    { label: "Expired",    color: "#9CA3AF", bg: "#F3F4F6" },
};

//////////////////////////////////////////////////////
// REFUND POLICY CALCULATOR
//////////////////////////////////////////////////////

const getRefundPolicy = (startTime, totalPaise) => {
  const now       = new Date();
  const start     = new Date(startTime);
  const minsUntil = (start - now) / (1000 * 60);
  const totalRs   = Math.round(totalPaise / 100);

  if (minsUntil >= 120) {
    return {
      policy:    "FULL_REFUND",
      label:     "Full Refund",
      refundRs:  totalRs,
      color:     "#16A34A",
      bg:        "#DCFCE7",
      message:   `You'll get ₹${totalRs} back`,
    };
  } else if (minsUntil >= 30) {
    const refund = Math.round(totalRs * 0.5);
    return {
      policy:    "HALF_REFUND",
      label:     "50% Refund",
      refundRs:  refund,
      color:     "#D97706",
      bg:        "#FEF3C7",
      message:   `You'll get ₹${refund} back (50%)`,
    };
  } else if (minsUntil > 0) {
    return {
      policy:    "NO_REFUND",
      label:     "No Refund",
      refundRs:  0,
      color:     "#DC2626",
      bg:        "#FEE2E2",
      message:   "Cancellation within 30 min — no refund",
    };
  } else {
    return {
      policy:    "NO_REFUND",
      label:     "No Refund",
      refundRs:  0,
      color:     "#DC2626",
      bg:        "#FEE2E2",
      message:   "Booking time has passed",
    };
  }
};

//////////////////////////////////////////////////////
// SECTION COMPONENT
//////////////////////////////////////////////////////

function Section({ title, icon, open, onPress, children }) {
  return (
    <View style={styles.section}>
      <TouchableOpacity onPress={onPress} style={styles.sectionHeader} activeOpacity={0.8}>
        <View style={styles.titleRow}>
          <View style={styles.sectionIconBox}>
            <Ionicons name={icon} size={16} color={COLORS.primary} />
          </View>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={COLORS.text.light} />
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

//////////////////////////////////////////////////////
// MAIN SCREEN
//////////////////////////////////////////////////////

export default function BookingDetailScreen({ navigation, route }) {
  const { booking } = route.params || {};
  const [openSection, setOpenSection] = useState("salon");
  const [isCancelling, setIsCancelling] = useState(false);

  const toggle = (key) => setOpenSection(openSection === key ? null : key);

  const refundPolicy = useMemo(() => {
    if (booking?.status !== "CONFIRMED") return null;
    return getRefundPolicy(booking.startTime, booking.totalAmountInPaise || 0);
  }, [booking]);

  if (!booking) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
            <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Booking Detail</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>Booking not found</Text>
        </View>
      </View>
    );
  }

  const status     = STATUS_CONFIG[booking.status] || STATUS_CONFIG.HOLD;
  const salonName  = booking.salonRef?.basicInfo?.shopName || "Salon";
  const address    = booking.salonRef?.location?.address || "";
  const services   = booking.serviceRefs || [];
  const totalPrice = services.reduce((sum, s) => sum + (s.price || 0), 0);
  const bookingId  = booking._id?.toString().slice(-8).toUpperCase();

  //////////////////////////////////////////////////////
  // CANCEL HANDLER
  //////////////////////////////////////////////////////

  const handleCancel = () => {
    if (!refundPolicy) return;

    Alert.alert(
      "Cancel Booking?",
      `${refundPolicy.message}\n\nAre you sure you want to cancel?`,
      [
        { text: "Keep Booking", style: "cancel" },
        {
          text: "Cancel Booking",
          style: "destructive",
          onPress: async () => {
            setIsCancelling(true);
            try {
              const res = await apiClient.post("/api/v1/bookings/user/cancel", {
                bookingId: booking._id,
              });
              if (res?.data?.success) {
                const refundMsg = res.data.refundAmountRupees > 0
                  ? `\n₹${res.data.refundAmountRupees} will be refunded.`
                  : "\nNo refund applicable.";
                Alert.alert(
                  "Booking Cancelled",
                  `Your booking has been cancelled.${refundMsg}`,
                  [{ text: "OK", onPress: () => navigation.goBack() }]
                );
              } else {
                Alert.alert("Error", res?.data?.message || "Could not cancel.");
              }
            } catch (err) {
              Alert.alert("Error", "Something went wrong. Please try again.");
            } finally {
              setIsCancelling(false);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Booking Detail</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >

        {/* ── STATUS CARD ── */}
        <View style={styles.statusCard}>
          <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: status.color }]} />
            <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={styles.bookingIdText}>#{bookingId}</Text>

          <View style={styles.dateTimeRow}>
            <View style={styles.dateTimeItem}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.text.secondary} />
              <Text style={styles.dateTimeText}>{formatDate(booking.startTime)}</Text>
            </View>
            <View style={styles.dateTimeDivider} />
            <View style={styles.dateTimeItem}>
              <Ionicons name="time-outline" size={14} color={COLORS.text.secondary} />
              <Text style={styles.dateTimeText}>
                {formatTime(booking.startTime)} – {formatTime(booking.endTime)}
              </Text>
            </View>
          </View>

          {/* OTP note — only for CONFIRMED */}
          {booking.status === "CONFIRMED" && (
            <View style={styles.otpCard}>
              <Text style={styles.otpLabel}>CHECK-IN OTP</Text>
              <Text style={styles.otpValue}>Check your booking confirmation</Text>
              <Text style={styles.otpNote}>OTP was shown when you confirmed your booking</Text>
            </View>
          )}
        </View>

        {/* ── REFUND POLICY CARD — only for CONFIRMED ── */}
        {booking.status === "CONFIRMED" && refundPolicy && (
          <View style={[styles.refundCard, { backgroundColor: refundPolicy.bg }]}>
            <View style={styles.refundRow}>
              <Ionicons name="information-circle-outline" size={18} color={refundPolicy.color} />
              <Text style={[styles.refundLabel, { color: refundPolicy.color }]}>
                Cancellation Policy
              </Text>
            </View>
            <Text style={[styles.refundPolicy, { color: refundPolicy.color }]}>
              {refundPolicy.label}
            </Text>
            <Text style={[styles.refundMessage, { color: refundPolicy.color }]}>
              {refundPolicy.message}
            </Text>
            <View style={styles.refundRules}>
              <Text style={styles.refundRuleText}>• 2+ hours before → Full refund</Text>
              <Text style={styles.refundRuleText}>• 30 min–2 hrs before → 50% refund</Text>
              <Text style={styles.refundRuleText}>• Less than 30 min → No refund</Text>
            </View>
          </View>
        )}

        {/* ── SALON SECTION ── */}
        <Section
          title="Salon & Location"
          icon="storefront-outline"
          open={openSection === "salon"}
          onPress={() => toggle("salon")}
        >
          <Text style={styles.salonName}>{salonName}</Text>
          {address ? <Text style={styles.addressText}>{address}</Text> : null}
        </Section>

        {/* ── SERVICES SECTION ── */}
        <Section
          title={`Services (${services.length})`}
          icon="cut-outline"
          open={openSection === "services"}
          onPress={() => toggle("services")}
        >
          {services.map((s, i) => (
            <View key={i} style={styles.rowBetween}>
              <Text style={styles.rowLabel}>{s.name}</Text>
              <Text style={styles.rowValue}>₹{s.price}</Text>
            </View>
          ))}
        </Section>

        {/* ── PAYMENT SECTION ── */}
        <Section
          title="Payment Details"
          icon="receipt-outline"
          open={openSection === "payment"}
          onPress={() => toggle("payment")}
        >
          {services.map((s, i) => (
            <View key={i} style={styles.rowBetween}>
              <Text style={styles.rowLabel}>{s.name}</Text>
              <Text style={styles.rowValue}>₹{s.price}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.rowBetween}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>₹{totalPrice}</Text>
          </View>
          <View style={styles.paidBadge}>
            <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
            <Text style={styles.paidText}>Payment Successful</Text>
          </View>
        </Section>

        {/* ── CANCEL BUTTON — only for CONFIRMED ── */}
        {booking.status === "CONFIRMED" && (
          <TouchableOpacity
            style={[styles.cancelBtn, isCancelling && { opacity: 0.6 }]}
            activeOpacity={0.8}
            onPress={handleCancel}
            disabled={isCancelling}
          >
            <Ionicons name="close-circle-outline" size={18} color={COLORS.danger} />
            <Text style={styles.cancelBtnText}>
              {isCancelling ? "Cancelling..." : "Cancel Booking"}
            </Text>
          </TouchableOpacity>
        )}

      </ScrollView>
    </View>
  );
}

//////////////////////////////////////////////////////
// STYLES
//////////////////////////////////////////////////////

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  iconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface,
    justifyContent: "center", alignItems: "center",
  },
  headerTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  centerBox:   { flex: 1, justifyContent: "center", alignItems: "center" },
  centerText:  { fontSize: 14, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  statusCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
    padding: 16, marginBottom: 12, alignItems: "center",
  },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: RADIUS.full, marginBottom: 8,
  },
  statusDot:      { width: 6, height: 6, borderRadius: 3 },
  statusText:     { fontSize: 12, fontFamily: FONTS.bold },
  bookingIdText:  { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.light, marginBottom: 14 },
  dateTimeRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.background,
    borderRadius: RADIUS.md, padding: 12, gap: 12, width: "100%",
  },
  dateTimeItem:    { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dateTimeDivider: { width: 1, height: 20, backgroundColor: COLORS.border },
  dateTimeText:    { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.primary },

  otpCard: {
    marginTop: 14, width: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg, padding: 16, alignItems: "center",
  },
  otpLabel: { fontSize: 10, fontFamily: FONTS.bold, color: "rgba(255,255,255,0.7)", letterSpacing: 1.5, marginBottom: 6 },
  otpValue: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff", marginBottom: 6, textAlign: "center" },
  otpNote:  { fontSize: 11, fontFamily: FONTS.regular, color: "rgba(255,255,255,0.7)", textAlign: "center" },

  // refund policy card
  refundCard: {
    borderRadius: RADIUS.lg, padding: 14,
    marginBottom: 12, gap: 4,
  },
  refundRow:    { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  refundLabel:  { fontSize: 12, fontFamily: FONTS.bold },
  refundPolicy: { fontSize: 16, fontFamily: FONTS.bold, marginBottom: 2 },
  refundMessage:{ fontSize: 13, fontFamily: FONTS.medium, marginBottom: 8 },
  refundRules:  { gap: 3 },
  refundRuleText: { fontSize: 11, fontFamily: FONTS.regular, color: "#6B7280" },

  section: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
    marginBottom: 12, overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", padding: 16,
  },
  titleRow:      { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionIconBox:{
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: COLORS.primaryLight,
    justifyContent: "center", alignItems: "center",
  },
  sectionTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  sectionBody:  { paddingHorizontal: 16, paddingBottom: 16 },

  salonName:   { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 6 },
  addressText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, lineHeight: 18 },

  rowBetween: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 8,
  },
  rowLabel:   { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  rowValue:   { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  divider:    { height: 0.5, backgroundColor: COLORS.border, marginVertical: 10 },
  totalLabel: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  totalValue: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.primary },
  paidBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 10, backgroundColor: COLORS.successLight,
    borderRadius: RADIUS.full, paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: "flex-start",
  },
  paidText: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.success },

  cancelBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderWidth: 1.5, borderColor: COLORS.danger,
    borderRadius: RADIUS.lg, padding: 14, marginTop: 4,
  },
  cancelBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.danger },
});