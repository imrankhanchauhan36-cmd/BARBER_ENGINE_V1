import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "../../../../constants/colors";
import Spacing from "../../../../constants/spacing";

const BARBERS = [
  { id: "any", name: "Any Available Barber", experience: "Best Available", rating: 4.6, recommended: true },
  { id: "1", name: "Rahul", experience: "5 years experience", rating: 4.7 },
  { id: "2", name: "Amit", experience: "3 years experience", rating: 4.5 },
  { id: "3", name: "Suresh", experience: "7 years experience", rating: 4.8 },
];

export default function BarberSelectionScreen({ navigation, route }) {
  // ✅ FIX: Pichli screens se salonName, services, aur price receive kiya
  const { salonName, totalPrice, totalDuration, services } = route?.params || {};
  
  const [selectedBarberId, setSelectedBarberId] = useState("any");

  // Selected Barber ka naam nikalne ke liye helper
  const getSelectedBarberName = () => {
    const barber = BARBERS.find(b => b.id === selectedBarberId);
    return barber ? barber.name : "Any Barber";
  };

  return (
    <View style={styles.mainContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent />
      
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={26} color="#000" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Select Expert</Text>
            {/* ✅ Salon Name display for continuity */}
            <Text style={{ fontSize: 11, color: '#8B1D1D', fontWeight: '700', textAlign: 'center' }}>
                {salonName}
            </Text>
          </View>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>AVAILABLE BARBERS</Text>
          
          {BARBERS.map((barber) => {
            const isSelected = selectedBarberId === barber.id;

            return (
              <TouchableOpacity
                key={barber.id}
                style={[
                  styles.card,
                  isSelected && styles.selectedCard,
                ]}
                onPress={() => setSelectedBarberId(barber.id)}
              >
                <View style={[styles.iconCircle, isSelected && {backgroundColor: '#8B1D1D'}]}>
                   <Ionicons name="person" size={24} color={isSelected ? "#fff" : "#888"} />
                </View>

                <View style={{ flex: 1, marginLeft: 15 }}>
                  <View style={styles.row}>
                    <Text style={styles.barberName}>{barber.name}</Text>
                    {barber.recommended && (
                      <View style={styles.recBadge}>
                        <Text style={styles.recText}>POPULAR</Text>
                      </View>
                    )}
                  </View>

                  <Text style={styles.meta}>{barber.experience}</Text>

                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={14} color="#f5a623" />
                    <Text style={styles.ratingText}>{barber.rating}</Text>
                  </View>
                </View>

                {isSelected && (
                  <Ionicons name="checkmark-circle" size={26} color="#8B1D1D" />
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Proceed Button with Data Forwarding */}
        <View style={styles.footer}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.proceedBtn}
            // ✅ FIX: Ab ye sara data (salonName, Barber Name) SlotSelection ko jayega
            onPress={() => 
              navigation.navigate("SlotSelection", {
                salonName,
                totalPrice,
                totalDuration,
                services,
                selectedBarberId: selectedBarberId,
                selectedBarberName: getSelectedBarberName()
              })
            }
          >
            <Text style={styles.proceedText}>Continue to Timing</Text>
            <Ionicons name="chevron-forward" size={20} color="#fff" style={{marginLeft: 8}} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 10 : 10,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderColor: "#F3F4F6",
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#111", textAlign: 'center' },
  sectionLabel: { fontSize: 11, fontWeight: "800", color: "#AAA", marginHorizontal: 20, marginTop: 20, letterSpacing: 1.2 },
  list: { paddingHorizontal: 20, paddingTop: 10 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 18,
    marginBottom: 15,
    borderWidth: 1.5,
    borderColor: "#F3F4F6",
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
  },
  selectedCard: { borderColor: "#8B1D1D", backgroundColor: "#FFF9F9" },
  iconCircle: { width: 50, height: 50, borderRadius: 25, backgroundColor: "#F3F4F6", justifyContent: 'center', alignItems: 'center' },
  barberName: { fontSize: 16, fontWeight: "800", color: "#111" },
  recBadge: { backgroundColor: "#8B1D1D", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 10 },
  recText: { color: "#fff", fontSize: 9, fontWeight: "900" },
  meta: { fontSize: 13, color: "#777", marginTop: 4 },
  ratingRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  ratingText: { marginLeft: 4, fontSize: 13, fontWeight: "700", color: "#444" },
  row: { flexDirection: "row", alignItems: "center" },
  footer: { padding: 20, borderTopWidth: 1, borderColor: "#F3F4F6", backgroundColor: "#fff" },
  proceedBtn: { backgroundColor: "#8B1D1D", paddingVertical: 18, borderRadius: 16, flexDirection: 'row', alignItems: "center", justifyContent: 'center', elevation: 4 },
  proceedText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});