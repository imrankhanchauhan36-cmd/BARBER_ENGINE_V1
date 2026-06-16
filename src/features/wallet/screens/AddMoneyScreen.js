import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Platform, ScrollView, TextInput, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";
const AMOUNTS = [500, 1000, 2000, 3000, 5000];
const PAYMENT_METHODS = [
  { icon: "phone-portrait-outline", label: "UPI",                sub: "Pay using any UPI app",          color: "#16A34A" },
  { icon: "card-outline",           label: "Debit / Credit Card", sub: "Visa, Mastercard, RuPay",        color: "#2563EB" },
  { icon: "business-outline",       label: "Net Banking",         sub: "All major banks supported",      color: "#D97706" },
  { icon: "wallet-outline",         label: "Wallets",             sub: "Paytm, PhonePe, Mobikwik & more",color: PURPLE },
];

export default function AddMoneyScreen({ navigation }) {
  const [selectedAmount, setSelectedAmount] = useState(1000);
  const [customAmount,   setCustomAmount]   = useState("");
  const [isOther,        setIsOther]        = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(0);

  const finalAmount = isOther ? (parseInt(customAmount) || 0) : selectedAmount;

  const handleAdd = () => {
    if (finalAmount < 100) { Alert.alert("Minimum ₹100 required"); return; }
    Alert.alert("Success", `₹${finalAmount} added to your wallet!`, [
      { text: "OK", onPress: () => navigation.goBack() }
    ]);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Money</Text>
        <TouchableOpacity>
          <Text style={styles.helpText}>Help</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* BALANCE CARD */}
        <View style={styles.balanceCard}>
          <View>
            <Text style={styles.balanceLabel}>Current Balance</Text>
            <Text style={styles.balanceAmount}>₹560.00</Text>
          </View>
          <View style={styles.walletIcon}>
            <Ionicons name="wallet-outline" size={48} color={PURPLE} />
            <View style={styles.plusBadge}>
              <Ionicons name="add" size={14} color="#fff" />
            </View>
          </View>
        </View>

        {/* SELECT AMOUNT */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Amount</Text>
          <View style={styles.amountsGrid}>
            {AMOUNTS.map(amt => (
              <TouchableOpacity
                key={amt}
                style={[styles.amountChip, !isOther && selectedAmount === amt && styles.amountChipActive]}
                onPress={() => { setSelectedAmount(amt); setIsOther(false); setCustomAmount(""); }}
              >
                <Text style={[styles.amountChipText, !isOther && selectedAmount === amt && styles.amountChipTextActive]}>
                  ₹{amt.toLocaleString()}
                </Text>
                {!isOther && selectedAmount === amt && (
                  <View style={styles.checkMark}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.amountChip, isOther && styles.amountChipActive]}
              onPress={() => { setIsOther(true); setSelectedAmount(0); }}
            >
              <Text style={[styles.amountChipText, isOther && styles.amountChipTextActive]}>Other</Text>
            </TouchableOpacity>
          </View>

          {isOther && (
            <View style={styles.customInput}>
              <Text style={styles.rupeeSymbol}>₹</Text>
              <TextInput
                style={styles.customInputText}
                value={customAmount}
                onChangeText={setCustomAmount}
                placeholder="Enter amount"
                placeholderTextColor={COLORS.text.secondary}
                keyboardType="numeric"
                autoFocus
              />
            </View>
          )}

          {/* Offer banner */}
          <View style={styles.offerNote}>
            <Ionicons name="information-circle-outline" size={14} color="#16A34A" />
            <Text style={styles.offerNoteText}>Get up to 5% extra on prepaid wallet top-up</Text>
          </View>
        </View>

        {/* PAYMENT METHODS */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Methods</Text>
          <View style={styles.methodsCard}>
            {PAYMENT_METHODS.map((method, i) => (
              <View key={i}>
                {i > 0 && <View style={styles.divider} />}
                <TouchableOpacity
                  style={[styles.methodRow, selectedMethod === i && styles.methodRowActive]}
                  onPress={() => setSelectedMethod(i)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.methodIcon, { backgroundColor: method.color + "15" }]}>
                    <Ionicons name={method.icon} size={20} color={method.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.methodLabel}>{method.label}</Text>
                    <Text style={styles.methodSub}>{method.sub}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={COLORS.text.secondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

      </ScrollView>

      {/* FOOTER */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.addBtn} onPress={handleAdd} activeOpacity={0.85}>
          <Ionicons name="lock-closed-outline" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add Money Securely</Text>
        </TouchableOpacity>
      </View>
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
  helpText: { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },

  // Balance
  balanceCard: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    margin: 16, padding: 20,
    backgroundColor: "#F5F3FF", borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  balanceLabel: { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginBottom: 4 },
  balanceAmount: { fontSize: 28, fontFamily: FONTS.bold, color: COLORS.text.primary },
  walletIcon: { position: "relative" },
  plusBadge: {
    position: "absolute", bottom: -2, right: -2,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },

  // Section
  section: { paddingHorizontal: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 12 },

  // Amounts
  amountsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  amountChip: {
    width: "30%", paddingVertical: 16, borderRadius: RADIUS.md,
    backgroundColor: COLORS.background, borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: "center", position: "relative",
  },
  amountChipActive: { borderColor: PURPLE, backgroundColor: "#F5F3FF" },
  amountChipText: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  amountChipTextActive: { color: PURPLE },
  checkMark: {
    position: "absolute", top: -6, right: -6,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },

  customInput: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.background, borderRadius: RADIUS.md,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1.5, borderColor: PURPLE, marginBottom: 12,
  },
  rupeeSymbol: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary, marginRight: 8 },
  customInputText: { flex: 1, fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary },

  offerNote: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.md,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  offerNoteText: { fontSize: 12, fontFamily: FONTS.medium, color: "#16A34A", flex: 1 },

  // Payment methods
  methodsCard: {
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  methodRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  methodRowActive: { backgroundColor: "#F5F3FF" },
  methodIcon: {
    width: 40, height: 40, borderRadius: 12,
    justifyContent: "center", alignItems: "center",
  },
  methodLabel: { fontSize: 14, fontFamily: FONTS.bold, color: COLORS.text.primary },
  methodSub:   { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary, marginTop: 1 },
  divider: { height: 0.5, backgroundColor: COLORS.border, marginLeft: 68 },

  // Footer
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: 16, paddingVertical: 14,
    paddingBottom: Platform.OS === "ios" ? 32 : 14,
    backgroundColor: COLORS.background,
    borderTopWidth: 0.5, borderTopColor: COLORS.border,
  },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: PURPLE, borderRadius: RADIUS.lg, paddingVertical: 16,
  },
  addBtnText: { fontSize: 16, fontFamily: FONTS.bold, color: "#fff" },
});
