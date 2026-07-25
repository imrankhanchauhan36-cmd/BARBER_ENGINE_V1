import mongoose from "mongoose";

//////////////////////////////////////////////////////////////
// 🔥 APP SETTING — Global, admin-editable key-value config
//
// Business rules that should change without a code deploy
// (commission rate, GST rate, wallet top-up limits, etc.) live
// here instead of hardcoded constants or .env vars. Read-heavy,
// write-rare — a single findOne per key is cheap, and callers are
// expected to cache short-term if they read the same key
// repeatedly in a hot path (see CommissionService).
//
// NOTE — Mixed value validation: mongoose.Schema.Types.Mixed
// cannot enforce "must be a number 0-100" at the schema level, so
// per-key range/type validation happens in the service layer that
// reads each setting (e.g. CommissionService), not here.
//////////////////////////////////////////////////////////////

export const APP_SETTING_KEYS = Object.freeze({
  DEFAULT_COMMISSION_RATE: "DEFAULT_COMMISSION_RATE", // percentage, e.g. 10 = 10%
  GST_RATE:                "GST_RATE",                // percentage, e.g. 18 = 18%
  WALLET_MIN_TOPUP:        "WALLET_MIN_TOPUP",         // rupees
  WALLET_MAX_TOPUP:        "WALLET_MAX_TOPUP",         // rupees
});

export const APP_SETTING_CATEGORY = {
  FINANCE:      "FINANCE",
  BOOKING:      "BOOKING",
  PAYMENT:      "PAYMENT",
  WALLET:       "WALLET",
  SYSTEM:       "SYSTEM",
  NOTIFICATION: "NOTIFICATION",
};

const AppSettingSchema = new mongoose.Schema(
  {
    key: {
      type:     String,
      required: true,
      unique:   true,
      index:    true,
    },

    value: {
      type:     mongoose.Schema.Types.Mixed,
      required: true,
    },

    category: {
      type:     String,
      enum:     Object.values(APP_SETTING_CATEGORY),
      required: true,
      index:    true,
    },

    // System-critical settings (if any are ever added here) can be
    // marked non-editable so an admin panel can grey them out —
    // business rules like commission/GST default to editable.
    isEditable: {
      type:    Boolean,
      default: true,
    },

    description: {
      type:      String,
      default:   null,
      maxlength: 300,
    },

    updatedBy: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default mongoose.models.AppSetting ||
  mongoose.model("AppSetting", AppSettingSchema);