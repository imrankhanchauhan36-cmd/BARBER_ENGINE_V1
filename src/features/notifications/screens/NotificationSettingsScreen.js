import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, StatusBar, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

const SettingRow = ({ title, subtitle, value, onToggle }) => (
  <View style={styles.settingRow}>
    <View style={{ flex: 1 }}>
      <Text style={styles.settingTitle}>{title}</Text>
      {subtitle ? <Text style={styles.settingSub}>{subtitle}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onToggle}
      trackColor={{ false: COLORS.border, true: PURPLE }}
      thumbColor="#fff"
      ios_backgroundColor={COLORS.border}
    />
  </View>
);

export default function NotificationSettingsScreen({ navigation }) {
  const [settings, setSettings] = useState({
    bookingConfirmations: true,
    bookingReminders: true,
    rescheduleUpdates: true,
    cancellationUpdates: true,
    specialOffers: true,
    newSalonOffers: true,
    referralRewards: false,
    accountUpdates: true,
    paymentUpdates: true,
    productUpdates: false,
    pushNotifications: true,
    emailNotifications: false,
  });

  const toggle = (key) => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification Settings</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* INFO BANNER */}
        <View style={styles.infoBanner}>
          <View style={styles.infoIcon}>
            <Ionicons name="notifications-outline" size={22} color={PURPLE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Manage what notifications you want to receive</Text>
            <Text style={styles.infoSub}>Stay updated with important alerts and offers</Text>
          </View>
        </View>

        {/* BOOKING NOTIFICATIONS */}
        <Text style={styles.sectionTitle}>Booking Notifications</Text>
        <View style={styles.settingsCard}>
          <SettingRow title="Booking Confirmations" subtitle="Receive alerts for confirmed bookings"
            value={settings.bookingConfirmations} onToggle={() => toggle("bookingConfirmations")} />
          <View style={styles.divider} />
          <SettingRow title="Booking Reminders" subtitle="Get reminded before your appointment"
            value={settings.bookingReminders} onToggle={() => toggle("bookingReminders")} />
          <View style={styles.divider} />
          <SettingRow title="Reschedule Updates" subtitle="Alerts for rescheduled appointments"
            value={settings.rescheduleUpdates} onToggle={() => toggle("rescheduleUpdates")} />
          <View style={styles.divider} />
          <SettingRow title="Cancellation Updates" subtitle="Receive alerts for cancellations"
            value={settings.cancellationUpdates} onToggle={() => toggle("cancellationUpdates")} />
        </View>

        {/* OFFERS */}
        <Text style={styles.sectionTitle}>Offers & Promotions</Text>
        <View style={styles.settingsCard}>
          <SettingRow title="Special Offers" subtitle="Discounts, offers and deals"
            value={settings.specialOffers} onToggle={() => toggle("specialOffers")} />
          <View style={styles.divider} />
          <SettingRow title="New Salon Offers" subtitle="Updates on new salon offers"
            value={settings.newSalonOffers} onToggle={() => toggle("newSalonOffers")} />
          <View style={styles.divider} />
          <SettingRow title="Referral & Rewards" subtitle="Referral updates and reward notifications"
            value={settings.referralRewards} onToggle={() => toggle("referralRewards")} />
        </View>

        {/* ACCOUNT */}
        <Text style={styles.sectionTitle}>Account & Updates</Text>
        <View style={styles.settingsCard}>
          <SettingRow title="Account Updates" subtitle="Important updates to your account"
            value={settings.accountUpdates} onToggle={() => toggle("accountUpdates")} />
          <View style={styles.divider} />
          <SettingRow title="Payment Updates" subtitle="Alerts for payments and refunds"
            value={settings.paymentUpdates} onToggle={() => toggle("paymentUpdates")} />
          <View style={styles.divider} />
          <SettingRow title="Product Updates" subtitle="New features and app updates"
            value={settings.productUpdates} onToggle={() => toggle("productUpdates")} />
        </View>

        {/* GENERAL */}
        <Text style={styles.sectionTitle}>General</Text>
        <View style={styles.settingsCard}>
          <SettingRow title="Push Notifications" subtitle="Receive push notifications"
            value={settings.pushNotifications} onToggle={() => toggle("pushNotifications")} />
          <View style={styles.divider} />
          <SettingRow title="Email Notifications" subtitle="Notifications via email"
            value={settings.emailNotifications} onToggle={() => toggle("emailNotifications")} />
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#F8F8FF",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.surface, justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  headerTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.text.primary },

  infoBanner: {
    flexDirection: "row", alignItems: "center", gap: 12,
    margin: 16, padding: 14,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  infoIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  infoTitle: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  infoSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },

  sectionTitle: {
    fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary,
    marginHorizontal: 16, marginBottom: 10, marginTop: 4,
  },
  settingsCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  settingRow: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  settingTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  settingSub:   { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: COLORS.border, marginLeft: 16 },
});
