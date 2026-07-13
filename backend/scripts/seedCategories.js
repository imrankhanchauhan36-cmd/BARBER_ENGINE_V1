/**
 * BARBER_ENGINE_V1
 * backend/scripts/seedCategories.js
 *
 * One-time seed for the Category Discovery Engine's V1 taxonomy.
 *
 * Idempotent — safe to re-run. Uses upsert on `slug` (the permanent
 * identifier) so re-running this script updates existing categories
 * in place rather than creating duplicates or throwing on unique-
 * index conflicts.
 *
 * Run:
 *   cd backend
 *   node scripts/seedCategories.js
 *
 * All 9 "active" categories map to real Service.category values
 * confirmed present in the DB (see conversation history) EXCEPT
 * Massage — no service is currently tagged with a Massage-matching
 * category (the one "head massage" service found is mistagged
 * WAXING). Activated anyway per product decision; category will
 * simply show empty results until a salon adds a matching service —
 * no code change needed when that happens.
 *
 * Grooming Packages and Bridal are seeded isActive:false,
 * comingSoon:true — invisible to the public Discovery API until an
 * admin flips isActive:true (via the future admin panel, or directly
 * in the DB for now).
 */

import "dotenv/config";
import mongoose from "mongoose";
import Category from "../models/Category.js";

const CATEGORIES = [
  {
    code: "CAT_HAIRCUT",
    slug: "haircut",
    displayName: "Haircut",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 1,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_BEARD",
    slug: "beard",
    displayName: "Beard",
    applicableFor: ["MEN"],
    systemCategory: true,
    displayOrder: 2,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_HAIR_SPA",
    slug: "hair-spa",
    displayName: "Hair Spa",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 3,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_FACIAL",
    slug: "facial",
    displayName: "Facial",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 4,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_HAIR_COLOR",
    slug: "hair-color",
    displayName: "Hair Color",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 5,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_MASSAGE",
    slug: "massage",
    displayName: "Massage",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 6,
    isActive: true,
    comingSoon: false,
    // NOTE: no confirmed matching Service data yet — see file header.
  },
  {
    code: "CAT_MANICURE",
    slug: "manicure",
    displayName: "Manicure",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 7,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_PEDICURE",
    slug: "pedicure",
    displayName: "Pedicure",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 8,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_WAXING",
    slug: "waxing",
    displayName: "Waxing",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 9,
    isActive: true,
    comingSoon: false,
  },
  {
    code: "CAT_GROOMING_PACKAGES",
    slug: "grooming-packages",
    displayName: "Grooming Packages",
    applicableFor: ["MEN", "WOMEN"],
    systemCategory: true,
    displayOrder: 10,
    isActive: false,   // hidden until admin activates
    comingSoon: true,
  },
  {
    code: "CAT_BRIDAL",
    slug: "bridal",
    displayName: "Bridal",
    applicableFor: ["WOMEN"],
    systemCategory: true,
    displayOrder: 11,
    isActive: false,   // hidden until admin activates
    comingSoon: true,
  },
];

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not found in environment");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  let created = 0;
  let updated = 0;

  for (const cat of CATEGORIES) {
    const result = await Category.findOneAndUpdate(
      { slug: cat.slug },
      { $set: cat },
      { upsert: true, new: true, rawResult: true }
    );

    if (result.lastErrorObject?.upserted) {
      created++;
      console.log(`  ➕ Created: ${cat.displayName} (${cat.slug})`);
    } else {
      updated++;
      console.log(`  🔄 Updated: ${cat.displayName} (${cat.slug})`);
    }
  }

  console.log("---");
  console.log(`Done. Created: ${created}, Updated: ${updated}, Total: ${CATEGORIES.length}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});