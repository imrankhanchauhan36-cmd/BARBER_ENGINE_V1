//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/HomeUpcomingAppointment.js — NEW ✅
// IC Salons style — Upcoming Appointment banner
//////////////////////////////////////////////////////

import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS, SHADOWS } from "../../../config/theme";

export default function HomeUpcomingAppointment({ booking, onTrack }) {
  if (!booking) return null;

  const salonName   = booking.salonRef?.basicInfo?.shopName || "Salon";
  const serviceName = booking.serviceRefs?.[0]?.name || "Service";
  const date        = booking.date || "";
  const slot        = booking.slot || "";

  // Format date — "Today", "Tomorrow", or date string
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const bookingDate = new Date(dateStr);
    const today       = new Date();
    const tomorrow    = new Date();
    tomorrow.setDate(today.getDate() + 1);

    if (bookingDate.toDateString() === today.toDateString())     return "Today";
    if (bookingDate.toDateString() === tomorrow.toDateString())  return "Tomorrow";
    return bookingDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  };

  const dateLabel = formatDate(date);

  // Status color
  const STATUS_CONFIG = {
    CONFIRMED: { label: "Confirmed", color: COLORS.success,  bg: COLORS.successLight },
    HOLD:      { label: "On Hold",   color: COLORS.warning,  bg: COLORS.warningLight },
    CHECKED_IN:{ label: "Checked In",color: COLORS.info,     bg: COLORS.infoLight    },
    ONGOING:   { label: "Ongoing",   color: COLORS.primary,  bg: COLORS.primaryLight },
  };
  const statusCfg = STATUS_CONFIG[booking.status] || STATUS_CONFIG.CONFIRMED;

  return (
    <TouchableOpacity
      style={styles.wrapper}
      onPress={onTrack}
      activeOpacity={0.92}
    >
      {/* Left icon */}
      <View style={styles.iconBox}>
        <Ionicons name="calendar" size={22} color={COLORS.primary} />
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.label}>Upcoming Appointment</Text>
        <Text style={styles.dateTime}>
          {dateLabel}{slot ? `, ${slot}` : ""}
        </Text>
        <Text style={styles.salonService} numberOfLines={1}>
          {salonName} • {serviceName}
        </Text>
      </View>

      {/* Status + Track */}
      <View style={styles.right}>
        <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg }]}>
          <Text style={[styles.statusText, { color: statusCfg.color }]}>
            {statusCfg.label}
          </Text>
        </View>
        <View style={styles.trackRow}>
          <Text style={styles.trackText}>Track Booking</Text>
          <Ionicons name="arrow-forward" size={12} color={COLORS.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 18,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    padding: 12,
    gap: 12,
    ...SHADOWS.card,
  },
  iconBox: {
    width: 30, height: 30,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primaryLight,
    justifyContent: "center",
    alignItems: "center",
  },
  info: { flex: 1, gap: 2 },
  label: {
    fontSize: 10,
    fontFamily: FONTS.medium,
    color: COLORS.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dateTime: {
    fontSize: 14,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
  },
  salonService: {
    fontSize: 14,
    fontFamily: FONTS.regular,
    color: COLORS.text.secondary,
  },
  right: {
    alignItems: "flex-end",
    gap: 6,
  },
  statusBadge: {
    borderRadius: RADIUS.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 12,
    fontFamily: FONTS.bold,
  },
  trackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trackText: {
    fontSize: 10,
    fontFamily: FONTS.medium,
    color: COLORS.primary,
  },
});