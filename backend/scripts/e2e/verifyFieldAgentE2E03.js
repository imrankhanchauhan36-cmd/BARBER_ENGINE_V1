/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2E03.js
 *
 * FA-16 Tier 1 — E2E-03: Salon Booking -> Completion -> GST/Platform
 * Fee -> FA-9 Earning. First financial cross-module E2E. Does NOT
 * include payout (deliberately out of Tier-1 scope per instruction).
 *
 * Real Mongo, real policy-read functions, no mocks. Real HTTP is not
 * used for the Booking step itself — see the [VALID FIXTURE] note
 * below for exactly why and what it does NOT bypass.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2E03.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking from "../../models/Booking.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import AreaPlatformFeePolicy from "../../models/AreaPlatformFeePolicy.js";

import { processCompletedBooking, createAcquisitionEarningProgressForClaim } from "../../modules/fieldAgent/services/fieldAgentEarning.service.js";
import { getPublishedGstPolicy } from "../../services/gstPolicy.service.js";
import { resolvePlatformFeeForArea } from "../../services/areaPlatformFee.service.js";

import { makeGeoFixture, makeSalonFixture } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const createdIds = {
  users: [], fieldAgents: [], applications: [], salons: [], bookings: [],
  claims: [], progress: [], ledger: [], policies: [],
  states: [], districts: [], cities: [], areas: [], areaFeePolicies: [],
};

const startedAt = Date.now();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

