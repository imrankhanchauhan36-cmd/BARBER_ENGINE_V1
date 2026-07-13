/**
 * BARBER_ENGINE_V1
 * backend/scripts/updateCategoryIcons.js
 *
 * One-time update — sets iconUrl on each category using Unsplash
 * photos (free-license, no attribution required, no hosting needed
 * on our side since Unsplash serves the CDN directly).
 *
 * NOTE: "massage" currently reuses the same photo as "hair-spa" as a
 * placeholder — no distinct free massage photo was sourced yet.
 * Replace its URL below whenever a better one is found; re-running
 * this script is safe (idempotent, matches on slug).
 *
 * Run:
 *   cd backend
 *   node scripts/updateCategoryIcons.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import Category from "../models/Category.js";

const ICON_UPDATES = {
  "haircut":    "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=300",
  "beard":      "https://images.unsplash.com/photo-1621605815971-fbc98d665033?q=80&w=300",
  "hair-spa":   "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?q=80&w=300",
  "facial":     "https://images.unsplash.com/photo-1596178065887-1198b6148b2b?q=80&w=300",
  "hair-color": "https://images.unsplash.com/photo-1560869713-7d0a29430803?q=80&w=300",
  "massage":    "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?q=80&w=300", // TODO: replace — temp dupe of hair-spa
  "manicure":   "https://images.unsplash.com/photo-1632345031435-8727f6897d53?q=80&w=300",
  "pedicure":   "https://images.unsplash.com/photo-1610992015762-45dca7fa3a85?q=80&w=300",
  "waxing":     "https://images.unsplash.com/photo-1571875257727-256c39da42af?q=80&w=300",
};

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("❌ MONGODB_URI not found in environment");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("✅ Connected to MongoDB");

  let updated = 0;
  let notFound = 0;

  for (const [slug, iconUrl] of Object.entries(ICON_UPDATES)) {
    const result = await Category.findOneAndUpdate(
      { slug },
      { $set: { iconUrl } },
      { new: true }
    );

    if (result) {
      updated++;
      console.log(`  🖼️  Updated: ${result.displayName} (${slug})`);
    } else {
      notFound++;
      console.log(`  ⚠️  No category found for slug: ${slug}`);
    }
  }

  console.log("---");
  console.log(`Done. Updated: ${updated}, Not found: ${notFound}`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("❌ Update failed:", err.message);
  process.exit(1);
});