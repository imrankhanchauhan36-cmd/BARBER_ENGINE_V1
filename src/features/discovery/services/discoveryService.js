import apiClient from "../../../shared/api/client";

export const getNearbySalons = async (params = {}) => {
  const response = await apiClient.get("/api/discovery/salons", { params });
  return response.data;
};

export const getSalonDetails = async (salonId) => {
  const response = await apiClient.get(`/api/discovery/salons/${salonId}`);
  return response.data;
};

export const getSalonServices = async (salonId) => {
  const response = await apiClient.get(`/api/discovery/salons/${salonId}/services`);
  return response.data;
};