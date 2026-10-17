import mongoose from "mongoose";
import Salon from "../models/Salon.js";
import {
  registerDeviceToken,
  deactivateDeviceToken,
} from "../modules/notifications/services/deviceToken.service.js";

//////////////////////////////////////////////////////
// HELPER — GET SALON BY OWNER (same pattern as
// notification.controller.js — duplicated locally rather
// than imported, since that file does not export it)
//
// MULTI-SALON DEVICE-TOKEN REGISTRATION — explicit salonId. An
// unscoped Salon.findOne({ownerId}) used to decide which salon a
// device token (and therefore every push notification) is registered
// against — for an owner with 2+ salons this could silently pin the
// token to the WRONG one, so a real booking on their OTHER salon
// would never reach them (confirmed root cause of the booking-
// visibility/notification gap this fix closes).
//
//   - salonId supplied: must belong to this owner and not be deleted.
//     Invalid/foreign id -> SALON_NOT_FOUND, never discloses whose it is.
//   - salonId absent: safe ONLY when the owner has exactly one real,
//     APPROVED salon (DRAFT/PENDING/REJECTED salons can never be the
//     subject of a real notification, so they are correctly excluded
//     from this count — an owner with one live salon plus an
//     abandoned onboarding draft is NOT ambiguous). Two or more real
//     salons -> SALON_AMBIGUOUS, fails closed rather than guessing.
//////////////////////////////////////////////////////

const getSalonByOwner = async (ownerId, salonId) => {
  if (salonId) {
    if (!mongoose.Types.ObjectId.isValid(salonId)) throw new Error("SALON_NOT_FOUND");
    const salon = await Salon.findOne({ _id: salonId, ownerId, isDeleted: false }).select("_id").lean();
    if (!salon) throw new Error("SALON_NOT_FOUND");
    return salon;
  }
  const candidates = await Salon.find({
    ownerId,
    isDeleted: false,
    "approval.status": "APPROVED",
  }).select("_id").limit(2).lean();
  if (candidates.length === 0) throw new Error("SALON_NOT_FOUND");
  if (candidates.length > 1) throw new Error("SALON_AMBIGUOUS");
  return candidates[0];
};

//////////////////////////////////////////////////////
// HELPER — RESOLVE RECIPIENT (FA-P2-A)
// Same role-branch as notification.controller.js's resolveRecipient —
// OWNER path is byte-for-byte the original behavior aside from the
// salonId disambiguation above; FIELD_AGENT is additive, keyed on the
// caller's own User._id. recipientType/recipientId are always derived
// from the authenticated caller's own session plus an ownership-
// verified salonId — never accepted as a bare, unverified recipientId
// from the client.
//////////////////////////////////////////////////////

const resolveRecipient = async (user, salonId) => {
  if (user?.role === "FIELD_AGENT") {
    return { recipientType: "FIELD_AGENT", recipientId: user._id };
  }
  // Customer push — additive. DeviceToken.recipientType and
  // Notification.recipientType both already had "USER" in their enum
  // (this model already supports it, nothing new needed there); this
  // is the first real backend call site that resolves a USER
  // recipient for a device-token registration. A customer always owns
  // zero salons, so routing a USER into getSalonByOwner would always
  // throw SALON_NOT_FOUND — handled as its own branch instead, keyed
  // on the caller's own User._id, same shape as the FIELD_AGENT branch
  // above. salonId is meaningless for this role and silently ignored.
  if (user?.role === "USER") {
    return { recipientType: "USER", recipientId: user._id };
  }
  const salon = await getSalonByOwner(user?._id, salonId);
  return { recipientType: "SALON", recipientId: salon._id };
};

const salonErrorResponse = (res, err) => {
  if (err.message === "SALON_AMBIGUOUS") {
    return res.status(409).json({
      success: false,
      code: "AMBIGUOUS_SALON",
      message: "You own more than one salon. Specify salonId to select which one.",
    });
  }
  return res.status(404).json({ success: false, message: "Salon not found" });
};

//////////////////////////////////////////////////////
// REGISTER DEVICE TOKEN
//////////////////////////////////////////////////////

export const registerDeviceTokenHandler = async (req, res) => {
  try {
    const { token, platform, provider, appVersion, deviceId, salonId } = req.body;
    const { recipientType, recipientId } = await resolveRecipient(req.user, salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
    }
    return res.status(500).json({ success: false, message: "Failed to register device token" });
  }
};

//////////////////////////////////////////////////////
// DEACTIVATE DEVICE TOKEN (logout)
//////////////////////////////////////////////////////

export const deactivateDeviceTokenHandler = async (req, res) => {
  try {
    const { token, salonId } = req.body;
    const { recipientType, recipientId } = await resolveRecipient(req.user, salonId);

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
    if (err.message === "SALON_NOT_FOUND" || err.message === "SALON_AMBIGUOUS") {
      return salonErrorResponse(res, err);
    }
    return res.status(500).json({ success: false, message: "Failed to deactivate device token" });
  }
};
