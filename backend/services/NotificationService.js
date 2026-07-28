import { createNotification } from "../controllers/notification.controller.js";

//////////////////////////////////////////////////////////////
// NOTIFICATION SERVICE
// Single choke point for every outbound notification. Today this
// only writes to the Notification collection (createNotification
// already swallows its own DB errors and returns null on failure)
// — but push/FCM, email, SMS, and retry-queue dispatch all land
// inside send() later without touching any call site.
//////////////////////////////////////////////////////////////

const NotificationService = {
  async send(payload) {
    try {
      return await createNotification(payload);
    } catch (err) {
      console.warn("[NotificationService] send failed (non-critical):", err.message);
      return null;
    }
  },
};

export default NotificationService;
