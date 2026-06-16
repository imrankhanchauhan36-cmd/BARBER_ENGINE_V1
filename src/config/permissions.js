export const APP_PERMISSIONS = {
  LOCATION: {
    android: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ],

    ios: ["LOCATION_WHEN_IN_USE"],
  },

  CAMERA: {
    android: ["android.permission.CAMERA"],

    ios: ["CAMERA"],
  },

  GALLERY: {
    android: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
    ],

    ios: ["PHOTO_LIBRARY"],
  },

  NOTIFICATIONS: {
    android: ["android.permission.POST_NOTIFICATIONS"],

    ios: ["NOTIFICATIONS"],
  },
};