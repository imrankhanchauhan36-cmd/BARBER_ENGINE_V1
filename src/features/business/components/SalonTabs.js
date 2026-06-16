//////////////////////////////////////////////////////
// SalonServicesTab.js
//////////////////////////////////////////////////////
import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

export function SalonServicesTab({ services, onBook = null }) {
  if (!services || services.length === 0) {
    return (
      <View style={styles.emptyBox}>
        <Ionicons name="cut-outline" size={40} color={COLORS.text.light} />
        <Text style={styles.emptyTitle}>No services yet</Text>
        <Text style={styles.emptySub}>This salon hasn't added services</Text>
      </View>
    );
  }

  const grouped = services.reduce((acc, s) => {
    const cat = s.category || "GENERAL";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  return (
    <View style={styles.wrapper}>
      {Object.entries(grouped).map(([cat, catServices]) => (
        <View key={cat} style={styles.group}>
          <Text style={styles.groupLabel}>{cat}</Text>
          {catServices.map(s => (
            <View key={s._id} style={styles.serviceCard}>
              <View style={styles.serviceLeft}>
                <Text style={styles.serviceName}>{s.name}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="time-outline" size={12} color={COLORS.text.secondary} />
                  <Text style={styles.metaText}>{s.duration} mins</Text>
                  {s.description ? (
                    <Text style={styles.metaText} numberOfLines={1}>· {s.description}</Text>
                  ) : null}
                </View>
              </View>
              <View style={styles.serviceRight}>
                <Text style={styles.price}>₹{s.price}</Text>
              </View>
            </View>
          ))}
        </View>
      ))}

      {onBook && (
        <TouchableOpacity style={styles.bookBtn} onPress={onBook} activeOpacity={0.85}>
          <Text style={styles.bookBtnText}>Book Now</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

//////////////////////////////////////////////////////
// SalonTimingsTab.js
//////////////////////////////////////////////////////
export function SalonTimingsTab({ timings }) {
  const today = new Date().toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];

  return (
    <View style={styles.timingsCard}>
      {days.map(day => {
        const t = timings?.[day];
        const isToday = day === today;
        return (
          <View key={day} style={[styles.timingRow, isToday && styles.timingRowToday]}>
            <View style={styles.timingLeft}>
              {isToday && <View style={styles.todayDot} />}
              <Text style={[styles.timingDay, isToday && styles.timingDayToday]}>
                {day.charAt(0).toUpperCase() + day.slice(1)}
              </Text>
              {isToday && <Text style={styles.todayLabel}>Today</Text>}
            </View>
            <Text style={[
              styles.timingTime,
              t?.isClosed && { color: COLORS.danger },
              isToday && !t?.isClosed && { color: COLORS.success, fontFamily: "Poppins-Bold" },
            ]}>
              {t?.isClosed ? "Closed" : `${t?.open || "--"} – ${t?.close || "--"}`}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

//////////////////////////////////////////////////////
// SalonAboutTab.js
//////////////////////////////////////////////////////
export function SalonAboutTab({ salon }) {
  const salonType = salon?.basicInfo?.salonType || "";
  const category  = salon?.basicInfo?.category  || "";
  const since     = salon?.basicInfo?.since     || "";
  const address   = salon?.location?.address    || "";
  const setupType = salon?.basicInfo?.setupType || "";

  const rows = [
    { icon: "storefront-outline", label: "Salon type",   value: `${salonType} · ${category}`, show: !!(salonType || category) },
    { icon: "calendar-outline",   label: "Established",  value: since,                          show: !!since },
    { icon: "location-outline",   label: "Address",      value: address,                        show: !!address },
    { icon: "build-outline",      label: "Setup",        value: setupType.replace(/_/g, " "),   show: !!setupType },
  ];

  return (
    <View style={styles.aboutCard}>
      {rows.filter(r => r.show).map((row, i) => (
        <View key={i} style={[styles.aboutRow, i === rows.filter(r => r.show).length - 1 && { borderBottomWidth: 0 }]}>
          <View style={styles.aboutIconBox}>
            <Ionicons name={row.icon} size={17} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.aboutLabel}>{row.label}</Text>
            <Text style={styles.aboutValue}>{row.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

//////////////////////////////////////////////////////
// STYLES (shared)
//////////////////////////////////////////////////////
const styles = StyleSheet.create({
  // Services
  wrapper: { paddingBottom: 16 },
  emptyBox: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Poppins-Bold", color: COLORS.text.secondary },
  emptySub:   { fontSize: 13, fontFamily: "Poppins-Regular", color: COLORS.text.light },
  group:      { marginBottom: 20 },
  groupLabel: {
    fontSize: 11, fontFamily: "Poppins-Bold",
    color: COLORS.text.secondary,
    textTransform: "uppercase", letterSpacing: 1,
    marginBottom: 10,
  },
  serviceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0,
    padding: 14,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  serviceLeft:  { flex: 1 },
  serviceRight: { alignItems: "flex-end" },
  serviceName:  { fontSize: 14, fontFamily: "Poppins-Bold", color: COLORS.text.primary, textTransform: "capitalize" },
  metaRow:      { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  metaText:     { fontSize: 11, fontFamily: "Poppins-Regular", color: COLORS.text.secondary },
  price:        { fontSize: 17, fontFamily: "Poppins-Bold", color: COLORS.primary },
  bookBtn: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.lg,
    paddingVertical: 15,
    marginTop: 8,
  },
  bookBtnText: { color: "#fff", fontSize: 16, fontFamily: "Poppins-Bold" },

  // Timings
  timingsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  timingRow: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  timingRowToday: { backgroundColor: COLORS.primaryLight },
  timingLeft:     { flexDirection: "row", alignItems: "center", gap: 8 },
  todayDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.primary },
  timingDay:      { fontSize: 14, fontFamily: "Poppins-Medium", color: COLORS.text.primary },
  timingDayToday: { fontFamily: "Poppins-Bold", color: COLORS.primary },
  todayLabel:     { fontSize: 10, fontFamily: "Poppins-Bold", color: COLORS.primary, backgroundColor: COLORS.primaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  timingTime:     { fontSize: 13, fontFamily: "Poppins-Medium", color: COLORS.text.secondary },

  // About
  aboutCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 0.5,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  aboutRow: {
    flexDirection: "row", alignItems: "flex-start",
    gap: 12, padding: 14,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  aboutIconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: COLORS.primaryLight,
    justifyContent: "center", alignItems: "center",
  },
  aboutLabel: {
    fontSize: 10, fontFamily: "Poppins-Medium",
    color: COLORS.text.secondary,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3,
  },
  aboutValue: { fontSize: 14, fontFamily: "Poppins-Medium", color: COLORS.text.primary },
});