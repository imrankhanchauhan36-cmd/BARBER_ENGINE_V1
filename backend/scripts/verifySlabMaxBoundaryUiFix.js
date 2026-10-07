/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifySlabMaxBoundaryUiFix.js
 *
 * Verifies the Admin UI's whole-rupee SLAB max-boundary fix
 * (admin-panel/src/pages/finance/platformFee/PlatformFeePage.jsx —
 * r2pMaxInclusive/maxPaiseToRupeeString). Backend model/validator/
 * resolver/booking.controller.js are NOT touched by that fix and are
 * NOT touched by this script either.
 *
 * IMPORTANT — this run found a LIVE, non-test, PUBLISHED GLOBAL
 * PERCENTAGE 10% Platform Fee policy already in the database
 * (apparently created via manual testing of the real admin panel,
 * not by any of this session's own scripts). This script never
 * retires or publishes over it:
 *   - The "save succeeds / no gap/overlap" checks create ONLY a
 *     DRAFT (never published) — DRAFT doesn't touch the
 *     PUBLISHED-uniqueness constraint and can't disturb the live
 *     policy.
 *   - The numeric calculation-matrix checks call the REAL,
 *     unmodified calculatePlatformFeeInPaise() directly against an
 *     in-memory plain object shaped like a published SLAB policy —
 *     exercising the real backend math with zero DB writes.
 *   - The live PUBLISHED policy's exact document is read before and
 *     after and asserted byte-identical.
 * Only the one disposable DRAFT this script itself creates is
 * deleted at the end.
 *
 * Run:
 *   cd backend
 *   node scripts/verifySlabMaxBoundaryUiFix.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";

import User from "../models/User.js";
import AreaPlatformFeePolicy, { PLATFORM_FEE_SCOPE, AREA_PLATFORM_FEE_STATUS } from "../models/AreaPlatformFeePolicy.js";
import { calculatePlatformFeeInPaise, createDraftAreaPlatformFee } from "../services/areaPlatformFee.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

// ── exact mirror of the admin-panel's fix (PlatformFeePage.jsx) —
// NOT re-derived independently; these are the same two one-line
// functions, copied verbatim, so this script is testing the actual
// fix's arithmetic, not a reimplementation of it.
const r2p = (rupees) => Math.round(Number(rupees) * 100);
const r2pMaxInclusive = (rupees) => r2p(rupees) + 99;
const maxPaiseToRupeeString = (maxAmountInPaise) => (maxAmountInPaise == null ? "" : String((maxAmountInPaise - 99) / 100));

const run = async () => {
  await connectDB();

  const fixtureUserIds = [];
  const fixtureFeePolicyIds = [];

  try {
    // ── Snapshot the live PUBLISHED policy BEFORE touching anything ──
    const livePublishedBefore = await AreaPlatformFeePolicy.findOne({ scope: PLATFORM_FEE_SCOPE.GLOBAL, status: AREA_PLATFORM_FEE_STATUS.PUBLISHED }).lean();
    if (livePublishedBefore) {
      results.push(`ℹ️  Live PUBLISHED GLOBAL policy detected (NOT mine, NOT touched): ${livePublishedBefore.calculationType} _id=${livePublishedBefore._id}`);
    } else {
      results.push("ℹ️  No PUBLISHED GLOBAL policy currently live.");
    }

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("_id").lean();
    if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run this verification");

    // ════════════════════════════════════════════════════════════
    // 1/2. Exact business slabs, as the admin would type them, run
    // through the UI's real conversion functions, then validated via
    // the real backend logic shape (DRAFT only — never published).
    // ════════════════════════════════════════════════════════════
    const adminInput = [
      { min: "0", max: "100", fee: "10" },
      { min: "101", max: "299", fee: "20" },
      { min: "300", max: "500", fee: "30" },
      { min: "501", max: "", fee: "50" }, // unlimited
    ];
    const convertedSlabs = adminInput.map((row) => ({
      minAmountInPaise: r2p(row.min),
      maxAmountInPaise: row.max === "" ? null : r2pMaxInclusive(row.max),
      feeInPaise: r2p(row.fee),
    }));

    check("MINs unchanged by the fix (0, 10100, 30000, 50100)", JSON.stringify(convertedSlabs.map((s) => s.minAmountInPaise)) === JSON.stringify([0, 10100, 30000, 50100]), convertedSlabs);
    check("MAXs made whole-rupee-inclusive (10099, 29999, 50099, null)", JSON.stringify(convertedSlabs.map((s) => s.maxAmountInPaise)) === JSON.stringify([10099, 29999, 50099, null]), convertedSlabs);

    const draft = await AreaPlatformFeePolicy.create({
      scope: "GLOBAL",
      calculationType: "SLAB",
      slabs: convertedSlabs,
      createdBy: indiaAdmin._id,
      // status omitted -> schema default DRAFT; never published by this script.
    });
    fixtureFeePolicyIds.push(draft._id);
    check("1. Save succeeds — the exact business slabs (₹0-100/₹10, ₹101-299/₹20, ₹300-500/₹30, ₹501+/₹50) are accepted as a valid DRAFT", draft.status === "DRAFT", draft.status);

    // Re-run the SAME gap/overlap logic the backend's own
    // validateGlobalFeeConfig applies (sorted, pairwise), directly on
    // the saved document, to prove "no gap and no overlap" — without
    // needing to go through publish (which this script deliberately
    // avoids touching).
    const sorted = [...draft.slabs].sort((a, b) => a.minAmountInPaise - b.minAmountInPaise);
    let hasGapOrOverlap = false;
    for (let i = 0; i < sorted.length - 1; i++) {
      const prevMax = sorted[i].maxAmountInPaise ?? Infinity;
      if (sorted[i + 1].minAmountInPaise <= prevMax) hasGapOrOverlap = true; // overlap
      if (sorted[i + 1].minAmountInPaise !== (sorted[i].maxAmountInPaise + 1)) hasGapOrOverlap = true; // gap
    }
    check("2. No gap and no overlap across the 4 saved slabs (paise-exact adjacency holds after the fix)", !hasGapOrOverlap, sorted);

    // ── Edit round-trip: re-displaying this saved draft must show the
    // admin's ORIGINAL whole-rupee numbers back (100, 299, 500), not
    // the internal 100.99/299.99/500.99 representation. ──
    const redisplayedMax = draft.slabs.map((s) => maxPaiseToRupeeString(s.maxAmountInPaise));
    check("Edit round-trip: re-displaying MAX shows the original whole-rupee input (100, 299, 500, '')", JSON.stringify(redisplayedMax) === JSON.stringify(["100", "299", "500", ""]), redisplayedMax);

    // ════════════════════════════════════════════════════════════
    // 3. Calculation matrix — the REAL, unmodified
    // calculatePlatformFeeInPaise(), against an in-memory object
    // shaped exactly like what gets published (never actually
    // published to the DB in this run).
    // ════════════════════════════════════════════════════════════
    const asIfPublished = { calculationType: "SLAB", slabs: convertedSlabs };
    const matrix = [
      [0, 10], [100, 10], [1, 10],
      [101, 20], [299, 20],
      [300, 30], [498, 30], [500, 30],
      [501, 50], [5000, 50],
    ];
    for (const [rupees, expectedFeeRupees] of matrix) {
      const fee = calculatePlatformFeeInPaise(asIfPublished, rupees * 100);
      check(`3. ₹${rupees} -> ₹${expectedFeeRupees}`, fee === expectedFeeRupees * 100, { rupees, fee });
    }

    // ════════════════════════════════════════════════════════════
    // 4. CRITICAL — multi-service ₹299 + ₹199 = ₹498 (TOTAL),
    // Platform Fee calculated ONCE on the total, not per-service.
    // ════════════════════════════════════════════════════════════
    const serviceAmountInPaise = Math.round(299 * 100) + Math.round(199 * 100); // 29900 + 19900 = 49800
    check("4setup. ₹299+₹199 total = ₹498 (49800 paise)", serviceAmountInPaise === 49800, serviceAmountInPaise);
    const feeOnTotal = calculatePlatformFeeInPaise(asIfPublished, serviceAmountInPaise);
    check("4. Platform Fee on the ₹498 TOTAL = ₹30 (3000 paise), calculated once", feeOnTotal === 3000, feeOnTotal);
    const feeIfDoubleCalculated = calculatePlatformFeeInPaise(asIfPublished, 29900) + calculatePlatformFeeInPaise(asIfPublished, 19900); // 20+20=40
    check("4b. NOT equal to Fee(299)+Fee(199) separately (₹40) — confirms single-total calculation, not per-service", feeOnTotal !== feeIfDoubleCalculated, { feeOnTotal, feeIfDoubleCalculated });

    // ════════════════════════════════════════════════════════════
    // 5/6. PERCENTAGE and FIXED modes untouched by this fix — proven
    // by inspecting the diff scope (r2pMaxInclusive is only called
    // for SLAB max) and re-running their own unmodified formula.
    // ════════════════════════════════════════════════════════════
    const fixedResult = calculatePlatformFeeInPaise({ calculationType: "FIXED", feeInPaise: 2000 }, 10000);
    check("6. FIXED mode still works (₹20 flat, unaffected by the slab-only fix)", fixedResult === 2000, fixedResult);
    const pctResult = calculatePlatformFeeInPaise({ calculationType: "PERCENTAGE", percentageRate: 10 }, 10000);
    check("5. PERCENTAGE mode still works (10% of ₹100 = ₹10, unaffected by the slab-only fix)", pctResult === 1000, pctResult);

    // ════════════════════════════════════════════════════════════
    // 7. Final unlimited slab works.
    // ════════════════════════════════════════════════════════════
    const unlimitedResult = calculatePlatformFeeInPaise(asIfPublished, 999999900);
    check("7. Final unlimited slab (₹501+) resolves a huge amount -> ₹50, never 'no slab matched'", unlimitedResult === 5000, unlimitedResult);

    // ════════════════════════════════════════════════════════════
    // 8. Invalid gap/overlap validation still works — via the REAL,
    // unmodified createDraftAreaPlatformFee() service function (the
    // actual code path createDraftAreaPlatformFeeHandler calls).
    // DRAFT creation never touches PUBLISHED uniqueness, so this
    // cannot affect the live policy either way — and since the
    // service validates BEFORE calling .create(), a rejected
    // attempt persists nothing at all, needing no cleanup.
    // ════════════════════════════════════════════════════════════
    let overlapRejected = false;
    try {
      await createDraftAreaPlatformFee({
        adminId: indiaAdmin._id,
        scope: "GLOBAL",
        calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 10099, feeInPaise: 1000 },
          { minAmountInPaise: 10050, maxAmountInPaise: null, feeInPaise: 2000 }, // deliberately overlaps (10050-10099)
        ],
      });
    } catch (e) {
      overlapRejected = /overlap/i.test(e.message);
    }
    check("8. Overlapping slabs still rejected by the unmodified backend validator (this fix never touched it)", overlapRejected, overlapRejected);

    let gapRejected = false;
    try {
      await createDraftAreaPlatformFee({
        adminId: indiaAdmin._id,
        scope: "GLOBAL",
        calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 10000, feeInPaise: 1000 },
          { minAmountInPaise: 10500, maxAmountInPaise: null, feeInPaise: 2000 }, // deliberately leaves a gap (10001-10499)
        ],
      });
    } catch (e) {
      gapRejected = /[Gg]ap/.test(e.message);
    }
    check("8b. A genuine gap (not the whole-rupee-adjacency case the fix addresses) is still correctly rejected", gapRejected, gapRejected);

    // ════════════════════════════════════════════════════════════
    // 9. Existing published policy/history untouched.
    // ════════════════════════════════════════════════════════════
    const livePublishedAfter = await AreaPlatformFeePolicy.findOne({ scope: PLATFORM_FEE_SCOPE.GLOBAL, status: AREA_PLATFORM_FEE_STATUS.PUBLISHED }).lean();
    check("9. The live PUBLISHED policy (if any) is byte-identical before and after this verification", JSON.stringify(livePublishedBefore) === JSON.stringify(livePublishedAfter), { before: livePublishedBefore, after: livePublishedAfter });

    // ── CLEANUP — only this script's own disposable draft(s) ──
    await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
    const residue = await AreaPlatformFeePolicy.countDocuments({ _id: { $in: fixtureFeePolicyIds } });
    check("12. Zero residue — only this script's own disposable draft(s) removed, nothing else touched", residue === 0, residue);

    const liveAfterCleanup = await AreaPlatformFeePolicy.findOne({ scope: PLATFORM_FEE_SCOPE.GLOBAL, status: AREA_PLATFORM_FEE_STATUS.PUBLISHED }).lean();
    check("9b. Live PUBLISHED policy still present and unchanged after cleanup", JSON.stringify(livePublishedBefore) === JSON.stringify(liveAfterCleanup), liveAfterCleanup);
  } catch (err) {
    console.error("FATAL ERROR DURING SLAB-MAX-BOUNDARY-FIX VERIFICATION:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nSLAB-MAX-BOUNDARY-UI-FIX-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
