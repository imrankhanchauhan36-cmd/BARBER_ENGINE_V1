import { useCallback, useEffect, useRef, useState } from "react";
import { getNearbySalons } from "../services/discoveryService";

export const useNearbySalons = ({ lat, lng, limit = 20 }) => {
  const [salons,  setSalons]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const latRef   = useRef(lat);
  const lngRef   = useRef(lng);
  const limitRef = useRef(limit);

  const fetchSalons = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await getNearbySalons({
        lat:   latRef.current,
        lng:   lngRef.current,
        limit: limitRef.current,
      });

      setSalons(response?.data || []);

    } catch (err) {
      console.warn("❌ Nearby salons fetch failed:", err.message);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    latRef.current   = lat;
    lngRef.current   = lng;
    limitRef.current = limit;
    fetchSalons();
  }, [lat, lng]);

  return { salons, loading, error, refetch: fetchSalons };
};
