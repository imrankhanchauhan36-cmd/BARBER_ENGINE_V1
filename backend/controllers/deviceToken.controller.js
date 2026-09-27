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
// HELPER — RESOLVE RECIPIENT (FA-P2-A)
// Same role-branch as notification.controller.js's resolveRecipient —
// OWNER path is byte-for-byte the original behavior; FIELD_AGENT is
// new and additive, keyed on the caller's own User._id.
//////////////////////////////////////////////////////

const resolveRecipient = async (user) => {
  if (user?.role === "FIELD_AGENT") {
    return { recipientType: "FIELD_AGENT", recipientId: user._id };
  }
  const salon = await getSalonByOwner(user?._id);
  return { recipientType: "SALON", recipientId: salon._id };
};

//////////////////////////////////////////////////////
// REGISTER DEVICE TOKEN
// recipientType/recipientId are always derived from the
// authenticated caller's own session — never accepted from
// the client — so a token can never be registered under a
// different recipient than the caller.
//////////////////////////////////////////////////////

export const registerDeviceTokenHandler = async (req, res) => {
  try {
    const { recipientType, recipientId } = await resolveRecipient(req.user);

    const { token, platform, provider, appVersion, deviceId } = req.body;

    const deviceToken = await registerDeviceToken({
      recipientType,
      recipientId,
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
    const { recipientType, recipientId } = await resolveRecipient(req.user);

    const { token } = req.body;

    const updated = await deactivateDeviceToken({
      recipientType,
      recipientId,
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
