import NotificationPreference, {
  DEFAULT_NOTIFICATION_PREFERENCES,
} from "../models/NotificationPreference.js";

const ALLOWED_KEYS = Object.keys(DEFAULT_NOTIFICATION_PREFERENCES);

//////////////////////////////////////////////////////
// GET PREFERENCES — lazy read, no write if doc missing
//////////////////////////////////////////////////////

export const getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user._id;

    const doc = await NotificationPreference.findOne({ userId }).lean();

    if (!doc) {
      return res.status(200).json({
        success: true,
        data: { ...DEFAULT_NOTIFICATION_PREFERENCES },
      });
    }

    const preferences = {};
    for (const key of ALLOWED_KEYS) {
      preferences[key] = doc[key];
    }

    return res.status(200).json({ success: true, data: preferences });
  } catch (err) {
    console.error("[NotificationPreferencesController] getNotificationPreferences:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch notification preferences" });
  }
};

//////////////////////////////////////////////////////
// UPDATE PREFERENCES — partial update, upsert on first save
//////////////////////////////////////////////////////

export const updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user._id;
    const body = req.body || {};

    const updates = {};
    for (const key of Object.keys(body)) {
      if (!ALLOWED_KEYS.includes(key)) {
        return res.status(400).json({ success: false, message: `Unknown preference field: ${key}` });
      }
      if (typeof body[key] !== "boolean") {
        return res.status(400).json({ success: false, message: `Preference "${key}" must be a boolean` });
      }
      updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid preference fields provided" });
    }

    const doc = await NotificationPreference.findOneAndUpdate(
      { userId },
      { $set: updates, $setOnInsert: { userId } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    const preferences = {};
    for (const key of ALLOWED_KEYS) {
      preferences[key] = doc[key];
    }

    return res.status(200).json({ success: true, message: "Preferences updated", data: preferences });
  } catch (err) {
    console.error("[NotificationPreferencesController] updateNotificationPreferences:", err);
    return res.status(500).json({ success: false, message: "Failed to update notification preferences" });
  }
};
