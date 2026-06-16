import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function ReviewScreen({ navigation, route }) {
  // ✅ FIX: Pura data chain se yahan receive ho raha hai
  const { 
    salonName, 
    services, 
    totalPrice, 
    totalDuration, 
    startTime, 
    endTime, 
    chairId,
    selectedDate,
    selectedBarberName 
  } = route.params || {};

  const convenienceFee = 20;
  const finalAmount = (totalPrice || 0) + convenienceFee;

  return (
    <View style={styles.mainContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent />
      
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Review Booking</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          
          {/* SALON NAME */}
          <View style={styles.salonHeader}>
            <View style={styles.salonIconBox}>
                <Ionicons name="storefront" size={22} color="#8B1D1D" />
            </View>
            <View style={{marginLeft: 12}}>
                <Text style={styles.salonLabel}>BOOKING AT</Text>
                <Text style={styles.salonTitle}>{salonName || "Premium Salon"}</Text>
            </View>
          </View>

          {/* SERVICES CARD */}
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>Selected Services</Text>
            {services && services.map((item, index) => (
              <View key={index} style={[styles.serviceRow, index !== 0 && styles.borderTop]}>
                <View style={{flex: 1}}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>{item.duration} min</Text>
                </View>
                <Text style={styles.itemPrice}>₹{item.price}</Text>
              </View>
            ))}
          </View>

          {/* APPOINTMENT DETAILS */}
          <View style={styles.sectionCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Date & Time</Text>
              <TouchableOpacity onPress={() => navigation.navigate("SlotSelection")}><Text style={styles.editText}>Edit</Text></TouchableOpacity>
            </View>
            <View style={styles.infoRow}>
                <Ionicons name="calendar-outline" size={18} color="#8B1D1D" />
                <Text style={styles.infoText}>{selectedDate}</Text>
            </View>
            <View style={[styles.infoRow, {marginTop: 10}]}>
                <Ionicons name="time-outline" size={18} color="#8B1D1D" />
                <Text style={styles.infoText}>{startTime} - {endTime} ({chairId})</Text>
            </View>
          </View>

          {/* BARBER DETAILS */}
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>Barber</Text>
            <View style={styles.barberRow}>
                <View style={styles.avatarMini}><Ionicons name="person" size={18} color="#fff" /></View>
                <Text style={styles.barberName}>{selectedBarberName || "Any Expert"}</Text>
            </View>
          </View>

          {/* PRICE DETAILS */}
          <View style={styles.sectionCard}>
            <Text style={styles.cardTitle}>Price Summary</Text>
            <View style={styles.priceRow}><Text style={styles.priceLabel}>Items Total</Text><Text style={styles.priceVal}>₹{totalPrice}</Text></View>
            <View style={styles.priceRow}><Text style={styles.priceLabel}>Convenience Fee</Text><Text style={styles.priceVal}>₹{convenienceFee}</Text></View>
            <View style={[styles.priceRow, styles.finalPriceRow]}>
              <Text style={styles.totalLabel}>Grand Total</Text>
              <Text style={styles.totalVal}>₹{finalAmount}</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View>
            <Text style={styles.footerSub}>TOTAL PAYABLE</Text>
            <Text style={styles.footerAmount}>₹{finalAmount}</Text>
          </View>
          <TouchableOpacity 
            style={styles.payBtn}
            onPress={() => navigation.navigate("Payment", { ...route.params, totalPrice: finalAmount })}
          >
            <Text style={styles.payBtnText}>Proceed to Pay</Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#F9FAFB" },
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 10 : 10, paddingBottom: 15, backgroundColor: "#fff" },
  headerTitle: { fontSize: 18, fontWeight: "800" },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  content: { padding: 16 },
  salonHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 15, marginBottom: 16, borderWidth: 1, borderColor: '#EEE' },
  salonIconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF5F5', justifyContent: 'center', alignItems: 'center' },
  salonLabel: { fontSize: 9, fontWeight: '800', color: '#AAA' },
  salonTitle: { fontSize: 16, fontWeight: '800', color: '#111' },
  sectionCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#EEE" },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { fontSize: 11, fontWeight: "800", color: "#888", textTransform: 'uppercase' },
  editText: { color: "#8B1D1D", fontWeight: "700", fontSize: 12 },
  serviceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  borderTop: { borderTopWidth: 1, borderTopColor: '#F7F7F7' },
  itemName: { fontSize: 15, fontWeight: '700' },
  itemMeta: { fontSize: 12, color: '#999' },
  itemPrice: { fontSize: 15, fontWeight: '700' },
  infoRow: { flexDirection: 'row', alignItems: 'center' },
  infoText: { marginLeft: 10, fontSize: 14, fontWeight: '600', color: '#444' },
  barberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  avatarMini: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#8B1D1D', justifyContent: 'center', alignItems: 'center' },
  barberName: { marginLeft: 10, fontSize: 15, fontWeight: '700' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  priceLabel: { fontSize: 14, color: '#666' },
  priceVal: { fontSize: 14, fontWeight: '700' },
  finalPriceRow: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#EEE' },
  totalLabel: { fontSize: 16, fontWeight: '800' },
  totalVal: { fontSize: 20, fontWeight: '900', color: '#8B1D1D' },
  footer: { padding: 20, backgroundColor: "#fff", flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#EEE' },
  footerSub: { fontSize: 10, color: '#999', fontWeight: '800' },
  footerAmount: { fontSize: 24, fontWeight: '900' },
  payBtn: { backgroundColor: "#8B1D1D", paddingVertical: 14, paddingHorizontal: 20, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  payBtnText: { color: "#fff", fontSize: 16, fontWeight: "800", marginRight: 5 }
});