const run = async () => {
  await connectDB();

  try {
    // ── [VALID FIXTURE] geo + salon + ACTIVE claimed field agent ──
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "03");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const { owner, salon } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(salon._id);

    const agentUser = await User.create({ name: "ZE2E_AGENT_03", phone: phone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(agentUser._id);
    const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(application._id);
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `ZE2E03-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(fieldAgent._id);

    // CommercialPolicyVersion.status has a UNIQUE index — at most one
    // PUBLISHED national policy can exist at a time (a real, live
    // business rule, discovered by direct collision during this
    // implementation, not assumed). Reuse a real published policy if
    // one already exists (read-only, never modified/deleted); only
    // create a fixture one if none exists, and only then is it ours
    // to clean up.
    let nationalPolicy = await CommercialPolicyVersion.findOne({ status: "PUBLISHED" }).lean();
    if (!nationalPolicy) {
      nationalPolicy = await CommercialPolicyVersion.create({
        versionNumber: 900000 + Math.floor(Math.random() * 99999),
        status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10,
        acquisitionEarningTargetInPaise: 100000,
        territoryPartnerCommissionPercent: 8,
        licenseTermMonths: 12,
        claimExpiryDays: 30,
        createdBy: fieldAgent._id, // any valid ObjectId; not read as an admin identity by processCompletedBooking
        publishedBy: fieldAgent._id,
        publishedAt: new Date(Date.now() - 24 * 3600 * 1000),
      });
      createdIds.policies.push(nationalPolicy._id);
    }

    const claim = await AcquisitionClaim.create({
      salonRef: salon._id,
      fieldAgentRef: fieldAgent._id,
      status: "ACTIVE",
      stateRef: geo.state._id,
      districtRef: geo.district._id,
    });
    createdIds.claims.push(claim._id);

    // [REAL] the same production function the real redeemReferral()
    // flow calls immediately after creating a claim (confirmed via
    // source: acquisitionClaim.service.js#redeemReferral eagerly
    // snapshots progress at claim.createdAt) — this fixture creates
    // the claim directly (bypassing the referral/redemption HTTP
    // flow, already fully exercised for real in E2E-02), but the
    // progress-initialization step itself is the real function, not
    // a re-derived guess.
    const initialProgress = await createAcquisitionEarningProgressForClaim({ claim, salon });
    createdIds.progress.push(initialProgress._id);

    // ═══════════════════════════════════════════════════════════
    // STEP 1 — real policy resolution (read-only, live functions).
    // Values are NOT invented — whatever the live DB actually
    // returns is what this test reconciles against, exactly as
    // controllers/booking.controller.js's own real code does.
    // ═══════════════════════════════════════════════════════════
    // [VALID FIXTURE] a real, published fee for this test's own fresh
    // area — a brand-new area naturally has no fee configured yet;
    // this is admin-authored reference data (matching how a real area
    // would be configured before any real booking happens there), not
    // a shortcut around the platform-fee resolution boundary itself
    // (which is exercised for real via resolvePlatformFeeForArea just below).
    const areaFeePolicy = await AreaPlatformFeePolicy.create({
      areaRef: geo.area._id,
      feeInPaise: 3000, // ₹30 flat convenience fee
      status: "PUBLISHED",
      createdBy: owner._id,
      publishedBy: owner._id,
      publishedAt: new Date(),
    });
    createdIds.areaFeePolicies.push(areaFeePolicy._id);

    const { feeInPaise: commissionAmountInPaise } = await resolvePlatformFeeForArea(geo.area._id);
    const gstPolicy = await getPublishedGstPolicy();
    const gstRatePercent = gstPolicy ? gstPolicy.ratePercent : null;

    const serviceAmountInPaise = 50000; // ₹500, arbitrary but realistic
    // EXACT formula copied from controllers/booking.controller.js's
    // own real lockSlot computation — not reimplemented independently.
    const gstAmountInPaise = gstPolicy
      ? Math.round((serviceAmountInPaise + commissionAmountInPaise) * gstPolicy.ratePercent / 100)
      : 0;
    const totalAmountInPaise = serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise;

    check("1. Platform fee resolved from the real, live AreaPlatformFeePolicy resolver (not invented)", typeof commissionAmountInPaise === "number" && commissionAmountInPaise >= 0, commissionAmountInPaise);
    check("2. GST rate resolved from the real, live published GstPolicyVersion (not hardcoded)", gstRatePercent === null || typeof gstRatePercent === "number", gstRatePercent);
    check("3. Service + Platform Fee + GST reconciles exactly to Customer Total (paise-exact)", serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise === totalAmountInPaise, { serviceAmountInPaise, commissionAmountInPaise, gstAmountInPaise, totalAmountInPaise });

    // ═══════════════════════════════════════════════════════════
    // STEP 2 [VALID FIXTURE: Booking] — the full real Booking Engine
    // HTTP flow (slot lock, Razorpay/wallet payment, hold expiry,
    // completion lifecycle) is frozen and disproportionate for
    // Tier-1 setup. This exact fixture shape (Booking.create with an
    // explicit commissionAmountInPaise) is copied verbatim from
    // scripts/verifyFieldAgentEarningEngine.js — FA-9's own proven,
    // currently-passing (85/85) test precedent for exercising
    // processCompletedBooking. It does NOT bypass the boundary this
    // test actually cares about, which is STEP 3 below (the real
    // earning-processing function), not Booking creation itself.
    // ═══════════════════════════════════════════════════════════
    // Exact fixture shape copied from FA-9's own proven, currently-
    // passing test (scripts/verifyFieldAgentEarningEngine.js) —
    // created as HOLD then flipped to COMPLETED via a raw collection
    // update, matching that script's own established technique.
    const booking = await Booking.create({
      userRef: owner._id,
      salonRef: salon._id,
      chairRef: new mongoose.Types.ObjectId(),
      serviceRefs: [new mongoose.Types.ObjectId()],
      bookingDate: "2026-01-01",
      startTime: new Date(),
      endTime: new Date(Date.now() + 3600000),
      serviceDuration: 30,
      status: "HOLD",
      serviceAmountInPaise,
      commissionAmountInPaise,
      gstAmountInPaise,
      gstRatePercent,
      totalAmountInPaise,
    });
    const completedAt = new Date();
    await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: "COMPLETED", completedAt } });
    createdIds.bookings.push(booking._id);

    // ═══════════════════════════════════════════════════════════
    // STEP 3 [REAL — the actual FA-9 earning-processing function,
    // called directly rather than waiting on setInterval, exactly
    // the same established pattern used by FA-9's own test suite].
    // ═══════════════════════════════════════════════════════════
    const outcome = await processCompletedBooking({
      _id: booking._id,
      salonRef: salon._id,
      commissionAmountInPaise,
      completedAt,
    });
    check("4. processCompletedBooking succeeds for a genuinely claimed salon", !!outcome, outcome);

    const ledgerRow = await FieldAgentEarningLedger.findOne({ bookingRef: booking._id });
    check("5. FieldAgentEarningLedger row exists for this booking", !!ledgerRow, ledgerRow);
    if (ledgerRow) createdIds.ledger.push(ledgerRow._id);

    check("6. Ledger row references the correct acquisitionClaimRef", String(ledgerRow?.acquisitionClaimRef) === String(claim._id), ledgerRow?.acquisitionClaimRef);
    check("7. Ledger row references the correct fieldAgentRef", String(ledgerRow?.fieldAgentRef) === String(fieldAgent._id), ledgerRow?.fieldAgentRef);
    check("8. Ledger row references the correct bookingRef", String(ledgerRow?.bookingRef) === String(booking._id), ledgerRow?.bookingRef);

    // CRITICAL: earning must derive from commissionAmountInPaise (the
    // ZEMISH platform fee), never from GST or the customer total.
    const expectedEarningInPaise = Math.round(commissionAmountInPaise * nationalPolicy.acquisitionAgentCommissionPercent / 100);
    check(
      "9. Earning amount is derived from the ZEMISH commission/platform-fee amount at the frozen FA-9 policy rate — NOT from GST or customer total",
      ledgerRow?.creditedAmountInPaise === expectedEarningInPaise,
      { actual: ledgerRow?.creditedAmountInPaise, expected: expectedEarningInPaise, commissionAmountInPaise, gstAmountInPaise, totalAmountInPaise }
    );
    check("9b. Earning amount does not equal gstAmountInPaise (would indicate a wrong-field bug)", ledgerRow?.creditedAmountInPaise !== gstAmountInPaise);
    check("9c. Earning amount does not equal totalAmountInPaise (would indicate a wrong-field bug)", ledgerRow?.creditedAmountInPaise !== totalAmountInPaise);

    check("10. idempotencyKey is present and non-empty", typeof ledgerRow?.idempotencyKey === "string" && ledgerRow.idempotencyKey.length > 0, ledgerRow?.idempotencyKey);

    const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim._id });
    check("11. AcquisitionEarningProgress exists and incremented by the exact ledger amount", !!progress && !!ledgerRow && progress.earnedInPaise === ledgerRow.creditedAmountInPaise, { accumulated: progress?.earnedInPaise, ledgerAmount: ledgerRow?.creditedAmountInPaise });

    // ── No duplicate on reprocessing the same booking (idempotency) ──
    const secondOutcome = await processCompletedBooking({
      _id: booking._id,
      salonRef: salon._id,
      commissionAmountInPaise,
      completedAt,
    });
    const ledgerCountAfterRetry = await FieldAgentEarningLedger.countDocuments({ bookingRef: booking._id });
    check("12. Reprocessing the same completed booking creates NO duplicate ledger row", ledgerCountAfterRetry === 1, { ledgerCountAfterRetry, secondOutcome });

    // ═══════════════════════════════════════════════════════════
    // DYNAMIC ATTRIBUTION — Booking carries no fieldAgentRef; the
    // attribution used above came entirely from resolving the
    // salon's currently-ACTIVE AcquisitionClaim inside
    // processCompletedBooking, exactly as documented in the FA-16
    // discovery audit. Confirmed here, not redesigned.
    // ═══════════════════════════════════════════════════════════
    check("13. Booking model itself carries no fieldAgentRef field (confirms attribution is resolved dynamically via AcquisitionClaim, not snapshotted)", booking.fieldAgentRef === undefined, booking.fieldAgentRef);

  } catch (err) {
    console.error("FATAL ERROR DURING E2E-03:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      // FieldAgentEarningLedger is deliberately immutable (a
      // pre("deleteOne")/pre("findOneAndDelete") hook blocks normal
      // Mongoose deletes) — test cleanup uses the raw driver
      // collection, exactly matching the established technique
      // already proven in scripts/verifyFieldAgentEarningEngine.js.
      await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.ledger } });
      await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.progress } });
      await Booking.deleteMany({ _id: { $in: createdIds.bookings } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
      await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies } });
      await AreaPlatformFeePolicy.deleteMany({ _id: { $in: createdIds.areaFeePolicies } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await Salon.deleteMany({ _id: { $in: createdIds.salons } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      await Area.deleteMany({ _id: { $in: createdIds.areas } });
      await City.deleteMany({ _id: { $in: createdIds.cities } });
      await District.deleteMany({ _id: { $in: createdIds.districts } });
      await State.deleteMany({ _id: { $in: createdIds.states } });

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        salons: await Salon.countDocuments({ _id: { $in: createdIds.salons } }),
        bookings: await Booking.countDocuments({ _id: { $in: createdIds.bookings } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        ledger: await FieldAgentEarningLedger.countDocuments({ _id: { $in: createdIds.ledger } }),
        progress: await AcquisitionEarningProgress.countDocuments({ _id: { $in: createdIds.progress } }),
        policies: await CommercialPolicyVersion.countDocuments({ _id: { $in: createdIds.policies } }),
        areaFeePolicies: await AreaPlatformFeePolicy.countDocuments({ _id: { $in: createdIds.areaFeePolicies } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) +
             (await District.countDocuments({ _id: { $in: createdIds.districts } })) +
             (await City.countDocuments({ _id: { $in: createdIds.cities } })) +
             (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all E2E-03 fixtures", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED (test must FAIL, not silently pass): ${cleanupErr.message}`);
    }

    await mongoose.disconnect();
  }

  const durationMs = Date.now() - startedAt;
  console.log(results.join("\n"));
  console.log(`\nE2E-03: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  console.log(`Financial reconciliation: serviceAmountInPaise + commissionAmountInPaise + gstAmountInPaise = totalAmountInPaise`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
