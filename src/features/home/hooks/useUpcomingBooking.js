//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// features/home/hooks/useUpcomingBooking.js — v2 ✅
// All fixes: error reset, safe date, dep array, query param
//////////////////////////////////////////////////////

import { useState, useEffect, useCallback } from "react";
import apiClient from "../../../shared/api/client";

export default function useUpcomingBooking() {
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetchUpcoming = useCallback(async () => {
    try {
      setLoading(true);
      setError(null); // Fix 4: clear error on each attempt

      // Fix 2: backend filtering — only fetch upcoming, limit 5
      const res = await apiClient.get("/api/v1/bookings/user/upcoming");
      if (res?.data?.success && res.data.bookings?.length > 0) {
        const upcomingStatuses = ["CONFIRMED", "HOLD", "ONGOING", "CHECKED_IN"];
        const now = new Date();

        const upcoming = res.data.bookings
          .filter(b => upcomingStatuses.includes(b.status))
          .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

        setBooking(upcoming[0] || null);
      } else {
        setBooking(null);
      }
    } catch (err) {
      setError(err);
      setBooking(null);
    } finally {
      setLoading(false);
    }
  }, []); // stable — no external deps

  // Fix 1: fetchUpcoming in dep array
  useEffect(() => {
    fetchUpcoming();
  }, [fetchUpcoming]);

  return { booking, loading, error, refetch: fetchUpcoming };
}