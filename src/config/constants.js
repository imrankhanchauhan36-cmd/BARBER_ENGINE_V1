export const APP_CONFIG = {
  APP_NAME: "MySalon",
  PACKAGE_NAME: "com.mysalon.user",

  DEFAULT_LANGUAGE: "en",

  DEFAULT_CURRENCY: "INR",

  PAGINATION_LIMIT: 10,

  SEARCH_RADIUS_KM: 10,

  SUPPORT_PHONE: "+91XXXXXXXXXX",
};

export const MAP_CONFIG = {
  LATITUDE_DELTA: 0.05,
  LONGITUDE_DELTA: 0.05,

  DEFAULT_REGION: {
    latitude: 28.6139,
    longitude: 77.2090,

    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  },
};

export const IMAGE_CONFIG = {
  MAX_UPLOAD_SIZE: 5 * 1024 * 1024,

  QUALITY: 0.8,
};

export const BOOKING_CONFIG = {
  SLOT_INTERVAL: 15,

  MAX_BOOKING_DAYS: 30,
};