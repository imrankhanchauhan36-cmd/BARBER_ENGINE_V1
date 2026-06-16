import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Platform, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

const DUMMY = [
  { id:"1", type:"booking", unread:true,  time:"2 min ago",  title:"Booking Confirmed",   msg:"Your appointment at The Glam House is confirmed for Today at 2:15 PM.", extra:"Booking ID: #BK72391", icon:"calendar-outline",           iconBg:"#F5F3FF", iconColor:PURPLE },
  { id:"2", type:"booking", unread:true,  time:"5 min ago",  title:"Payment Successful",  msg:"Payment of ₹840 was successful. Thank you for choosing GlamGo!",        icon:"checkmark-circle-outline",  iconBg:"#F0FDF4", iconColor:"#16A34A" },
  { id:"3", type:"booking", unread:true,  time:"10 min ago", title:"Slot Reserved",       msg:"We are holding your slot for 2 minutes. Complete your payment to confirm your booking.", icon:"time-outline", iconBg:"#FFF7ED", iconColor:"#D97706" },
  { id:"4", type:"offer",   unread:false, time:"1 hr ago",   title:"Flat 20% OFF",        msg:"Get 20% OFF on all services at premium salons. Use code: GLAM20\nValid till 31 May 2024", icon:"megaphone-outline", iconBg:"#F5F3FF", iconColor:PURPLE },
  { id:"5", type:"offer",   unread:false, time:"3 hr ago",   title:"Refer & Earn",        msg:"Refer your friends and earn ₹200 GlamGo Wallet cashback.", icon:"gift-outline", iconBg:"#F5F3FF", iconColor:PURPLE },
  { id:"6", type:"updates", unread:false, time:"Yesterday",  title:"Important Update",    msg:"We've updated our Cancellation Policy to serve you better.", icon:"information-circle-outline", iconBg:"#EFF6FF", iconColor:"#2563EB" },
  { id:"7", type:"booking", unread:false, time:"Yesterday",  title:"Appointment Reminder",msg:"Don't forget! Your appointment at Looks & Layers Salon is tomorrow at 11:00 AM.", icon:"notifications-outline", iconBg:"#F0FDF4", iconColor:"#16A34A" },
  { id:"8", type:"updates", unread:false, time:"Yesterday",  title:"Review Request",      msg:"How was your experience at The Luxe Studio? Tap to share your feedback.", icon:"star-outline", iconBg:"#FEFCE8", iconColor:"#EAB308" },
];

const TABS = ["All","Offers","Booking","Updates"];

export default function NotificationsScreen({ navigation }) {
  const [notifs,    setNotifs]    = useState(DUMMY);
  const [activeTab, setActiveTab] = useState("All");

  const filtered = notifs.filter(n => {
    if (activeTab === "All")     return true;
    if (activeTab === "Offers")  return n.type === "offer";
    if (activeTab === "Booking") return n.type === "booking";
    if (activeTab === "Updates") return n.type === "updates";
    return true;
  });

  const tabCount = (tab) => {
    if (tab === "All")     return notifs.length;
    if (tab === "Offers")  return notifs.filter(n => n.type === "offer").length;
    if (tab === "Booking") return notifs.filter(n => n.type === "booking").length;
    if (tab === "Updates") return notifs.filter(n => n.type === "updates").length;
    return 0;
  };

  const unreadCount = notifs.filter(n => n.unread).length;
  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, unread: false })));
  const markRead = (id) => setNotifs(prev => prev.map(n => n.id === id ? { ...n, unread: false } : n));

  const todayItems     = filtered.filter(n => n.time.includes("min") || n.time.includes("hr"));
  const yesterdayItems = filtered.filter(n => n.time === "Yesterday");

  const renderNotif = (item) => (
    <TouchableOpacity
      key={item.id}
      style={[styles.notifItem, item.unread && styles.notifItemUnread]}
      onPress={() => markRead(item.id)}
      activeOpacity={0.8}
    >
      <View style={[styles.notifIcon, { backgroundColor: item.iconBg }]}>
        <Ionicons name={item.icon} size={20} color={item.iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.notifTitleRow}>
          <Text style={[styles.notifTitle, item.unread && styles.notifTitleUnread]}>{item.title}</Text>
          <Text style={styles.notifTime}>{item.time}</Text>
        </View>
        <Text style={styles.notifMsg}>{item.msg}</Text>
        {item.extra ? <Text style={styles.notifExtra}>{item.extra}</Text> : null}
      </View>
      {item.unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity style={styles.iconBtn}
          onPress={() => navigation.navigate("NotificationSettings")}>
          <Ionicons name="settings-outline" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
      </View>

      {/* TABS */}
      <View style={styles.tabsRow}>
        {TABS.map(tab => {
          const isActive = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab}</Text>
              <View style={[styles.tabBadge, isActive && styles.tabBadgeActive]}>
                <Text style={[styles.tabBadgeText, isActive && styles.tabBadgeTextActive]}>{tabCount(tab)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* TODAY */}
        {todayItems.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Today</Text>
              {unreadCount > 0 && (
                <TouchableOpacity onPress={markAllRead}>
                  <Text style={styles.markAllText}>Mark all read</Text>
                </TouchableOpacity>
              )}
            </View>
            {todayItems.map(renderNotif)}
          </>
        )}

        {/* YESTERDAY */}
        {yesterdayItems.length > 0 && (
          <>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>Yesterday</Text>
            </View>
            {yesterdayItems.map(renderNotif)}
          </>
        )}

        {filtered.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={48} color={COLORS.border} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySub}>We'll notify you when something important arrives.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
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

  tabsRow: {
    flexDirection: "row", paddingHorizontal: 16, paddingVertical: 12, gap: 8,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  tab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS.full, backgroundColor: COLORS.surface,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  tabActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  tabText: { fontSize: 13, fontFamily: FONTS.medium, color: COLORS.text.secondary },
  tabTextActive: { color: "#fff", fontFamily: FONTS.bold },
  tabBadge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: COLORS.border, justifyContent: "center", alignItems: "center", paddingHorizontal: 4,
  },
  tabBadgeActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  tabBadgeText: { fontSize: 9, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  tabBadgeTextActive: { color: "#fff" },

  sectionHead: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  sectionLabel: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.secondary },
  markAllText: { fontSize: 12, fontFamily: FONTS.bold, color: PURPLE },

  notifItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  notifItemUnread: { backgroundColor: "#F5F3FF" },
  notifIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  notifTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  notifTitle: { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.text.secondary, flex: 1 },
  notifTitleUnread: { fontFamily: FONTS.bold, color: COLORS.text.primary },
  notifTime: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  notifMsg: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, lineHeight: 18 },
  notifExtra: { fontSize: 11, fontFamily: FONTS.medium, color: PURPLE, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE, marginTop: 6 },

  emptyBox: { alignItems: "center", paddingTop: 80, gap: 10 },
  emptyTitle: { fontSize: 17, fontFamily: FONTS.bold, color: COLORS.text.primary },
  emptySub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center", paddingHorizontal: 32 },
});
