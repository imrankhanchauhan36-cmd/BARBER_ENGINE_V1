import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Platform, ScrollView, FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

const TRANSACTIONS = [
  {
    group: "Today, 24 May 2025",
    items: [
      { id:"1", title:"Money Added",               sub:"Added via UPI",              amount:"+₹1,000.00", time:"10:30 AM", type:"credit", icon:"add-circle-outline",    iconBg:"#F5F3FF", iconColor:PURPLE },
      { id:"2", title:"Payment to The Glam House", sub:"Booking ID: #GM7865",        amount:"-₹299.00",   time:"10:15 AM", type:"debit",  icon:"business-outline",      iconBg:"#FEE2E2", iconColor:"#EF4444" },
      { id:"3", title:"GlamGo Cashback",           sub:"Cashback for booking",       amount:"+₹80.00",    time:"09:45 AM", type:"credit", icon:"gift-outline",          iconBg:"#F0FDF4", iconColor:"#16A34A" },
    ],
  },
  {
    group: "Yesterday, 23 May 2025",
    items: [
      { id:"4", title:"Money Added",                    sub:"Added via Credit Card", amount:"+₹500.00",  time:"07:20 PM", type:"credit", icon:"add-circle-outline",    iconBg:"#F5F3FF", iconColor:PURPLE },
      { id:"5", title:"Offer Applied",                  sub:"Welcome offer",         amount:"-₹75.00",   time:"07:18 PM", type:"debit",  icon:"pricetag-outline",      iconBg:"#FEE2E2", iconColor:"#EF4444" },
      { id:"6", title:"Payment to Looks & Layers Salon",sub:"Booking ID: #LL5421",  amount:"-₹249.00",  time:"06:45 PM", type:"debit",  icon:"business-outline",      iconBg:"#FEE2E2", iconColor:"#EF4444" },
    ],
  },
  {
    group: "22 May 2025",
    items: [
      { id:"7", title:"Refund Received",              sub:"Booking ID: #ST1234",     amount:"+₹249.00",  time:"08:30 PM", type:"credit", icon:"refresh-circle-outline", iconBg:"#F0FDF4", iconColor:"#16A34A" },
      { id:"8", title:"Payment to Style Square Salon",sub:"Booking ID: #SS9087",    amount:"-₹399.00",  time:"05:10 PM", type:"debit",  icon:"business-outline",       iconBg:"#FEE2E2", iconColor:"#EF4444" },
      { id:"9", title:"GlamGo Cashback",              sub:"Cashback for booking",    amount:"+₹60.00",   time:"02:30 PM", type:"credit", icon:"gift-outline",           iconBg:"#F0FDF4", iconColor:"#16A34A" },
    ],
  },
];

const TABS = ["All", "Added", "Spent", "Refunded", "Cashback"];

export default function TransactionHistoryScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState("All");

  const filterItems = (items) => {
    if (activeTab === "All") return items;
    if (activeTab === "Added")    return items.filter(i => i.title.includes("Money Added"));
    if (activeTab === "Spent")    return items.filter(i => i.title.includes("Payment"));
    if (activeTab === "Refunded") return items.filter(i => i.title.includes("Refund"));
    if (activeTab === "Cashback") return items.filter(i => i.title.includes("Cashback"));
    return items;
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Transaction History</Text>
          <Text style={styles.headerSub}>All your wallet transactions in one place</Text>
        </View>
        <TouchableOpacity style={styles.filterBtn}>
          <Ionicons name="filter-outline" size={16} color={PURPLE} />
          <Text style={styles.filterBtnText}>Filter</Text>
        </TouchableOpacity>
      </View>

      {/* BALANCE CARD */}
      <View style={styles.balanceCard}>
        <View style={styles.balanceLeft}>
          <View style={styles.balanceIcon}>
            <Ionicons name="wallet-outline" size={22} color={PURPLE} />
          </View>
          <View>
            <Text style={styles.balanceLabel}>Current Wallet Balance</Text>
            <Text style={styles.balanceAmount}>₹560.00</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.addMoneyBtn}
          onPress={() => navigation.navigate("AddMoney")}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addMoneyText}>Add Money</Text>
        </TouchableOpacity>
      </View>

      {/* TABS */}
      <View style={styles.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsList}>
          {TABS.map(tab => {
            const isActive = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* TRANSACTIONS */}
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {TRANSACTIONS.map((group, gi) => {
          const filtered = filterItems(group.items);
          if (filtered.length === 0) return null;
          return (
            <View key={gi}>
              <Text style={styles.groupLabel}>{group.group}</Text>
              <View style={styles.groupCard}>
                {filtered.map((item, ii) => (
                  <View key={item.id}>
                    {ii > 0 && <View style={styles.divider} />}
                    <View style={styles.txnRow}>
                      <View style={[styles.txnIcon, { backgroundColor: item.iconBg }]}>
                        <Ionicons name={item.icon} size={20} color={item.iconColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txnTitle}>{item.title}</Text>
                        <Text style={styles.txnSub}>{item.sub}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.txnAmount, { color: item.type === "credit" ? "#16A34A" : "#EF4444" }]}>
                          {item.amount}
                        </Text>
                        <Text style={styles.txnTime}>{item.time}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}

        {/* INFO NOTE */}
        <View style={styles.infoNote}>
          <Ionicons name="information-circle-outline" size={14} color={PURPLE} />
          <Text style={styles.infoNoteText}>Transactions may take up to 10 minutes to reflect in your wallet.</Text>
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
    flexDirection: "row", alignItems: "center", gap: 12,
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
  headerSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  filterBtn: {
    marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  filterBtnText: { fontSize: 13, fontFamily: FONTS.medium, color: PURPLE },

  balanceCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    margin: 16, padding: 16,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  balanceLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  balanceIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#EDE9FE", justifyContent: "center", alignItems: "center",
  },
  balanceLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  balanceAmount: { fontSize: 22, fontFamily: FONTS.bold, color: COLORS.text.primary },
  addMoneyBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: PURPLE, borderRadius: RADIUS.lg,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  addMoneyText: { fontSize: 13, fontFamily: FONTS.bold, color: "#fff" },

  tabsWrap: {
    backgroundColor: COLORS.background,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  tabsList: { paddingHorizontal: 16, paddingVertical: 12, gap: 24 },
  tab: { paddingBottom: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: PURPLE },
  tabText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  tabTextActive: { fontFamily: FONTS.bold, color: PURPLE },

  groupLabel: {
    fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.secondary,
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  groupCard: {
    marginHorizontal: 16,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  txnRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  txnIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: "center", alignItems: "center" },
  txnTitle: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  txnSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  txnAmount: { fontSize: 14, fontFamily: FONTS.bold },
  txnTime:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 2 },
  divider: { height: 0.5, backgroundColor: COLORS.border, marginLeft: 68 },

  infoNote: {
    flexDirection: "row", alignItems: "center", gap: 8,
    margin: 16, padding: 12,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.md,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  infoNoteText: { fontSize: 11, fontFamily: FONTS.regular, color: PURPLE, flex: 1 },
});
