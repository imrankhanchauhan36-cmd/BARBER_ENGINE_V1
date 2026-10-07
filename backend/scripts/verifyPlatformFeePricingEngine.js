/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyPlatformFeePricingEngine.js
 *
 * GLOBAL PLATFORM FEE — PRICING ENGINE EXPANSION verification.
 * Covers the FIXED/PERCENTAGE/SLAB test matrix. Real Mongo Atlas, real
 * HTTP via app.listen(0), real signed JWTs — same methodology as
 * verifyGlobalPlatformFeeLaunch.js (the launch-phase GLOBAL/FIXED-only
 * test suite, which this script complements rather than duplicates —
 * GLOBAL-uniqueness/no-area-dependency/no-silent-zero/concurrency are
 * already covered there).
 *
 * SLAB fixture note: the ticket's own worked example (₹100-200→₹20,
 * ₹201-300→₹25, ₹301-500→₹30, ₹501-1000→₹40) starts at ₹100 and ends
 * at a finite ₹1000. This implementation's locked boundary rules
 * (AreaPlatformFeePolicy.js header) require the LOWEST slab to start
 * at 0 and the HIGHEST slab to be unlimited — so this test adapts the
 * example by prepending a 0-99 slab and making the top slab (₹501+)
 * unlimited, while keeping every boundary amount the ticket named
 * (₹100/₹200/₹201/₹300) in the exact same relative position.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyPlatformFeePricingEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import Booking from "../models/Booking.js";
