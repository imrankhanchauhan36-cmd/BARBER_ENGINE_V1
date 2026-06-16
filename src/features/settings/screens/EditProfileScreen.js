//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// screens/EditProfileScreen.js — FINAL ✅
// 10/10 Industry Grade — Full Backend + Cloudinary
//////////////////////////////////////////////////////

import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar,
  TextInput, Image, ScrollView, Platform, Alert,
  ActivityIndicator, Modal, KeyboardAvoidingView,
  BackHandler,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { useAuth } from "../../auth/hooks/useAuth";
import apiClient from "../../../shared/api/client";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE  = "#5C35E8";
const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];

// ── Profile completion helper ─────────────────────────────
const getCompletion = (name, phone, email, photo) => {
  const fields = [!!name, !!phone, !!email, !!photo];
  return Math.round((fields.filter(Boolean).length / fields.length) * 100);
};

// ── InputField ────────────────────────────────────────────
const InputField = ({ label, value, onChangeText, placeholder, keyboardType, locked, rightIcon, error }) => (
  <View style={styles.inputGroup}>
    <Text style={styles.label}>{label}</Text>
    <View style={[
      styles.inputBox,
      locked && styles.inputBoxLocked,
      !!error && styles.inputBoxError,
    ]}>
      <TextInput
        style={[styles.input, locked && { color: COLORS.text.secondary }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={COLORS.text.secondary}
        keyboardType={keyboardType || "default"}
        editable={!locked}
        autoCapitalize="none"
      />
      {locked && !rightIcon && <Ionicons name="lock-closed-outline" size={16} color={COLORS.text.secondary} />}
      {rightIcon}
    </View>
    {error ? <Text style={styles.errorText}>{error}</Text> : null}
  </View>
);

// ── Main Screen ───────────────────────────────────────────
export default function EditProfileScreen({ navigation }) {
  const { user: authUser } = useAuth();

  const [avatar,       setAvatar]       = useState(null);
  const [isUploading,  setIsUploading]  = useState(false);
  const [isSaving,     setIsSaving]     = useState(false);
  const [isLoading,    setIsLoading]    = useState(true);
  const [hasChanges,   setHasChanges]   = useState(false);

  // Form fields
  const [name,   setName]   = useState("");
  const [phone,  setPhone]  = useState("");
  const [email,  setEmail]  = useState("");
  const [gender, setGender] = useState("Male");
  const [showGenderModal, setShowGenderModal] = useState(false);

  // Original values for change detection
  const originalRef = useRef({ name: "", email: "", gender: "Male", avatar: null });

  // Errors
  const [nameError,  setNameError]  = useState("");
  const [emailError, setEmailError] = useState("");

  // ── Load from backend ───────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      try {
        const res = await apiClient.get("/api/user/me");
        if (res?.data?.success && res.data.user) {
          const u = res.data.user;
          setName(u.name   || "");
          setPhone(u.phone || "");
          setEmail(u.email || "");
          if (u.profilePhoto) setAvatar(u.profilePhoto);
          originalRef.current = {
            name:   u.name   || "",
            email:  u.email  || "",
            gender: "Male",
            avatar: u.profilePhoto || null,
          };
        }
      } catch {
        const [n, p, e, av] = await Promise.all([
          AsyncStorage.getItem("USER_NAME").catch(() => null),
          AsyncStorage.getItem("USER_PHONE").catch(() => null),
          AsyncStorage.getItem("USER_EMAIL").catch(() => null),
          AsyncStorage.getItem("USER_AVATAR").catch(() => null),
        ]);
        if (n)  { setName(n);  originalRef.current.name  = n; }
        if (p)  setPhone(p);
        if (e)  { setEmail(e); originalRef.current.email = e; }
        if (av) { setAvatar(av); originalRef.current.avatar = av; }
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // ── Unsaved changes detection ───────────────────────────
  useEffect(() => {
    const orig = originalRef.current;
    const changed =
      name.trim()  !== orig.name  ||
      email.trim() !== orig.email ||
      gender       !== orig.gender ||
      avatar       !== orig.avatar;
    setHasChanges(changed);
  }, [name, email, gender, avatar]);

  // ── Android back button — warn on unsaved ──────────────
  useEffect(() => {
    const handler = () => {
      if (hasChanges) {
        showDiscardAlert();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => sub.remove();
  }, [hasChanges]);

  const showDiscardAlert = () => {
    Alert.alert(
      "Unsaved Changes",
      "You have unsaved changes. Are you sure you want to leave?",
      [
        { text: "Stay",    style: "cancel" },
        { text: "Discard", style: "destructive", onPress: () => navigation.goBack() },
      ]
    );
  };

  const handleBack = () => {
    if (hasChanges) { showDiscardAlert(); return; }
    navigation.goBack();
  };

  // ── Validation ──────────────────────────────────────────
  const validate = () => {
    let valid = true;
    setNameError("");
    setEmailError("");

    const n = name.trim();
    if (!n || n.length < 2) {
      setNameError("Name must be at least 2 characters.");
      valid = false;
    } else if (n.length > 60) {
      setNameError("Name must be less than 60 characters.");
      valid = false;
    } else if (!/^[a-zA-Z\u0900-\u097F\s.'-]+$/.test(n)) {
      setNameError("Name contains invalid characters.");
      valid = false;
    }

    const e = email.trim();
    if (e && !/^\S+@\S+\.\S+$/.test(e)) {
      setEmailError("Please enter a valid email address.");
      valid = false;
    }

    return valid;
  };

  // ── Save to backend ─────────────────────────────────────
  const handleSave = async () => {
    if (!validate()) return;

    setIsSaving(true);
    try {
      const updates = {};
      const n = name.trim();
      const e = email.trim();

      if (n !== originalRef.current.name)  updates.name  = n;
      if (e !== originalRef.current.email) updates.email = e;

      if (Object.keys(updates).length === 0) {
        Alert.alert("No Changes", "Nothing to update.");
        setIsSaving(false);
        return;
      }

      const res = await apiClient.put("/api/user/me", updates);

      if (res?.data?.success) {
        const u = res.data.user;
        if (u.name)  await AsyncStorage.setItem("USER_NAME",  u.name).catch(console.warn);
        if (u.email) await AsyncStorage.setItem("USER_EMAIL", u.email).catch(console.warn);

        originalRef.current = { ...originalRef.current, name: u.name || n, email: u.email || e };
        setHasChanges(false);

        Alert.alert("Success ✅", "Profile updated successfully!", [
          { text: "OK", onPress: () => navigation.goBack() },
        ]);
      } else {
        Alert.alert("Error", res?.data?.message || "Failed to update profile.");
      }
    } catch (err) {
      Alert.alert("Error", err?.response?.data?.message || "Something went wrong.");
    } finally {
      setIsSaving(false);
    }
  };

  // ── Pick + compress + upload photo ─────────────────────
  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission Needed", "Please allow photo library access to change your profile photo.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });

    if (result.canceled) return;

    try {
      setIsUploading(true);

      // Compress image
      const compressed = await ImageManipulator.manipulateAsync(
        result.assets[0].uri,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );

      // Upload to backend → Cloudinary
      const formData = new FormData();
      formData.append("photo", {
        uri:  compressed.uri,
        type: "image/jpeg",
        name: `profile_${Date.now()}.jpg`,
      });

      const res = await apiClient.post("/api/user/me/photo", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res?.data?.success) {
        const url = `${res.data.profilePhoto}?v=${Date.now()}`; // cache bust
        setAvatar(url);
        await AsyncStorage.setItem("USER_AVATAR", url).catch(console.warn);
        originalRef.current.avatar = url;
        Alert.alert("Success ✅", "Profile photo updated!");
      } else {
        Alert.alert("Error", res?.data?.message || "Photo upload failed.");
      }
    } catch (err) {
      console.warn("Photo upload error:", err?.message);
      Alert.alert("Error", "Could not upload photo. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  // ── Completion % ────────────────────────────────────────
  const completion = getCompletion(name, phone, email, avatar);

  const initials = name
    ? name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  // ── Loading ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={PURPLE} />
        <Text style={styles.loadingText}>Loading profile...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Ionicons name="arrow-back" size={20} color={COLORS.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Edit Profile</Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isSaving || !hasChanges}
            style={[styles.saveBtn, (!hasChanges || isSaving) && { opacity: 0.4 }]}
          >
            {isSaving
              ? <ActivityIndicator size="small" color={PURPLE} />
              : <Text style={styles.saveBtnText}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >

          {/* AVATAR */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarBox}>
              {avatar ? (
                <Image source={{ uri: avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.cameraBtn, isUploading && { opacity: 0.6 }]}
                onPress={handlePickImage}
                disabled={isUploading}
              >
                {isUploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={14} color="#fff" />
                }
              </TouchableOpacity>
            </View>
            <Text style={styles.avatarName}>{name || "Your Name"}</Text>
            <Text style={styles.avatarHint}>
              {isUploading ? "Uploading..." : "Tap camera to change photo"}
            </Text>
          </View>

          {/* PROFILE COMPLETION */}
          <View style={styles.completionCard}>
            <View style={styles.completionRow}>
              <Text style={styles.completionTitle}>Profile Completeness</Text>
              <Text style={styles.completionPct}>{completion}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${completion}%` }]} />
            </View>
            <View style={styles.completionItems}>
              {[
                { label: "Name",  done: !!name },
                { label: "Phone", done: !!phone },
                { label: "Email", done: !!email },
                { label: "Photo", done: !!avatar },
              ].map((item, i) => (
                <View key={i} style={styles.completionItem}>
                  <Ionicons
                    name={item.done ? "checkmark-circle" : "ellipse-outline"}
                    size={14}
                    color={item.done ? "#16A34A" : COLORS.text.secondary}
                  />
                  <Text style={[styles.completionItemText, item.done && { color: "#16A34A" }]}>
                    {item.label}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {/* PERSONAL INFO */}
          <Text style={styles.sectionTitle}>Personal Information</Text>
          <View style={styles.card}>
            <InputField
              label="Full Name *"
              value={name}
              onChangeText={t => { setName(t); setNameError(""); }}
              placeholder="Enter your full name"
              error={nameError}
            />
            <View style={styles.div} />
            <InputField
              label="Mobile Number"
              value={phone}
              locked
            />
            <View style={styles.div} />
            <InputField
              label="Email Address"
              value={email}
              onChangeText={t => { setEmail(t); setEmailError(""); }}
              placeholder="Enter your email"
              keyboardType="email-address"
              error={emailError}
            />
            <View style={styles.div} />

            {/* Gender */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Gender</Text>
              <TouchableOpacity
                style={styles.inputBox}
                onPress={() => setShowGenderModal(true)}
                activeOpacity={0.8}
              >
                <Text style={[styles.input, { color: COLORS.text.primary }]}>{gender}</Text>
                <Ionicons name="chevron-down" size={18} color={COLORS.text.secondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* INFO BANNER */}
          <View style={styles.infoBanner}>
            <Ionicons name="information-circle-outline" size={16} color="#1D4ED8" />
            <Text style={styles.infoBannerText}>
              Mobile number cannot be changed. Contact support if needed.
            </Text>
          </View>

          {/* ACCOUNT INFO */}
          <Text style={styles.sectionTitle}>Account Status</Text>
          <View style={styles.card}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="call-outline" size={18} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Mobile Number</Text>
                <Text style={styles.infoValue}>{phone || "--"}</Text>
              </View>
              <View style={styles.verifiedBadge}>
                <Text style={styles.verifiedText}>✓ Verified</Text>
              </View>
            </View>
            <View style={styles.dividerLine} />
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="mail-outline" size={18} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>Email Address</Text>
                <Text style={styles.infoValue}>{email || "Not added yet"}</Text>
              </View>
              <View style={[
                styles.verifiedBadge,
                { backgroundColor: email ? "#F0FDF4" : "#FEF9C3", borderColor: email ? "#86EFAC" : "#FDE68A" }
              ]}>
                <Text style={[styles.verifiedText, { color: email ? "#16A34A" : "#854D0E" }]}>
                  {email ? "Added" : "Missing"}
                </Text>
              </View>
            </View>
          </View>

          {/* DANGER ZONE */}
          <Text style={styles.sectionTitle}>Account Actions</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.dangerRow}
              onPress={() => Alert.alert(
                "Delete Account",
                "This action is permanent and cannot be undone. Please contact support to delete your account.",
                [{ text: "OK" }]
              )}
            >
              <View style={styles.dangerIcon}>
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dangerTitle}>Delete Account</Text>
                <Text style={styles.dangerSub}>Permanently remove your account and all data</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>

        </ScrollView>

        {/* GENDER MODAL */}
        <Modal visible={showGenderModal} transparent animationType="fade">
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowGenderModal(false)}
          >
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Select Gender</Text>
              {GENDERS.map(g => (
                <TouchableOpacity
                  key={g}
                  style={styles.modalOption}
                  onPress={() => {
                    setGender(g);
                    setShowGenderModal(false);
                    setHasChanges(true);
                  }}
                >
                  <Text style={[styles.modalOptionText, gender === g && styles.modalOptionTextActive]}>{g}</Text>
                  {gender === g && <Ionicons name="checkmark" size={18} color={PURPLE} />}
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: "#F8F8FF",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  center: { justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  // Header
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
  saveBtn:     { paddingHorizontal: 4, paddingVertical: 4 },
  saveBtnText: { fontSize: 15, fontFamily: FONTS.bold, color: PURPLE },

  // Avatar
  avatarSection: { alignItems: "center", paddingVertical: 24 },
  avatarBox:     { position: "relative", marginBottom: 10 },
  avatar:        { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
  },
  avatarInitials: { fontSize: 32, fontFamily: FONTS.bold, color: "#fff" },
  cameraBtn: {
    position: "absolute", bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: PURPLE, justifyContent: "center", alignItems: "center",
    borderWidth: 2, borderColor: COLORS.background,
  },
  avatarName: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 4 },
  avatarHint: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  // Completion
  completionCard: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#EEF2FF", borderRadius: RADIUS.lg,
    padding: 14, borderWidth: 0.5, borderColor: "#C7D2FE",
  },
  completionRow:  { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  completionTitle:{ fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  completionPct:  { fontSize: 13, fontFamily: FONTS.bold, color: PURPLE },
  progressBar:    { height: 6, backgroundColor: "#C7D2FE", borderRadius: 3, overflow: "hidden", marginBottom: 10 },
  progressFill:   { height: "100%", backgroundColor: PURPLE, borderRadius: 3 },
  completionItems:{ flexDirection: "row", justifyContent: "space-between" },
  completionItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  completionItemText: { fontSize: 11, fontFamily: FONTS.medium, color: COLORS.text.secondary },

  // Section
  sectionTitle: {
    fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary,
    marginHorizontal: 16, marginBottom: 10, marginTop: 4,
  },
  card: {
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: COLORS.background, borderRadius: RADIUS.lg,
    padding: 16, borderWidth: 0.5, borderColor: COLORS.border,
  },

  // Input
  inputGroup:     { marginBottom: 2 },
  label:          { fontSize: 12, fontFamily: FONTS.medium, color: COLORS.text.secondary, marginBottom: 8 },
  inputBox: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: COLORS.surface, borderRadius: RADIUS.md,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
  },
  inputBoxLocked: { backgroundColor: "#F3F4F6" },
  inputBoxError:  { borderColor: "#EF4444", borderWidth: 1 },
  input:          { flex: 1, fontSize: 14, fontFamily: FONTS.medium, color: COLORS.text.primary },
  errorText:      { fontSize: 11, fontFamily: FONTS.regular, color: "#EF4444", marginTop: 4 },
  div:            { height: 12 },

  // Info banner
  infoBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginBottom: 16,
    backgroundColor: "#EFF6FF", borderRadius: RADIUS.md,
    padding: 12, borderWidth: 0.5, borderColor: "#BFDBFE",
  },
  infoBannerText: { fontSize: 12, fontFamily: FONTS.regular, color: "#1D4ED8", flex: 1 },

  // Account info rows
  infoRow:   { flexDirection: "row", alignItems: "center", gap: 12 },
  infoIcon:  {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#F5F3FF", justifyContent: "center", alignItems: "center",
  },
  infoLabel: { fontSize: 11, fontFamily: FONTS.regular, color: COLORS.text.secondary },
  infoValue: { fontSize: 13, fontFamily: FONTS.bold, color: COLORS.text.primary },
  verifiedBadge: {
    backgroundColor: "#F0FDF4", borderRadius: RADIUS.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 0.5, borderColor: "#86EFAC",
  },
  verifiedText: { fontSize: 10, fontFamily: FONTS.bold, color: "#16A34A" },
  dividerLine:  { height: 0.5, backgroundColor: COLORS.border, marginVertical: 12 },

  // Danger zone
  dangerRow:  { flexDirection: "row", alignItems: "center", gap: 12 },
  dangerIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "#FEE2E2", justifyContent: "center", alignItems: "center",
  },
  dangerTitle: { fontSize: 14, fontFamily: FONTS.bold, color: "#EF4444" },
  dangerSub:   { fontSize: 12, fontFamily: FONTS.regular, color: COLORS.text.secondary },

  // Gender Modal
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center", alignItems: "center",
  },
  modalBox: {
    width: "80%", backgroundColor: COLORS.background,
    borderRadius: RADIUS.lg, padding: 20,
  },
  modalTitle:           { fontSize: 16, fontFamily: FONTS.bold, color: COLORS.text.primary, marginBottom: 16 },
  modalOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: COLORS.border,
  },
  modalOptionText:       { fontSize: 14, fontFamily: FONTS.medium, color: COLORS.text.primary },
  modalOptionTextActive: { fontFamily: FONTS.bold, color: PURPLE },
});