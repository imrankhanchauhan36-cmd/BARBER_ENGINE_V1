/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyBookingPricingQuoteFoundation.mjs
 *
 * SHARED BOOKING PRICING ENGINE + CART QUOTE — Phase 2 focused tests
 * (additive, 2026-10-12). Verifies services/bookingPricing.service.js
 * (the function now shared between lockSlot and the new read-only
 * GET /v1/bookings/user/quote endpoint) without touching the real
 * project database.
 *
 * SAFE/LOCAL BY CONSTRUCTION — same pattern as Phase 1's
 * scripts/unit/verifyPlatformFeeGstPolicyFoundation.mjs and the
 * pre-existing scripts/e2e/verifyFieldAgentGeographyModel.js: a
 * disposable, in-process, network-isolated MongoDB replica set
 * (mongodb-memory-server, already a devDependency). Placed under
 * scripts/e2e/ rather than scripts/unit/ because it creates real
 * document fixtures (Service/Salon/GstPolicyVersion/
 * AreaPlatformFeePolicy) — matching where every OTHER
 * mongodb-memory-server-based fixture test in this repo already
 * lives (verifyFieldAgentGeographyModel.js, verifyFieldAgentGeographyAdmin.js,
 * etc.); scripts/unit/ is reserved for genuinely zero-database checks
 * (see verifyRoleConfigDriftDetection.mjs's own header).
 *
 * SCOPE NOTE (read before trusting item 8/10 beyond what they claim):
 * this script exercises services/bookingPricing.service.js directly —
 * the actual new shared engine both lockSlot and the quote ROUTE call
 * — including once with a real multi-document transaction/session
 * (mirroring exactly how lockSlot calls it) and once without (mirroring
 * exactly how the quote route calls it), and asserts the results are
 * identical. It does NOT boot a full Express HTTP server or sign a
 * real JWT to drive the actual /lock or /quote routes end-to-end —
 * that full HTTP-level integration (plus the slot-engine/chair/working-
 * hours fixtures lockSlot's OTHER logic depends on) is explicitly
 * listed as remaining Phase 3 work in this phase's report, not
 * silently skipped. Item 10 here is a structural check against the
 * REAL, imported booking.routes.js router object (confirming the
 * route exists, at the right path/method, under the same
 * already-authenticated userRouter as the pre-existing read-only
 * endpoints) — not a live HTTP/auth round-trip.
 *
 * Run:  cd backend && node scripts/e2e/verifyBookingPricingQuoteFoundation.mjs
 */

// booking.routes.js (imported below, for the item-10 structural check)
// transitively imports middlewares/idempotency.middleware.js ->
// config/redis.js, which eagerly connects to the REAL REDIS_URL at
// module-load time unless this exact opt-out is set first (the same
// guard already added earlier in this engagement for isolated test
// servers). Setting it here keeps this script fully local/offline —
// it never attempts any Redis connection, real or otherwise.
process.env.SKIP_REDIS_AUTOCONNECT = "true";

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};
const oid = () => new mongoose.Types.ObjectId();

const run = async () => {
  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(mem.getUri(), { dbName: "booking_pricing_quote_foundation" });

  const Booking = (await import("../../models/Booking.js")).default;
  const Salon = (await import("../../models/Salon.js")).default;
  const Service = (await import("../../models/Service.js")).default;
  const GstPolicyVersion = (await import("../../models/GstPolicyVersion.js")).default;
  const AreaPlatformFeePolicy = (await import("../../models/AreaPlatformFeePolicy.js")).default;
  const { calculateBookingPricing } = await import("../../services/bookingPricing.service.js");
  const { createDraftGstPolicy, publishGstPolicy } = await import("../../services/gstPolicy.service.js");
  const { createDraftAreaPlatformFee, publishAreaPlatformFee } = await import("../../services/areaPlatformFee.service.js");

  const adminId = oid();

  // timings.<day> defaults to an empty DayScheduleSchema sub-doc,
  // whose own pre-validate hook requires open/close unless isClosed —
  // irrelevant to pricing, but required for Salon.create() to pass
  // schema validation at all.
  const CLOSED_DAY = { isClosed: true };
  const ALL_DAYS_CLOSED = {
    monday: CLOSED_DAY, tuesday: CLOSED_DAY, wednesday: CLOSED_DAY, thursday: CLOSED_DAY,
    friday: CLOSED_DAY, saturday: CLOSED_DAY, sunday: CLOSED_DAY,
  };
  const makeSalon = (gstStatus) => Salon.create({
    ownerId: oid(),
    basicInfo: { shopName: `Test Salon ${oid()}`, category: "UNISEX", gstStatus },
    timings: ALL_DAYS_CLOSED,
  });

  const makeService = (salonId, priceRupees) => Service.create({
    salonId, name: `svc-${oid()}`, price: priceRupees, duration: 30,
  });

  try {
    // Baseline: publish a GLOBAL FIXED Platform Fee once (shared by
    // every scenario below) — ₹20 flat, matching the launch example
    // used throughout this engagement's own audit scripts.
    const feeDraft = await createDraftAreaPlatformFee({
      adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 2000,
    });
    await publishAreaPlatformFee({ policyId: feeDraft._id, adminId });

    const salonRegistered = await makeSalon("REGISTERED");
    const salonUnregistered = await makeSalon("UNREGISTERED");
    const svc500 = await makeService(salonRegistered._id, 500);
    const svc500u = await makeService(salonUnregistered._id, 500);

    // ════════════════════════════════════════════════════════════
    // PRIORITY 1 SAFETY FIX — 1 + 9. Legacy-shaped published GST
    // policy (service rates present, platformFeeGstRatePercent
    // ABSENT) must now THROW a 503/PLATFORM_FEE_GST_NOT_CONFIGURED
    // error — in BOTH quote-mode (no session) and lock-mode (real
    // transaction) — rather than silently returning a seemingly
    // complete total with no platform-fee GST at all. This is the
    // exact scenario empirically confirmed (before this fix existed)
    // to let a booking/payment proceed with an incomplete total.
    // ════════════════════════════════════════════════════════════
    const gstDraftLegacy = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0 });
    await publishGstPolicy({ versionId: gstDraftLegacy._id, adminId });

    let legacyQuoteErr = null;
    try { await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id)] }); }
    catch (e) { legacyQuoteErr = e; }
    check("1a/9a. Legacy policy (no platformFeeGstRatePercent) makes quote-mode THROW 503/PLATFORM_FEE_GST_NOT_CONFIGURED, never a fabricated rate", legacyQuoteErr?.status === 503 && legacyQuoteErr?.code === "PLATFORM_FEE_GST_NOT_CONFIGURED", legacyQuoteErr && { status: legacyQuoteErr.status, code: legacyQuoteErr.code, message: legacyQuoteErr.message });

    // Same retry wrapper as item 8 below — a single-node memory-server
    // replica set can surface a transient MongoDB LockTimeout
    // (errmsg code 24, nothing to do with our own application error
    // shape) under a real transaction with no genuine contention.
    let legacyLockErr = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const probeSession = await mongoose.startSession();
      let transientMongoError = null;
      try {
        probeSession.startTransaction();
        await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id)], session: probeSession });
      } catch (e) {
        if (e.code === 24 || (typeof e.hasErrorLabel === "function" && e.hasErrorLabel("TransientTransactionError"))) {
          transientMongoError = e;
        } else {
          legacyLockErr = e;
        }
      } finally {
        if (probeSession.inTransaction()) await probeSession.abortTransaction();
        probeSession.endSession();
      }
      if (!transientMongoError) break;
    }
    check("1b/9b. Same legacy policy makes lock-mode (real transaction) THROW the identical 503/PLATFORM_FEE_GST_NOT_CONFIGURED error — booking/payment progression is genuinely prevented, not just the quote preview", legacyLockErr?.status === 503 && legacyLockErr?.code === "PLATFORM_FEE_GST_NOT_CONFIGURED", legacyLockErr && { status: legacyLockErr.status, code: legacyLockErr.code });

    check("9c. No Booking document was created by the aborted lock-mode attempt above", (await Booking.countDocuments({})) === 0);

    // ════════════════════════════════════════════════════════════
    // Now publish a COMPLETE policy (all three rates) so the
    // remaining scenarios (2-8, 10) — which test service GST,
    // platform fee, multi-service, no-writes, and quote/lock
    // agreement — can exercise a normal successful pricing result.
    // ════════════════════════════════════════════════════════════
    const gstDraftWithFee = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraftWithFee._id, adminId });

    // ── 2. Published policy WITH a valid platform-fee GST rate. ──
    const priceWithFeeGst = await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id)] });
    check("2a. platformFeeGstConfigured is true once a valid rate is published", priceWithFeeGst.platformFeeGstConfigured === true, priceWithFeeGst);
    check("2b. Platform-fee GST amount = round(2000 * 18 / 100) = 360 paise", priceWithFeeGst.platformFeeGstAmountInPaise === 360, priceWithFeeGst.platformFeeGstAmountInPaise);
    check("2c. Total includes all four components (500 + 20 + 25 + 3.60 = ₹548.60 = 54860 paise)", priceWithFeeGst.totalAmountInPaise === 50000 + 2000 + 2500 + 360, priceWithFeeGst.totalAmountInPaise);
    check("2d. Service GST is unaffected by the new platform-fee GST rate (still ₹25)", priceWithFeeGst.gstAmountInPaise === 2500);

    // ── 3/4. Registered/unregistered service GST, now alongside a
    //         configured fee-GST rate (required for any success). ──
    check("3. Registered salon service GST computed at the configured rate (5% of ₹500 = ₹25)", priceWithFeeGst.gstAmountInPaise === 2500);
    const priceUnreg = await calculateBookingPricing({ salonId: salonUnregistered._id, serviceRefs: [String(svc500u._id)] });
    check("4. Unregistered salon service GST is 0% (stored as 0, not null) — service GST fail-open behavior is UNCHANGED by the Priority 1 fix", priceUnreg.gstRatePercent === 0 && priceUnreg.gstAmountInPaise === 0, priceUnreg);
    check("4b. Unregistered salon booking still succeeds (fee-GST fix did not make service-GST fail-open regress to fail-closed)", priceUnreg.platformFeeGstConfigured === true && priceUnreg.platformFeeGstAmountInPaise === 360, priceUnreg);

    // ── 5. Global platform fee resolved through the existing service. ──
    check("5. Global platform fee resolved via resolveGlobalPlatformFee (FIXED ₹20)", priceWithFeeGst.commissionAmountInPaise === 2000 && priceUnreg.commissionAmountInPaise === 2000);

    // ════════════════════════════════════════════════════════════
    // 6. Multiple selected services; invalid service/salon inputs.
    // ════════════════════════════════════════════════════════════
    const svcB = await makeService(salonRegistered._id, 199);
    const priceMulti = await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id), String(svcB._id)] });
    check("6a. Multiple services summed into one serviceAmountInPaise (500+199=699 → 69900 paise)", priceMulti.serviceAmountInPaise === 69900, priceMulti.serviceAmountInPaise);
    check("6b. Fee/GST computed ONCE on the combined total, not per-service", priceMulti.commissionAmountInPaise === 2000 && priceMulti.gstAmountInPaise === Math.round(69900 * 5 / 100));

    let invalidServiceErr = null;
    try { await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(oid())] }); }
    catch (e) { invalidServiceErr = e; }
    check("6c. An invalid/nonexistent serviceRef throws a 400 error (never silently prices ₹0)", invalidServiceErr?.status === 400, invalidServiceErr && { status: invalidServiceErr.status, message: invalidServiceErr.message });

    let invalidSalonErr = null;
    try { await calculateBookingPricing({ salonId: String(oid()), serviceRefs: [String(svc500._id)] }); }
    catch (e) { invalidSalonErr = e; }
    check("6d. An invalid/nonexistent salonId throws a 404 error", invalidSalonErr?.status === 404, invalidSalonErr && { status: invalidSalonErr.status, message: invalidSalonErr.message });

    // ════════════════════════════════════════════════════════════
    // 7. Quote (no-session call, exactly how the route invokes it)
    //    performs NO writes / booking / slot side effects.
    // ════════════════════════════════════════════════════════════
    const before = {
      Booking: await Booking.countDocuments({}),
      Service: await Service.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      GstPolicyVersion: await GstPolicyVersion.countDocuments({}),
      AreaPlatformFeePolicy: await AreaPlatformFeePolicy.countDocuments({}),
    };
    await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id), String(svcB._id)] });
    const after = {
      Booking: await Booking.countDocuments({}),
      Service: await Service.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      GstPolicyVersion: await GstPolicyVersion.countDocuments({}),
      AreaPlatformFeePolicy: await AreaPlatformFeePolicy.countDocuments({}),
    };
    check("7. Quote-mode call performs zero writes to any collection", JSON.stringify(before) === JSON.stringify(after), { before, after });

    // ════════════════════════════════════════════════════════════
    // 8. Quote (no session) and booking-lock (real transaction/
    //    session, mirroring lockSlot's own call) agree exactly for
    //    identical inputs.
    // ════════════════════════════════════════════════════════════
    const quoteResult = await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id), String(svcB._id)] });

    // A single-node mongodb-memory-server replica set can surface a
    // transient LockTimeout/TransientTransactionError under a real
    // transaction even with no genuine contention — the same class of
    // error lockSlot's own real code already retries/handles
    // (publishGstPolicy's MAX_PUBLISH_ATTEMPTS, lockSlot's own
    // TransientTransactionError catch branch). Mirroring that existing
    // retry discipline here rather than treating it as a test design
    // flaw.
    let lockResult;
    for (let attempt = 0; attempt < 5; attempt++) {
      const lockSession = await mongoose.startSession();
      try {
        lockSession.startTransaction();
        lockResult = await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id), String(svcB._id)], session: lockSession });
        await lockSession.commitTransaction();
        break;
      } catch (e) {
        if (lockSession.inTransaction()) await lockSession.abortTransaction();
        if (attempt === 4) throw e;
      } finally {
        lockSession.endSession();
      }
    }

    check("8. Quote (no session) and lock-mode (real transaction) produce byte-identical pricing for identical inputs", JSON.stringify(quoteResult) === JSON.stringify(lockResult), { quoteResult, lockResult });

    // ════════════════════════════════════════════════════════════
    // 9d. Re-confirm the fail-closed guard survives a subsequent
    //     retire — re-publishing a fresh legacy-shaped (no fee rate)
    //     policy after other state changes still throws, not just on
    //     the very first attempt above.
    // ════════════════════════════════════════════════════════════
    const gstDraftNoFeeAgain = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0 });
    await publishGstPolicy({ versionId: gstDraftNoFeeAgain._id, adminId });
    let secondRoundErr = null;
    try { await calculateBookingPricing({ salonId: salonRegistered._id, serviceRefs: [String(svc500._id)] }); }
    catch (e) { secondRoundErr = e; }
    check("9d. Fail-closed guard still throws after republishing a legacy-shaped policy later in the test run (not a one-shot fluke)", secondRoundErr?.status === 503 && secondRoundErr?.code === "PLATFORM_FEE_GST_NOT_CONFIGURED");

    // Restore a complete policy so later checks reflect the intended
    // steady state, not the deliberately-broken one just tested.
    const gstDraftFinal = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraftFinal._id, adminId });

    // ════════════════════════════════════════════════════════════
    // 11. REAL PRODUCTION DATA SHAPE — a salon with basicInfo.gstStatus
    //     genuinely ABSENT from the stored document (not merely set to
    //     "UNREGISTERED"). Confirmed via a real-database read-only scan
    //     (2026-10-12): 22 of 23 real salons have this exact shape —
    //     the field was never written at all, not defaulted. A plain
    //     Salon.create({...}) would NOT reproduce this: Mongoose
    //     applies the schema's own `default: "UNREGISTERED"` at
    //     document-construction time and would write that value to
    //     storage. Using the raw driver (.collection.insertOne) bypasses
    //     Mongoose entirely, matching the real stored shape exactly —
    //     same technique already used elsewhere in this file (§3) for
    //     a raw, schema-bypassing fixture.
    // ════════════════════════════════════════════════════════════
    const salonNoGstField = await Salon.collection.insertOne({
      ownerId: oid(),
      basicInfo: { shopName: "No GST Field Salon", category: "UNISEX" }, // gstStatus key omitted entirely
      timings: ALL_DAYS_CLOSED,
    }).then((r) => ({ _id: r.insertedId }));
    const svcNoGstField = await makeService(salonNoGstField._id, 500);
    const priceNoGstField = await calculateBookingPricing({ salonId: salonNoGstField._id, serviceRefs: [String(svcNoGstField._id)] });
    check("11a. A salon with basicInfo.gstStatus entirely ABSENT (the real shape of 22 of 23 production salons) resolves as unregistered (0%), matching the schema's documented default intent", priceNoGstField.gstRatePercent === 0 && priceNoGstField.gstAmountInPaise === 0, priceNoGstField);
    check("11b. Platform-fee GST is unaffected by the salon's own GST-status shape — still resolves normally (18%)", priceNoGstField.platformFeeGstConfigured === true && priceNoGstField.platformFeeGstRatePercent === 18);

    // ════════════════════════════════════════════════════════════
    // 12. INDEPENDENT ROUNDING — service GST and platform-fee GST each
    //     round on their OWN inputs, not derived from one combined
    //     rounding. The schema/admin-UI both explicitly allow
    //     fractional rates (step="0.01" in GstSettingsPage.jsx; no
    //     Number.isInteger validator on registeredRatePercent/
    //     platformFeeGstRatePercent) — today's real business values
    //     (5/0/18) happen to be whole numbers and round exactly, so
    //     this case was never exercised by any existing test. Chosen
    //     values deliberately force a genuine .5-boundary decision on
    //     BOTH components independently, with the expected result
    //     hand-computed and hardcoded below (not re-derived via
    //     Math.round in this test, which would just test Math.round
    //     against itself).
    //       Service: ₹333 (33300 paise) × 2.5% = 832.5 paise → rounds to 833.
    //       Platform fee: a dedicated FIXED ₹3.33 (333 paise) policy ×
    //       18.5% = 61.605 paise → rounds to 62.
    // ════════════════════════════════════════════════════════════
    const roundingFeeDraft = await createDraftAreaPlatformFee({ adminId, scope: "GLOBAL", calculationType: "FIXED", feeInPaise: 333 });
    await publishAreaPlatformFee({ policyId: roundingFeeDraft._id, adminId });
    const roundingGstDraft = await createDraftGstPolicy({ adminId, registeredRatePercent: 2.5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18.5 });
    await publishGstPolicy({ versionId: roundingGstDraft._id, adminId });

    const salonRounding = await makeSalon("REGISTERED");
    const svcRounding = await makeService(salonRounding._id, 333);
    const priceRounding = await calculateBookingPricing({ salonId: salonRounding._id, serviceRefs: [String(svcRounding._id)] });
    check("12a. Service GST rounds independently: round(33300 × 2.5 / 100) = round(832.5) = 833", priceRounding.gstAmountInPaise === 833, priceRounding.gstAmountInPaise);
    check("12b. Platform-fee GST rounds independently, on its OWN base (the fee, 333 paise), not the service amount: round(333 × 18.5 / 100) = round(61.605) = 62", priceRounding.platformFeeGstAmountInPaise === 62, priceRounding.platformFeeGstAmountInPaise);
    check("12c. Total correctly sums the two independently-rounded components (no double-rounding drift): 33300 + 333 + 833 + 62 = 34528", priceRounding.totalAmountInPaise === 34528, priceRounding.totalAmountInPaise);

    // Restore the business-real, whole-number policy + the original
    // SLAB fee schedule for the structural check below, so the test
    // ends in the same steady state it started validating against.
    const gstDraftRestored = await createDraftGstPolicy({ adminId, registeredRatePercent: 5, unregisteredRatePercent: 0, platformFeeGstRatePercent: 18 });
    await publishGstPolicy({ versionId: gstDraftRestored._id, adminId });

    // ════════════════════════════════════════════════════════════
    // 10. Route/auth convention compatibility — structural check
    //     against the REAL, imported router (see SCOPE NOTE above).
    // ════════════════════════════════════════════════════════════
    const bookingRouter = (await import("../../routes/booking.routes.js")).default;
    // Find the mounted sub-router layer specifically (name === "router",
    // i.e. an express.Router(), not the top-level `protect` middleware —
    // whose own catch-all regexp also matches every path, including
    // this one, since it's a zero-width lookahead with no real prefix).
    const userMount = bookingRouter.stack.find((l) => l.name === "router" && l.regexp && l.regexp.test("/v1/bookings/user/quote"));
    check("10a. booking.routes.js still mounts a router matching /v1/bookings/user/*", !!userMount);
    const userRouterStack = userMount?.handle?.stack || [];
    const quoteLayer = userRouterStack.find((l) => l.route && l.route.path === "/quote" && l.route.methods.get);
    check("10b. GET /quote is registered on the SAME userRouter as /slots, /lock, etc. (same auth gate, no parallel router)", !!quoteLayer, userRouterStack.map((l) => l.route?.path).filter(Boolean));
    const slotsLayer = userRouterStack.find((l) => l.route && l.route.path === "/slots");
    const lockLayer = userRouterStack.find((l) => l.route && l.route.path === "/lock");
    check("10c. Pre-existing /slots route is still present and unmodified in position", !!slotsLayer);
    check("10d. Pre-existing /lock route is still present and unmodified in position", !!lockLayer);

  } finally {
    await mongoose.disconnect();
    await mem.stop();
  }

  console.log(rows.join("\n"));
  console.log(`\nBOOKING PRICING + QUOTE FOUNDATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err);
  process.exit(1);
});
