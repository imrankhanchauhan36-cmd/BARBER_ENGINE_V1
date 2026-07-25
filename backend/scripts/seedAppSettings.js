//////////////////////////////////////////////////////////////
// ONE-TIME SEED SCRIPT — populates initial AppSetting documents.
// Safe to re-run: uses upsert, so it never creates duplicates or
// overwrites a value an admin has already changed via updateOne
// with $setOnInsert.
//
// Run from inside backend/ directory:
//     node scripts/seedAppSettings.js
//////////////////////////////////////////////////////////////

import "dotenv/config";
import mongoose from "mongoose";
import AppSetting, { APP_SETTING_CATEGORY, APP_SETTING_KEYS } from "../models/AppSetting.js";

const SEED_SETTINGS = [
  {
    key: APP_SETTING_KEYS.DEFAULT_COMMISSION_RATE,
    value: 10,
    category: APP_SETTING_CATEGORY.FINANCE,
    description: "Platform commission percentage applied to bookings when a salon has no override (Salon.business.commissionRate).",
  },
  {
    key: APP_SETTING_KEYS.GST_RATE,
    value: 18,
    category: APP_SETTING_CATEGORY.FINANCE,
    description: "GST percentage — not yet wired into booking calculations, reserved for future use.",
  },
  {
    key: APP_SETTING_KEYS.WALLET_MIN_TOPUP,
    value: 10,
    category: APP_SETTING_CATEGORY.WALLET,
    description: "Minimum wallet top-up amount in rupees.",
  },
  {
    key: APP_SETTING_KEYS.WALLET_MAX_TOPUP,
    value: 50000,
    category: APP_SETTING_CATEGORY.WALLET,
    description: "Maximum wallet top-up amount in rupees.",
  },
];

// Basic sanity check before writing — catches an obviously wrong
// seed value (e.g. commission accidentally set to 200) before it
// ever reaches the DB, rather than relying on CommissionService's
// runtime validation to silently fall back later.
const PERCENT_KEYS = [APP_SETTING_KEYS.DEFAULT_COMMISSION_RATE, APP_SETTING_KEYS.GST_RATE];

function validateSetting(setting) {
  if (PERCENT_KEYS.includes(setting.key)) {
    if (typeof setting.value !== "number" || setting.value < 0 || setting.value > 100) {
      throw new Error(`Invalid percentage for ${setting.key}: ${setting.value} (must be 0-100)`);
    }
  }
  if (setting.key.includes("WALLET_") && setting.key.includes("TOPUP")) {
    if (typeof setting.value !== "number" || setting.value < 0) {
      throw new Error(`Invalid amount for ${setting.key}: ${setting.value} (must be >= 0)`);
    }
  }
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ Connected to MongoDB");

  for (const setting of SEED_SETTINGS) {
    validateSetting(setting);

    const result = await AppSetting.updateOne(
      { key: setting.key },
      { $setOnInsert: setting },
      { upsert: true }
    );
    if (result.upsertedCount > 0) {
      console.log(`✅ Created: ${setting.key} = ${setting.value}`);
    } else {
      console.log(`⏭️  Already exists, skipped: ${setting.key}`);
    }
  }

  await mongoose.disconnect();
  console.log("✅ Done");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});