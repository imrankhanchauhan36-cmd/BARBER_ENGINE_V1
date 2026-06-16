import React, { useState, useRef } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, StatusBar, ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../hooks/useAuth";
import { ApiService } from "../../../../services/ApiService";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

export default function LoginScreen() {
  const { login } = useAuth();

  const [step,    setStep]    = useState("PHONE");
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef([]);

  //////////////////////////////////////////////////////
  // SEND OTP
  //////////////////////////////////////////////////////

  const handleSendOTP = async () => {
    if (phone.length !== 10) {
      Alert.alert("Invalid Number", "Please enter a valid 10-digit phone number.");
      return;
    }
    setLoading(true);
    try {
      const res = await ApiService.request(
        "/api/auth/user/send-otp",
        "POST",
        { phone: `+91${phone}` }
      );
      if (res?.success) {
        setStep("OTP");
      } else {
        Alert.alert("Error", res?.message || "Failed to send OTP");
      }
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  //////////////////////////////////////////////////////
  // VERIFY OTP
  //////////////////////////////////////////////////////

  const handleVerifyOTP = async () => {
    const otpString = otp.join("");
    if (otpString.length !== 6) {
      Alert.alert("Invalid OTP", "Please enter the 6-digit OTP.");
      return;
    }
    setLoading(true);
    try {
      const res = await ApiService.request(
        "/api/auth/user/verify-otp",
        "POST",
        { phone: `+91${phone}`, otp: otpString }
      );
      if (res?.success) {
        await login({
          accessToken:  res.accessToken,
          refreshToken: res.refreshToken,
          userId:       res.user?._id || res.userId,
          name:         res.user?.name || "",
          phone:        phone,
        });
      } else {
        Alert.alert("Error", res?.message || "Invalid OTP");
      }
    } catch (err) {
      Alert.alert("Error", err.message);
    } finally {
      setLoading(false);
    }
  };

  //////////////////////////////////////////////////////
  // OTP INPUT
  //////////////////////////////////////////////////////

  const handleOtpChange = (text, index) => {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);
    if (text && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  //////////////////////////////////////////////////////
  // RENDER
  //////////////////////////////////////////////////////

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ── LOGO ── */}
        <View style={styles.logoBox}>
          <Ionicons name="cut" size={32} color={COLORS.primary} />
        </View>
        <Text style={styles.appName}>BarberEngine</Text>
        <Text style={styles.tagline}>Book top salons near you</Text>

        {/* ── PHONE STEP ── */}
        {step === "PHONE" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter your mobile number</Text>
            <Text style={styles.cardSub}>We'll send you a 6-digit OTP to verify</Text>

            <View style={styles.phoneRow}>
              <View style={styles.countryCode}>
                <Text style={styles.countryCodeText}>+91</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="10-digit mobile number"
                placeholderTextColor={COLORS.textLight}
                keyboardType="phone-pad"
                maxLength={10}
                value={phone}
                onChangeText={setPhone}
                autoFocus
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={handleSendOTP}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Send OTP</Text>
              }
            </TouchableOpacity>
          </View>
        ) : (
          /* ── OTP STEP ── */
          <View style={styles.card}>
            <TouchableOpacity onPress={() => setStep("PHONE")} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={20} color={COLORS.text} />
              <Text style={styles.backText}>Change number</Text>
            </TouchableOpacity>

            <Text style={styles.cardTitle}>Verify OTP</Text>
            <Text style={styles.cardSub}>Sent to +91 {phone}</Text>

            <View style={styles.otpRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={r => otpRefs.current[i] = r}
                  style={[styles.otpBox, digit && styles.otpBoxFilled]}
                  value={digit}
                  onChangeText={t => handleOtpChange(t, i)}
                  onKeyPress={e => handleOtpKeyPress(e, i)}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                />
              ))}
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, loading && { opacity: 0.7 }]}
              onPress={handleVerifyOTP}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryBtnText}>Verify & Continue</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={handleSendOTP} style={styles.resendBtn}>
              <Text style={styles.resendText}>Resend OTP</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.footer}>
          By continuing, you agree to our{" "}
          <Text style={styles.footerLink}>Terms</Text> &{" "}
          <Text style={styles.footerLink}>Privacy Policy</Text>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: Platform.OS === "ios" ? 80 : 60, paddingBottom: 40 },

  logoBox: { width: 72, height: 72, borderRadius: 20, backgroundColor: COLORS.primaryLight, justifyContent: "center", alignItems: "center", marginBottom: 16, alignSelf: "center" },
  appName: { fontSize: 28, fontWeight: "900", color: COLORS.text, textAlign: "center" },
  tagline: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", marginBottom: 40, marginTop: 6 },

  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.xl, padding: 24, borderWidth: 0.5, borderColor: COLORS.border },
  cardTitle: { fontSize: 18, fontWeight: "800", color: COLORS.text, marginBottom: 6 },
  cardSub: { fontSize: 13, color: COLORS.textMuted, marginBottom: 24 },

  phoneRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  countryCode: { backgroundColor: COLORS.background, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: COLORS.border, paddingHorizontal: 14, justifyContent: "center" },
  countryCodeText: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  phoneInput: { flex: 1, backgroundColor: COLORS.background, borderRadius: RADIUS.md, borderWidth: 0.5, borderColor: COLORS.border, padding: 14, fontSize: 16, fontWeight: "600", color: COLORS.text },

  primaryBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.md, paddingVertical: 16, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 20 },
  backText: { fontSize: 14, fontWeight: "600", color: COLORS.text },

  otpRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  otpBox: { width: 48, height: 56, borderRadius: RADIUS.md, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.background, fontSize: 22, fontWeight: "800", color: COLORS.text },
  otpBoxFilled: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },

  resendBtn: { marginTop: 16, alignItems: "center" },
  resendText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },

  footer: { fontSize: 11, color: COLORS.textLight, textAlign: "center", marginTop: 32 },
  footerLink: { textDecorationLine: "underline", color: COLORS.textMuted, fontWeight: "600" },
});