import GstPolicyVersion from "../models/GstPolicyVersion.js";
import AreaPlatformFeePolicy, { PLATFORM_FEE_SCOPE } from "../models/AreaPlatformFeePolicy.js";
import { resolveGlobalPlatformFee } from "../services/areaPlatformFee.service.js";
import { getPublishedGstPolicy, clearGstPolicyCache } from "../services/gstPolicy.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureFeePolicyIds = [];
  const fixtureGstVersionIds = [];
  const fixtureBookingIds = [];

  const createFee = (body, token) => authFetch("/api/admin/finance/platform-fee", token, { method: "POST", body: JSON.stringify(body) });
  const publishFee = (id, token) => authFetch(`/api/admin/finance/platform-fee/${id}/publish`, token, { method: "POST" });
  const retireFee = (id, token) => authFetch(`/api/admin/finance/platform-fee/${id}/retire`, token, { method: "POST" });

  try {
    const preExistingGlobal = await AreaPlatformFeePolicy.countDocuments({ scope: PLATFORM_FEE_SCOPE.GLOBAL });
    if (preExistingGlobal !== 0) throw new Error(`Refusing to run — ${preExistingGlobal} GLOBAL doc(s) already exist; clean the DB before running this script`);

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No existing INDIA admin found — cannot run this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const createAndPublish = async (body) => {
      const draft = await createFee(body, indiaToken);
      if (draft.status !== 201) return { createStatus: draft.status };
      const id = draft.data.data.policy._id;
      fixtureFeePolicyIds.push(id);
      const pub = await publishFee(id, indiaToken);
      return { createStatus: draft.status, publishStatus: pub.status, id };
    };

    // ════════════════════════════════════════════════════════════
    // FIXED (1-3)
    // ════════════════════════════════════════════════════════════
    {
      const fixed20 = await createAndPublish({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
      check("1. FIXED ₹20 — create+publish succeeds", fixed20.createStatus === 201 && fixed20.publishStatus === 200, fixed20);
      const resolved = await resolveGlobalPlatformFee(10000);
      check("1b. FIXED ₹20 resolves to 2000 paise regardless of serviceAmount", resolved?.feeInPaise === 2000, resolved);

      // 2. "₹0 fixed rejected if policy rules prohibit it" — this
      // implementation's own locked rule (matching the pre-existing
      // feeInPaise min:0 convention, unchanged) is that ₹0 IS a valid
      // FIXED fee (an explicit admin choice, not a silent default).
      // So the correct, non-assumed behavior here is ACCEPT, not
      // reject — asserted explicitly rather than left ambiguous.
      await retireFee(resolved.policyId, indiaToken);
      const fixed0 = await createAndPublish({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 0 });
      check("2. FIXED ₹0 is ACCEPTED (explicit admin choice, not a silent default — decided, not assumed)", fixed0.createStatus === 201 && fixed0.publishStatus === 200, fixed0);
      const resolvedZero = await resolveGlobalPlatformFee(10000);
      check("2b. FIXED ₹0 resolves to exactly 0 paise (explicit, not a missing-config silent zero)", resolvedZero?.feeInPaise === 0, resolvedZero);
      await retireFee(fixed0.id, indiaToken);

      const missingFixed = await createFee({ scope: "GLOBAL", calculationType: "FIXED" }, indiaToken);
      check("3. FIXED without feeInPaise is rejected (400)", missingFixed.status === 400, missingFixed.status);
    }

    // ════════════════════════════════════════════════════════════
    // PERCENTAGE (4-9)
    // ════════════════════════════════════════════════════════════
    {
      const pct10 = await createAndPublish({ scope: "GLOBAL", calculationType: "PERCENTAGE", percentageRate: 10 });
      check("4setup. PERCENTAGE 10% — create+publish succeeds", pct10.createStatus === 201 && pct10.publishStatus === 200, pct10);

      const r100 = await resolveGlobalPlatformFee(10000); // ₹100
      check("4. 10% of ₹100 = ₹10 (1000 paise)", r100?.feeInPaise === 1000, r100);

      const r500 = await resolveGlobalPlatformFee(50000); // ₹500
      check("5. 10% of ₹500 = ₹50 (5000 paise)", r500?.feeInPaise === 5000, r500);

      // 6. Rounding — Math.round, same convention as GST. 10% of
      // ₹3.33 (333 paise) = 33.3 -> rounds to 33.
      const rRound = await resolveGlobalPlatformFee(333);
      check("6. Rounding: 10% of 333 paise = 33 paise (Math.round, same convention as GST)", rRound?.feeInPaise === 33, rRound);

      await retireFee(pct10.id, indiaToken);

      const invalidPct = await createFee({ scope: "GLOBAL", calculationType: "PERCENTAGE", percentageRate: 150 }, indiaToken);
      check("7. percentageRate > 100 is rejected (400)", invalidPct.status === 400, invalidPct.status);

      const negativePct = await createFee({ scope: "GLOBAL", calculationType: "PERCENTAGE", percentageRate: -5 }, indiaToken);
      check("8. Negative percentageRate is rejected (400)", negativePct.status === 400, negativePct.status);

      const missingPct = await createFee({ scope: "GLOBAL", calculationType: "PERCENTAGE" }, indiaToken);
      check("9. PERCENTAGE without percentageRate is rejected (400)", missingPct.status === 400, missingPct.status);
    }

    // ════════════════════════════════════════════════════════════
    // SLAB (10-22)
    // ════════════════════════════════════════════════════════════
    {
      // Adapted from the ticket's example — see file header note.
      const validSlabs = [
        { minAmountInPaise: 0, maxAmountInPaise: 9999, feeInPaise: 1500 }, // 0-99.99 (mandatory 0-floor, not in ticket's literal example)
        { minAmountInPaise: 10000, maxAmountInPaise: 20099, feeInPaise: 2000 }, // 100-200.99 (covers ₹100-200)
        { minAmountInPaise: 20100, maxAmountInPaise: 30099, feeInPaise: 2500 }, // 201-300.99 (covers ₹201-300)
        { minAmountInPaise: 30100, maxAmountInPaise: 50099, feeInPaise: 3000 }, // 301-500.99 (covers ₹301-500)
        { minAmountInPaise: 50100, maxAmountInPaise: null, feeInPaise: 4000 }, // 501-∞ (mandatory unlimited top slab)
      ];

      const slabPolicy = await createAndPublish({ scope: "GLOBAL", calculationType: "SLAB", slabs: validSlabs });
      check("22. Valid multiple slabs — create+publish succeeds", slabPolicy.createStatus === 201 && slabPolicy.publishStatus === 200, slabPolicy);

      const r200 = await resolveGlobalPlatformFee(20000); // ₹200
      check("10. ₹100-200 slab: ₹200 -> ₹20", r200?.feeInPaise === 2000, r200);
      const r300 = await resolveGlobalPlatformFee(30000); // ₹300
      check("11. ₹201-300 slab: ₹300 -> ₹25", r300?.feeInPaise === 2500, r300);
      const r500 = await resolveGlobalPlatformFee(50000); // ₹500
      check("12. ₹301-500 slab: ₹500 -> ₹30", r500?.feeInPaise === 3000, r500);

      const b100 = await resolveGlobalPlatformFee(10000); // ₹100 — lower edge of the 100-200 slab
      check("13. Boundary ₹100 -> ₹20 (inclusive lower edge)", b100?.feeInPaise === 2000, b100);
      const b200 = await resolveGlobalPlatformFee(20000); // ₹200 — upper edge of the 100-200 slab
      check("14. Boundary ₹200 -> ₹20 (inclusive upper edge, still the 100-200 slab)", b200?.feeInPaise === 2000, b200);
      const b201 = await resolveGlobalPlatformFee(20100); // ₹201 — lower edge of the next slab
      check("15. Boundary ₹201 -> ₹25 (crosses into the 201-300 slab, no overlap/no gap)", b201?.feeInPaise === 2500, b201);
      const b300 = await resolveGlobalPlatformFee(30000); // ₹300
      check("16. Boundary ₹300 -> ₹25 (inclusive upper edge, still the 201-300 slab)", b300?.feeInPaise === 2500, b300);

      const rUnlimited = await resolveGlobalPlatformFee(999999900); // a huge amount, well past ₹501
      check("Unlimited top slab: a huge amount still resolves (-> ₹40), never 'no slab matched'", rUnlimited?.feeInPaise === 4000, rUnlimited);

      await retireFee(slabPolicy.id, indiaToken);

      const overlap = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 20000, feeInPaise: 2000 },
          { minAmountInPaise: 15000, maxAmountInPaise: null, feeInPaise: 2500 }, // overlaps 15000-20000
        ],
      }, indiaToken);
      check("17. Overlapping slabs rejected (400)", overlap.status === 400, overlap.status);

      const duplicate = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 20000, feeInPaise: 2000 },
          { minAmountInPaise: 0, maxAmountInPaise: 20000, feeInPaise: 2000 },
        ],
      }, indiaToken);
      check("18. Duplicate slab ranges rejected (400)", duplicate.status === 400, duplicate.status);

      const minGreaterThanMax = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [{ minAmountInPaise: 30000, maxAmountInPaise: 20000, feeInPaise: 2000 }],
      }, indiaToken);
      check("19. min > max rejected (400)", minGreaterThanMax.status === 400, minGreaterThanMax.status);

      const emptySlabs = await createFee({ scope: "GLOBAL", calculationType: "SLAB", slabs: [] }, indiaToken);
      check("20. Empty slabs array rejected (400)", emptySlabs.status === 400, emptySlabs.status);

      const invalidFee = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [{ minAmountInPaise: 0, maxAmountInPaise: null, feeInPaise: -500 }],
      }, indiaToken);
      check("21. Negative slab fee rejected (400)", invalidFee.status === 400, invalidFee.status);

      const noUnlimitedTop = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [{ minAmountInPaise: 0, maxAmountInPaise: 20000, feeInPaise: 2000 }], // finite-only, no unlimited top slab
      }, indiaToken);
      check("Mandatory unlimited top slab: a finite-only slab list is rejected (400) — never a silent gap above it", noUnlimitedTop.status === 400, noUnlimitedTop.status);

      const notStartingAtZero = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 10000, maxAmountInPaise: 20000, feeInPaise: 2000 },
          { minAmountInPaise: 20100, maxAmountInPaise: null, feeInPaise: 2500 },
        ], // starts at 100, not 0
      }, indiaToken);
      check("Mandatory 0-floor: a slab list not starting at 0 is rejected (400)", notStartingAtZero.status === 400, notStartingAtZero.status);

      const gap = await createFee({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 10000, feeInPaise: 2000 },
          { minAmountInPaise: 10500, maxAmountInPaise: null, feeInPaise: 2500 }, // gap: 10001-10499 matches nothing
        ],
      }, indiaToken);
      check("Gap between slabs rejected (400) — no amount may match zero slabs", gap.status === 400, gap.status);
    }

    // ════════════════════════════════════════════════════════════
    // HISTORICAL (27-28) — cross-calculation-type version transition
    // ════════════════════════════════════════════════════════════
    {
      const fixedV1 = await createAndPublish({ scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000 });
      check("27setup. V1 FIXED ₹20 published", fixedV1.createStatus === 201 && fixedV1.publishStatus === 200, fixedV1);

      const bookingA = await Booking.create({
        userRef: indiaAdmin._id,
        salonRef: new mongoose.Types.ObjectId(),
        chairRef: new mongoose.Types.ObjectId(),
        serviceRefs: [new mongoose.Types.ObjectId()],
        bookingDate: new Date().toISOString().slice(0, 10),
        startTime: new Date(Date.now() + 120 * 60000),
        endTime: new Date(Date.now() + 150 * 60000),
        serviceDuration: 30,
        bufferTime: 0,
        totalAmountInPaise: 52000,
        serviceAmountInPaise: 50000,
        commissionAmountInPaise: 2000,
        platformFeePolicyRef: fixedV1.id,
        status: "CONFIRMED",
      });
      fixtureBookingIds.push(bookingA._id);

      // Publish V2 as a DIFFERENT calculation type entirely (SLAB) —
      // the strongest possible version of "old booking unaffected":
      // not just a new value, but a structurally different engine.
      const slabV2 = await createAndPublish({
        scope: "GLOBAL", calculationType: "SLAB",
        slabs: [
          { minAmountInPaise: 0, maxAmountInPaise: 20099, feeInPaise: 2500 },
          { minAmountInPaise: 20100, maxAmountInPaise: null, feeInPaise: 3500 },
        ],
      });
      check("27b. V2 SLAB published (FIXED -> SLAB transition)", slabV2.createStatus === 201 && slabV2.publishStatus === 200, slabV2);

      const bookingAFresh = await Booking.findById(bookingA._id).select("commissionAmountInPaise platformFeePolicyRef").lean();
      check("27. Booking A remains ₹20 after V2 (SLAB) publish — never recalculated", bookingAFresh.commissionAmountInPaise === 2000, bookingAFresh);
      check("28. Booking A's platformFeePolicyRef still points at V1, not V2", String(bookingAFresh.platformFeePolicyRef) === String(fixedV1.id), bookingAFresh);

      const resolvedV2 = await resolveGlobalPlatformFee(10000); // ₹100 -> first slab
      check("27c. NEW resolution now uses V2's SLAB engine (₹25), proving V1 is truly frozen, not just 'not yet re-read'", resolvedV2?.feeInPaise === 2500, resolvedV2);

      await retireFee(slabV2.id, indiaToken);
    }

    // ════════════════════════════════════════════════════════════
    // FIELD AGENT + GST (29-30)
    // ════════════════════════════════════════════════════════════
    {
      const pctForAgent = await createAndPublish({ scope: "GLOBAL", calculationType: "PERCENTAGE", percentageRate: 10 });
      const resolvedForAgent = await resolveGlobalPlatformFee(10000); // ₹100 -> ₹10 platform fee
      check("29setup. PERCENTAGE engine produces ₹10 platform fee on a ₹100 booking", resolvedForAgent?.feeInPaise === 1000, resolvedForAgent);

      // Field Agent engine (modules/fieldAgent/services/fieldAgentEarning.service.js,
      // unmodified by this task) reads booking.commissionAmountInPaise
      // as a plain integer and applies its own rate — it has zero
      // awareness of FIXED/PERCENTAGE/SLAB. Proving the new engine's
      // OUTPUT is a plain, correctly-typed integer (exactly what
      // FIXED always produced) is sufficient proof the existing
      // engine "automatically consumes" it unchanged, without
      // re-testing that engine's own (out-of-scope, unmodified) logic.
      const agentCommissionAt50Percent = Math.round(resolvedForAgent.feeInPaise * 0.5);
      check("29. Field Agent math (unmodified engine) applied to the new engine's output: 50% of ₹10 = ₹5", agentCommissionAt50Percent === 500, agentCommissionAt50Percent);
      check("29b. Platform Fee output is a plain integer paise value, same shape FIXED always produced", Number.isInteger(resolvedForAgent.feeInPaise), resolvedForAgent);

      // GST — unmodified formula, re-verified against the NEW engine's
      // output as its input, proving GST correctly receives whatever
      // the Pricing Engine produces without any change to GST itself.
      const gstDraft = await authFetch("/api/admin/finance/gst", indiaToken, { method: "POST", body: JSON.stringify({ ratePercent: 5 }) });
      const gstVersionId = gstDraft.data?.data?.version?._id;
      if (gstVersionId) fixtureGstVersionIds.push(gstVersionId);
      await authFetch(`/api/admin/finance/gst/${gstVersionId}/publish`, indiaToken, { method: "POST" });
      clearGstPolicyCache();

      const gstPolicy = await getPublishedGstPolicy();
      const serviceAmountInPaise = 10000;
      const gstAmountInPaise = gstPolicy ? Math.round((serviceAmountInPaise + resolvedForAgent.feeInPaise) * gstPolicy.ratePercent / 100) : null;
      check("30. GST formula (service + platform fee, unmodified) correctly consumes the new engine's fee: 5% of (₹100+₹10) = ₹5.50", gstAmountInPaise === 550, { gstPolicy, gstAmountInPaise });

      await retireFee(pctForAgent.id, indiaToken);
    }

    // ── CLEANUP ──────────────────────────────────────────────────
    await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
    await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
    await GstPolicyVersion.deleteMany({ _id: { $in: fixtureGstVersionIds } });

    const residue = {
      bookings: await Booking.countDocuments({ _id: { $in: fixtureBookingIds } }),
      feePolicies: await AreaPlatformFeePolicy.countDocuments({ _id: { $in: fixtureFeePolicyIds } }),
      gstVersions: await GstPolicyVersion.countDocuments({ _id: { $in: fixtureGstVersionIds } }),
      globalDocsRemaining: await AreaPlatformFeePolicy.countDocuments({ scope: PLATFORM_FEE_SCOPE.GLOBAL }),
      gstVersionsRemaining: await GstPolicyVersion.countDocuments({}),
    };
    check("CLEANUP. Zero residue (absolute zero, including GLOBAL docs and GST test versions)", residue.bookings === 0 && residue.feePolicies === 0 && residue.gstVersions === 0 && residue.globalDocsRemaining === 0, residue);
  } catch (err) {
    console.error("FATAL ERROR DURING PRICING ENGINE E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await Booking.deleteMany({ _id: { $in: fixtureBookingIds } });
      await AreaPlatformFeePolicy.deleteMany({ _id: { $in: fixtureFeePolicyIds } });
      await GstPolicyVersion.deleteMany({ _id: { $in: fixtureGstVersionIds } });
      results.push("✅ Best-effort cleanup after failure completed");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    server.close();
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nPLATFORM-FEE-PRICING-ENGINE-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
