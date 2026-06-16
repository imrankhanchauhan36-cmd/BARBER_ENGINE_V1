import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const PAYMENT_METHODS = [
  { id: 'upi', title: 'UPI', sub: 'Pay using any UPI app', icon: 'smartphone-outline' },
  { id: 'card', title: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay', icon: 'card-outline' },
  { id: 'wallet', title: 'Wallet', sub: 'Paytm, PhonePe, Amazon Pay', icon: 'wallet-outline' },
  { id: 'net', title: 'Net Banking', sub: 'All major banks supported', icon: 'globe-outline' },
];

export default function PaymentScreen({ navigation, route }) {
  const { totalPrice, salonName, selectedDate, startTime, selectedBarberName, services, totalDuration } = route.params || {};
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFinalPay = () => {
    if (!selectedMethod) {
      Alert.alert("Select Method", "Please select a digital payment method to confirm your booking.");
      return;
    }
    
    setLoading(true);

    // ✅ Payment Success Simulation
    setTimeout(() => {
      setLoading(false);
      
      // ✅ Seedha Success Screen par bhejna
      navigation.replace("BookingSuccess", {
        salonName,
        selectedDate,
        startTime,
        selectedBarberName,
        services,
        totalPrice,
        bookingId: "#BK" + Math.floor(100000 + Math.random() * 900000), // Random ID
        otp: Math.floor(1000 + Math.random() * 9000).toString() // Random 4 digit OTP
      });
    }, 2000);
  };

  return (
    <View style={styles.mainContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent />
      
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={26} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.amountBanner}>
            <Text style={styles.bannerLabel}>Total Amount to Pay</Text>
            <Text style={styles.bannerAmount}>₹{totalPrice}</Text>
          </View>

          <View style={styles.content}>
            <Text style={styles.sectionTitle}>Digital Payment Methods</Text>

            {PAYMENT_METHODS.map((item) => (
              <TouchableOpacity 
                key={item.id}
                style={[styles.methodCard, selectedMethod === item.id && styles.selectedCard]}
                onPress={() => setSelectedMethod(item.id)}
              >
                <View style={[styles.iconCircle, selectedMethod === item.id && {backgroundColor: '#8B1D1D'}]}>
                  <Ionicons name={item.icon} size={22} color={selectedMethod === item.id ? "#fff" : "#8B1D1D"} />
                </View>
                <View style={{ flex: 1, marginLeft: 15 }}>
                  <Text style={styles.methodTitle}>{item.title}</Text>
                  <Text style={styles.methodSub}>{item.sub}</Text>
                </View>
                <View style={[styles.radioCircle, selectedMethod === item.id && styles.radioSelected]}>
                    {selectedMethod === item.id && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            ))}

            <View style={styles.securityBox}>
                <Ionicons name="shield-checkmark" size={18} color="#10B981" />
                <Text style={styles.securityText}>
                    Booking will be generated only after successful payment. Your transaction is 100% encrypted.
                </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity 
            style={[styles.payBtn, (!selectedMethod || loading) && { backgroundColor: '#E5E7EB' }]} 
            onPress={handleFinalPay}
            disabled={!selectedMethod || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={[styles.payBtnText, !selectedMethod && { color: '#9CA3AF' }]}>
                    {selectedMethod ? `Confirm & Pay ₹${totalPrice}` : 'Select Payment Method'}
                </Text>
                {selectedMethod && <Ionicons name="arrow-forward" size={20} color="#fff" style={{marginLeft: 10}} />}
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#fff" },
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight + 10 : 10, paddingBottom: 15, borderBottomWidth: 1, borderColor: '#F3F4F6' },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#111" },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  amountBanner: { backgroundColor: "#8B1D1D", margin: 16, borderRadius: 20, padding: 25, alignItems: 'center', elevation: 5 },
  bannerLabel: { color: "#FFC1C1", fontSize: 13, fontWeight: '700', marginBottom: 5, textTransform: 'uppercase' },
  bannerAmount: { color: "#fff", fontSize: 40, fontWeight: "900" },
  content: { paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#111", marginBottom: 15, marginTop: 10 },
  methodCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "#F3F4F6", marginBottom: 12 },
  selectedCard: { borderColor: "#8B1D1D", backgroundColor: "#FFF9F9" },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFF5F5", justifyContent: 'center', alignItems: 'center' },
  methodTitle: { fontSize: 15, fontWeight: "700", color: "#111" },
  methodSub: { fontSize: 12, color: "#777", marginTop: 2 },
  radioCircle: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D1D5DB', justifyContent: 'center', alignItems: 'center' },
  radioSelected: { borderColor: '#8B1D1D' },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#8B1D1D' },
  securityBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0FDF4', padding: 15, borderRadius: 15, marginTop: 20, borderWidth: 1, borderColor: '#DCFCE7' },
  securityText: { flex: 1, marginLeft: 10, fontSize: 11, color: '#166534', fontWeight: '500', lineHeight: 16 },
  footer: { padding: 20, borderTopWidth: 1, borderColor: '#F3F4F6', backgroundColor: '#fff' },
  payBtn: { backgroundColor: "#8B1D1D", padding: 18, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 3 },
  payBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});