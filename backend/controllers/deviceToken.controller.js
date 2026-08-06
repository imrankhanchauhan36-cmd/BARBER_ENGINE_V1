import Salon from "../models/Salon.js";
import {
  registerDeviceToken,
  deactivateDeviceToken,
} from "../modules/notifications/services/deviceToken.service.js";

//////////////////////////////////////////////////////
// HELPER — GET SALON BY OWNER (same pattern as
// notification.controller.js — duplicated locally rather
// than imported, since that file does not export it)
//////////////////////////////////////////////////////

const getSalonByOwner = async (ownerId) => {
  const salon = await Salon.findOne({ ownerId }).select("_id").lean();
  if (!salon) throw new Error("SALON_NOT_FOUND");
  return salon;
};

//////////////////////////////////////////////////////
// REGISTER DEVICE TOKEN
// recipientType/recipientId are always derived from the
// authenticated owner's own salon — never accepted from
// the client — so a token can never be registered under a
// different recipient than the caller.
//////////////////////////////////////////////////////

export const registerDeviceTokenHandler = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon    = await getSalonByOwner(ownerId);

    const { token, platform, provider, appVersion, deviceId } = req.body;

    const deviceToken = await registerDeviceToken({
      recipientType: "SALON",
      recipientId:   salon._id,
      token,
      platform,
      provider,
      appVersion: appVersion || null,
      deviceId:   deviceId   || null,
    });

    return res.status(200).json({
      success: true,
      message: "Device token registered",
      data: {
        id:         deviceToken._id,
        platform:   deviceToken.platform,
        provider:   deviceToken.provider,
        isValid:    deviceToken.isValid,
        lastSeenAt: deviceToken.lastSeenAt,
      },
    });
  } catch (err) {
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to register device token" });
  }
};

//////////////////////////////////////////////////////
// DEACTIVATE DEVICE TOKEN (logout)
//////////////////////////////////////////////////////

export const deactivateDeviceTokenHandler = async (req, res) => {
  try {
    const ownerId = req.user?._id;
    const salon    = await getSalonByOwner(ownerId);

    const { token } = req.body;

    const updated = await deactivateDeviceToken({
      recipientType: "SALON",
      recipientId:   salon._id,
      token,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: "Device token not found" });
    }

    return res.status(200).json({ success: true, message: "Device token deactivated" });
  } catch (err) {
    if (err.message === "SALON_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }
    return res.status(500).json({ success: false, message: "Failed to deactivate device token" });
  }
};
