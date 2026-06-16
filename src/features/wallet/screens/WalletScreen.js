import React from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Platform, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

const QUICK_ACTIONS = [
  { icon: "add-circle-outline",    label: "Add Money",     route: "AddMoney" },
  { icon: "paper-plane-outline",   label: "Send Money",    route: null },
  { icon: "pricetag-outline",      label: "Apply Coupon",  route: null },
  { icon: "gift-outline",          label: "View Offers",   route: null },
];

const SUMMARY = [
  { icon: "wallet-outline",   label: "Total Balance",    value: "₹560.00", color: COLORS.text.primary },
  { icon: "gift-outline",     label: "Bonus Balance",    value: "₹120.00", color: "#16A34A" },
  { icon: "refresh-outline",  label: "GlamGo Cashback",  value: "₹80.00",  color: PURPLE },
];

export default function WalletScreen({ navigation }) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Wallet</Text>
        <TouchableOpacity onPress={() => navigation.navigate("TransactionHistory")}>
          <Text style={styles.txnText}>Transaction History</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 80 }}>

        {/* BALANCE CARD */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceCardLeft}>
            <View style={styles.balanceHeader}>
              <Text style={styles.walletName}>GlamGo Wallet</Text>
              <View style={styles.shieldIcon}>
                <Ionicons name="shield-checkmark-outline" size={16} color="#fff" />
              </View>
            </View>
            <Text style={styles.balanceLabel}>Available Balance</Text>
            <Text style={styles.balanceAmount}>₹560.00</Text>
            <TouchableOpacity style={styles.addMoneyBtn}
              onPress={() => navigation.navigate("AddMoney")}>
              <Ionicons name="add" size={16} color={PURPLE} />
              <Text style={styles.addMoneyBtnText}>Add Money</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.walletIllustration}>
            <Ionicons name="wallet-outline" size={80} color="rgba(255,255,255,0.2)" />
          </View>
        </View>

        {/* QUICK ACTIONS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.quickActionsRow}>
            {QUICK_ACTIONS.map((action, i) => (
              <TouchableOpacity
                key={i}
                style={styles.quickAction}
                onPress={() => action.route && navigation.navigate(action.route)}
                activeOpacity={0.8}
              >
                <View style={styles.quickActionIcon}>
                  <Ionicons name={action.icon} size={22} color={PURPLE} />
                </View>
                <Text style={styles.quickActionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* OFFERS BANNER */}
        <View style={styles.offerBanner}>
          <View style={styles.offerBannerLeft}>
            <View style={styles.offerIconBox}>
              <Text style={{ fontSize: 32 }}>💰</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.offerTitle}>Exciting Offers Inside!</Text>
              <Text style={styles.offerSub}>Use your wallet balance and enjoy exclusive discounts</Text>
              <TouchableOpacity style={styles.exploreBtn}>
                <Text style={styles.exploreBtnText}>Explore Offers</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={PURPLE} />
        </View>

        {/* WALLET SUMMARY */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Wallet Summary</Text>
          <View style={styles.summaryCard}>
            {SUMMARY.map((item, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.divider} />}
                <View style={styles.summaryRow}>
                  <View style={styles.summaryLeft}>
                    <View style={styles.summaryIcon}>
                      <Ionicons name={item.icon} size={18} color={PURPLE} />
                    </View>
                    <Text style={styles.summaryLabel}>{item.label}</Text>
                  </View>
                  <Text style={[styles.summaryValue, { color: item.color }]}>{item.value}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* INFO BANNER */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={16} color={PURPLE} />
          <Text style={styles.infoText}>You can use your wallet balance while booking any service.</Text>
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
  txnText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Balance card
  balanceCard: {
    margin: 16, padding: 20,
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    flexDirection: "row", alignItems: "center",
  },
  balanceCardLeft: { flex: 1 },
  balanceHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  walletName: { fontSize: 16, fontFamily: FONTS.bold, color: "#fff" },
  shieldIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.2)", justifyContent: "center", alignItems: "center",
  },
  balanceLabel: { fontSize: 12, fontFamily: FONTS.regular, color: "rgba(255,255,255,0.7)", marginBottom: 4 },
  balanceAmount: { fontSize: 36, fontFamily: FONTS.bold, color: "#fff", marginBottom: 16 },
  addMoneyBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#fff", borderRadius: RADIUS.lg,
    paddingHorizontal: 20, paddingVertical: 10, alignSelf: "flex-start",
  },
  addMoneyBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: PURPLE },
  walletIllustration: { opacity: 0.3 },

  // Section
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 12 },

  // Quick actions
  quickActionsRow: {
    flexDirection: "row", justifyContent: "space-between",
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: COLORS.border,
  },
  quickAction: { alignItems: "center", gap: 8 },
  quickActionIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  quickActionLabel: { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.primary, textAlign: "center" },

  // Offers
  offerBanner: {
    flexDirection: "row", alignItems: "center",
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  offerBannerLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  offerIconBox: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  offerTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 4 },
  offerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginBottom: 8 },
  exploreBtn: {
    backgroundColor: PURPLE, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 7, alignSelf: "flex-start",
  },
  exploreBtnText: { fontSize: 12, fontFamily: FONTS.bold, color: "#fff" },

  // Summary
  summaryCard: {
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  summaryRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14,
  },
  summaryLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  summaryIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  summaryLabel: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.text.primary },
  summaryValue: { fontSize: 16, fontFamily: FONTS.bold },
  divider: { height: 0.5, backgroundColor: COLORS.border, marginLeft: 64 },

  // Info
  infoBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, padding: 14,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  infoText: { fontSize: 12, fontFamily: FONTS.regular, color: PURPLE, flex: 1 },
});
