import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, StatusBar, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import apiClient from "../../../shared/api/client";
import { COLORS, RADIUS, FONTS } from "../../../config/theme";
import useServiceSelection from "../../booking/hooks/useServiceSelection";
import { useBooking } from "../../booking/store/BookingContext";
import { ROUTES } from "../../../app/routes/routeNames";
import { showError } from "../../../shared/utils/toast";
import CartHeader      from "../../booking/components/cart/CartHeader";
import CartBanner      from "../../booking/components/cart/CartBanner";
import CartItem        from "../../booking/components/cart/CartItem";
import CartSalonCard   from "../../booking/components/cart/CartSalonCard";
import CartPriceDetails from "../../booking/components/cart/CartPriceDetails";
import CartCoupon      from "../../booking/components/cart/CartCoupon";
import CartFooter      from "../../booking/components/cart/CartFooter";

const PURPLE = "#5C35E8";

export default function ServiceSelectionScreen({ navigation, route }) {
  const { salonId, salon } = route.params || {};
  const { selectedServices, toggleService, totalPrice, totalDuration } = useServiceSelection();
  const { setSelectedSalon } = useBooking();

  const [isLoading,     setIsLoading]     = useState(false);
  const [couponCode,    setCouponCode]    = useState("");
  const [discount,      setDiscount]      = useState(0);
  const [couponApplied, setCouponApplied] = useState("");

  const TAX_RATE = 0.05;
  const subtotal = totalPrice;
  const taxes    = Math.round(subtotal * TAX_RATE);
  const total    = subtotal - discount + taxes;

  useEffect(() => {
    if (salon) setSelectedSalon(salon);
  }, []);

  const applyCoupon = () => {
    if (couponCode.toUpperCase() === "WELCOME50") {
      setDiscount(50);
      setCouponApplied("WELCOME50");
    } else {
      showError("Invalid coupon code");
    }
  };

  const removeCoupon = () => {
    setDiscount(0);
    setCouponApplied("");
    setCouponCode("");
  };

  const handleNext = () => {
    if (!selectedServices.length) return;
    navigation.navigate(ROUTES.SLOT_SELECTION, {
      salonId, salon,
      services: selectedServices,
      totalDuration,
    });
  };

  const handleAddMore = () => {
    navigation.navigate(ROUTES.SALON_DETAIL, { salonId, salon });
  };

  const handleClearAll = () => {
    [...selectedServices].forEach(s => toggleService(s));
  };

  if (isLoading) return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={PURPLE} />
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />

      <CartHeader onBack={() => navigation.goBack()} onClear={handleClearAll} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* BANNER */}
        <CartBanner onAddMore={handleAddMore} />

        {/* SELECTED SERVICES */}
        {selectedServices.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Services ({selectedServices.length})</Text>
              <TouchableOpacity onPress={handleClearAll}>
                <Text style={styles.clearAll}>Clear All</Text>
              </TouchableOpacity>
            </View>
            {selectedServices.map((item, i) => (
              <CartItem key={item._id} item={item} index={i} onRemove={toggleService} />
            ))}
          </View>
        ) : (
          /* EMPTY CART */
          <View style={styles.emptyCart}>
            <Ionicons name="bag-outline" size={56} color={COLORS.border} />
            <Text style={styles.emptyTitle}>Your cart is empty</Text>
            <Text style={styles.emptySub}>Add services from the salon page</Text>
            <TouchableOpacity style={styles.browseBtn} onPress={handleAddMore}>
              <Text style={styles.browseBtnText}>Browse Services</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SALON + SLOT CARD */}
        {selectedServices.length > 0 && (
          <CartSalonCard salon={salon} onChangeSlot={handleNext} />
        )}

        {/* PRICE DETAILS */}
        {selectedServices.length > 0 && (
          <CartPriceDetails
            count={selectedServices.length}
            subtotal={subtotal}
            discount={discount}
            coupon={couponApplied}
            taxes={taxes}
            total={total}
            onRemoveCoupon={removeCoupon}
          />
        )}

        {/* COUPON */}
        {selectedServices.length > 0 && (
          <CartCoupon
            value={couponCode}
            onChange={setCouponCode}
            onApply={applyCoupon}
          />
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* STICKY FOOTER */}
      {selectedServices.length > 0 && (
        <CartFooter total={total} duration={totalDuration} onProceed={handleNext} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  scroll: { paddingBottom: 20 },

  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionHead: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontFamily: FONTS.bold, color: COLORS.text.primary },
  clearAll: { fontSize: 12, fontFamily: FONTS.medium, color: PURPLE },

  emptyCart: {
    alignItems: "center", paddingTop: 60, paddingBottom: 40,
    paddingHorizontal: 32, gap: 10,
  },
  emptyTitle: { fontSize: 18, fontFamily: FONTS.bold, color: COLORS.text.primary },
  emptySub: { fontSize: 13, fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center" },
  browseBtn: {
    marginTop: 12, paddingHorizontal: 28, paddingVertical: 12,
    backgroundColor: PURPLE, borderRadius: 12,
  },
  browseBtnText: { fontSize: 14, fontFamily: FONTS.bold, color: "#fff" },
});
