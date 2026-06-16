import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

const BookingContext =
  createContext(null);

//////////////////////////////////////////////////////
// PROVIDER
//////////////////////////////////////////////////////

export const BookingProvider = ({
  children,
}) => {

  //////////////////////////////////////////////////////
  // BOOKING STATE
  //////////////////////////////////////////////////////

  const [
    selectedSalon,
    setSelectedSalon,
  ] = useState(null);

  const [
    selectedBarber,
    setSelectedBarber,
  ] = useState(null);

  const [
    selectedServices,
    setSelectedServices,
  ] = useState([]);

  const [
    selectedDate,
    setSelectedDate,
  ] = useState(null);

  const [
    selectedSlot,
    setSelectedSlot,
  ] = useState(null);

  const [
    coupon,
    setCoupon,
  ] = useState(null);

  const [
    pricing,
    setPricing,
  ] = useState(null);

  //////////////////////////////////////////////////////
  // RESET BOOKING
  //////////////////////////////////////////////////////

  const resetBooking =
    () => {

      setSelectedSalon(null);

      setSelectedBarber(null);

      setSelectedServices([]);

      setSelectedDate(null);

      setSelectedSlot(null);

      setCoupon(null);

      setPricing(null);
    };

  //////////////////////////////////////////////////////
  // CONTEXT VALUE
  //////////////////////////////////////////////////////

  const value = useMemo(
    () => ({

      selectedSalon,
      setSelectedSalon,

      selectedBarber,
      setSelectedBarber,

      selectedServices,
      setSelectedServices,

      selectedDate,
      setSelectedDate,

      selectedSlot,
      setSelectedSlot,

      coupon,
      setCoupon,

      pricing,
      setPricing,

      resetBooking,
    }),

    [
      selectedSalon,
      selectedBarber,
      selectedServices,
      selectedDate,
      selectedSlot,
      coupon,
      pricing,
    ]
  );

  return (
    <BookingContext.Provider
      value={value}
    >
      {children}
    </BookingContext.Provider>
  );
};

//////////////////////////////////////////////////////
// CUSTOM HOOK
//////////////////////////////////////////////////////

export const useBooking =
  () => {

    const context =
      useContext(
        BookingContext
      );

    if (!context) {

      throw new Error(
        "useBooking must be used inside BookingProvider"
      );
    }

    return context;
};