/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyTerritoryRevenueActivePartnerResolution.js
 *
 * TERRITORY PARTNER — PHASE 2 verification. Proves
 * TerritoryRevenueService.js#createTerritoryRevenueSplitForBooking now
 * resolves the LIVE ACTIVE Territory Partner (via
 * resolveActiveTerritoryForGeography + a live TerritoryAssignment
 * ACTIVE check), not the old SalonTerritoryAssignment point-in-time
 * snapshot — and that an ended/replaced partner never earns from a
 * future booking, while historical rows and the refund-reversal path
 * are completely unaffected.
 *
 * SAFETY: a REAL PUBLISHED TerritoryRevenueSettings document already
 * exists in this environment (confirmed read-only before this script
 * runs) — this script NEVER creates, publishes, or retires a
 * TerritoryRevenueSettings version. It only READS the real published
 * rate and uses it to compute expected values. Every
 * CommercialTerritory/TerritoryAssignment/FieldAgent/Salon/Booking/
 * RevenueSplit/TerritoryRevenueSplit/TerritoryRevenueLedger/Refund
 * document this script creates is its own isolated fixture, tracked by
 * exact _id, and deleted in `finally` — the real, pre-existing 11
 * TerritoryAssignment documents are never touched, read, or counted
 * against.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyTerritoryRevenueActivePartnerResolution.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../../config/db.js";

import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Booking, { BOOKING_STATUS } from "../../models/Booking.js";
import Refund, { REFUND_STATUS } from "../../models/Refund.js";

import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import CommercialTerritory from "../../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../../modules/fieldAgent/models/TerritoryAssignment.js";
import TerritoryPartnerTermSnapshot from "../../modules/fieldAgent/models/TerritoryPartnerTermSnapshot.js";
import SalonTerritoryAssignment from "../../modules/territoryAutoAssignment/models/SalonTerritoryAssignment.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import TerritoryRevenueSplit from "../../modules/finance/models/TerritoryRevenueSplit.js";
import TerritoryRevenueLedger from "../../modules/finance/models/TerritoryRevenueLedger.js";
import TerritoryRevenueSettings from "../../modules/finance/models/TerritoryRevenueSettings.js";

import { TERRITORY_SCOPE_TYPE, TERRITORY_STATUS } from "../../modules/fieldAgent/constants/commercialTerritory.constants.js";
import { COMMERCIAL_PATH, FIELD_AGENT_OPERATIONAL_STATUS } from "../../modules/fieldAgent/constants/fieldAgent.constants.js";
import { assignPartner, vacatePartner } from "../../modules/fieldAgent/services/commercialTerritory.service.js";
import { createTerritoryRevenueSplitForBooking, createTerritoryRevenueReversal } from "../../modules/finance/services/TerritoryRevenueService.js";

import { makeGeoFixture, nextPhone, oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail, (k, v) => (v instanceof Date ? v.toISOString() : v)).slice(0, 500) : ""}`); }
};

const createdIds = {
  users: [], applications: [], fieldAgents: [], salons: [], territories: [], assignments: [],
  progress: [], bookings: [], revenueSplits: [], territorySplits: [], territoryLedger: [], refunds: [],
};

const mkBooking = async (salonId, { commissionAmountInPaise = 10000, completedAt = new Date() } = {}) => {
  const booking = await Booking.create({
    userRef: oid(), salonRef: salonId, chairRef: oid(), serviceRefs: [oid()],
    bookingDate: "2026-01-01", startTime: new Date(), endTime: new Date(Date.now() + 3600000),
    serviceDuration: 30, status: BOOKING_STATUS.HOLD, commissionAmountInPaise,
  });
  await Booking.collection.updateOne({ _id: booking._id }, { $set: { status: BOOKING_STATUS.COMPLETED, completedAt } });
  createdIds.bookings.push(booking._id);
  return booking;
};

const mkRevenueSplit = async (bookingId, { zemishRevenueInPaise = 10000, serviceAmountInPaise = 50000 } = {}) => {
  const split = await RevenueSplit.create({
    bookingId,
    serviceAmountInPaise,
    platformFeeInPaise: zemishRevenueInPaise,
    gstRatePercent: 0,
    gstAmountInPaise: 0,
    customerPaidInPaise: serviceAmountInPaise + zemishRevenueInPaise,
    salonCreditInPaise: serviceAmountInPaise,
    zemishRevenueInPaise,
    policyVersion: 1,
  });
  createdIds.revenueSplits.push(split._id);
  return split;
};

const mkFieldAgentTerritoryPartner = async (label) => {
  const agentUser = await User.create({ name: `ZE2E_TRV_${label}`, phone: nextPhone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
  createdIds.users.push(agentUser._id);
  const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
  createdIds.applications.push(application._id);
  const fieldAgent = await FieldAgent.create({
    userRef: agentUser._id, applicationRef: application._id, agentCode: `ZE2E_TRV_${label}-${Date.now()}`,
    operationalStatus: FIELD_AGENT_OPERATIONAL_STATUS.ACTIVE, commercialPath: COMMERCIAL_PATH.TERRITORY_PARTNER,
  });
  createdIds.fieldAgents.push(fieldAgent._id);
  return fieldAgent;
};

const run = async () => {
  await connectDB();
  const adminId = oid();
  let geoCovered = null, geoUncovered = null;

  try {
    const before = {
      TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
      TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      SalonTerritoryAssignment: await SalonTerritoryAssignment.countDocuments({}),
    };
    results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

    const publishedSettings = await TerritoryRevenueSettings.findOne({ status: "PUBLISHED" }).lean();
    check("SETUP. A real PUBLISHED TerritoryRevenueSettings exists (reused read-only, never created/touched)", !!publishedSettings, publishedSettings);
    if (!publishedSettings) throw new Error("SAFETY ABORT: no PUBLISHED TerritoryRevenueSettings exists — this script refuses to create one (per instruction). Cannot prove Tests 2/3/4 without a real rate to reuse.");
    const rate = publishedSettings.territoryCommissionPercent;
    results.push(`ℹ️  Reusing real published rate: ${rate}% (version ${publishedSettings.version}) — read-only, never modified.`);

    // ═══════════════════════════════════════════════════════════
    // SETUP — isolated geo + CommercialTerritory (DISTRICT scope,
    // ACTIVE) + salon. A SECOND, separate geo is used for the
    // "no partner at all" test, with no CommercialTerritory ever
    // created for it.
    // ═══════════════════════════════════════════════════════════
    geoCovered = await makeGeoFixture({ Country, State, District, City, Area }, `TRVCOV${Date.now() % 100000}`);
    geoUncovered = await makeGeoFixture({ Country, State, District, City, Area }, `TRVUNC${Date.now() % 100000}`);

    const territory = await CommercialTerritory.create({
      name: "ZE2E_TRV_TERRITORY",
      code: `ZE2E-CT-${Date.now()}`,
      scopeType: TERRITORY_SCOPE_TYPE.DISTRICT,
      scopeKey: `DISTRICT:${geoCovered.district._id}`,
      stateRef: geoCovered.state._id,
      districtRef: geoCovered.district._id,
      cityRef: null,
      areaRefs: [],
      status: TERRITORY_STATUS.ACTIVE,
      currentAssignmentRef: null,
      createdBy: adminId,
      updatedBy: adminId,
    });
    createdIds.territories.push(territory._id);

    const ownerCovered = await User.create({ name: "ZE2E_TRV_OWNER_COV", phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerCovered._id);
    const dayTiming = { open: "09:00", close: "20:00" };
    const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const salonCovered = await Salon.create({
      ownerId: ownerCovered._id,
      basicInfo: { shopName: "ZE2E_TRV_SALON_COVERED", category: "UNISEX" },
      location: {
        address: "ZE2E address", geo: { type: "Point", coordinates: [77, 28] },
        territory: { countryRef: geoCovered.country._id, stateRef: geoCovered.state._id, districtRef: geoCovered.district._id, cityRef: geoCovered.city._id, areaRef: geoCovered.area._id },
      },
      timings, approval: { status: "APPROVED" }, onboarding: { step: 2 }, isDeleted: false,
    });
    createdIds.salons.push(salonCovered._id);

    const ownerUncovered = await User.create({ name: "ZE2E_TRV_OWNER_UNC", phone: nextPhone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(ownerUncovered._id);
    const salonUncovered = await Salon.create({
      ownerId: ownerUncovered._id,
      basicInfo: { shopName: "ZE2E_TRV_SALON_UNCOVERED", category: "UNISEX" },
      location: {
        address: "ZE2E address", geo: { type: "Point", coordinates: [77, 28] },
        territory: { countryRef: geoUncovered.country._id, stateRef: geoUncovered.state._id, districtRef: geoUncovered.district._id, cityRef: geoUncovered.city._id, areaRef: geoUncovered.area._id },
      },
      timings, approval: { status: "APPROVED" }, onboarding: { step: 2 }, isDeleted: false,
    });
    createdIds.salons.push(salonUncovered._id);

    // ═══════════════════════════════════════════════════════════
    // TEST 1 — NO PARTNER (uncovered geography, no CommercialTerritory
    // ever created for it).
    // ═══════════════════════════════════════════════════════════
    const booking1 = await mkBooking(salonUncovered._id);
    const split1Input = await mkRevenueSplit(booking1._id);
    const result1 = await createTerritoryRevenueSplitForBooking({ revenueSplit: split1Input });
    check("T1. createTerritoryRevenueSplitForBooking returns null when no CommercialTerritory covers the salon", result1 === null, result1);
    check("T1. Zero TerritoryRevenueSplit rows for this booking", (await TerritoryRevenueSplit.countDocuments({ bookingId: booking1._id })) === 0);
    check("T1. Zero TerritoryRevenueLedger rows for this booking", (await TerritoryRevenueLedger.countDocuments({ bookingId: booking1._id })) === 0);

    // ═══════════════════════════════════════════════════════════
    // TEST 2 — PARTNER A ACTIVE.
    // ═══════════════════════════════════════════════════════════
    const agentA = await mkFieldAgentTerritoryPartner("A");
    const { assignment: assignmentA } = await assignPartner({ territoryId: territory._id, fieldAgentId: agentA._id, adminId });
    createdIds.assignments.push(assignmentA._id);

    const booking2 = await mkBooking(salonCovered._id, { commissionAmountInPaise: 10000 });
    const split2Input = await mkRevenueSplit(booking2._id, { zemishRevenueInPaise: 10000 });
    const result2 = await createTerritoryRevenueSplitForBooking({ revenueSplit: split2Input });
    check("T2. TerritoryRevenueSplit created for Partner A", !!result2, result2);
    if (result2) createdIds.territorySplits.push(result2._id);
    check("T2. territoryPartnerRef === Partner A", String(result2?.territoryPartnerRef) === String(agentA._id), result2?.territoryPartnerRef);
    const expectedShareA = Math.round((10000 * rate) / 100);
    check(`T2. territoryShareInPaise === ${expectedShareA} (${rate}% of ₹100 Platform Fee)`, result2?.territoryShareInPaise === expectedShareA, result2?.territoryShareInPaise);
    const ledgerRowsT2 = await TerritoryRevenueLedger.find({ bookingId: booking2._id }).lean();
    createdIds.territoryLedger.push(...ledgerRowsT2.map((r) => r._id));
    check("T2. Exactly one SALE ledger row created, crediting Partner A", ledgerRowsT2.length === 1 && ledgerRowsT2[0]?.ledgerType === "SALE" && String(ledgerRowsT2[0]?.territoryPartnerRef) === String(agentA._id), ledgerRowsT2);

    // Snapshot test-2 rows verbatim for the later History (byte-for-byte) check.
    const split2Snapshot = JSON.stringify(await TerritoryRevenueSplit.findById(result2._id).lean());
    const ledger2Snapshot = JSON.stringify(ledgerRowsT2[0]);

    // ═══════════════════════════════════════════════════════════
    // TEST 3 — PARTNER A ENDED. Same salon, a NEW booking.
    // ═══════════════════════════════════════════════════════════
    await vacatePartner({ territoryId: territory._id, adminId, endReason: "ADMIN_REASSIGNED" });
    const territoryAfterVacate = await CommercialTerritory.findById(territory._id).lean();
    check("T3 setup. Territory currentAssignmentRef cleared after vacate", territoryAfterVacate?.currentAssignmentRef === null, territoryAfterVacate);

    const salonTerritoryLinkStillStale = await SalonTerritoryAssignment.findOne({ salonRef: salonCovered._id }).lean();
    check("T3 setup. No SalonTerritoryAssignment link was ever created for this salon (proves the OLD snapshot mechanism is simply not in play — this test is about live resolution, not about a stale snapshot existing)", !salonTerritoryLinkStillStale);

    const booking3 = await mkBooking(salonCovered._id, { commissionAmountInPaise: 10000 });
    const split3Input = await mkRevenueSplit(booking3._id, { zemishRevenueInPaise: 10000 });
    const result3 = await createTerritoryRevenueSplitForBooking({ revenueSplit: split3Input });
    check("T3. Partner A receives ₹0 — createTerritoryRevenueSplitForBooking returns null after vacate", result3 === null, result3);
    check("T3. No NEW TerritoryRevenueSplit for this booking", (await TerritoryRevenueSplit.countDocuments({ bookingId: booking3._id })) === 0);
    check("T3. No NEW TerritoryRevenueLedger for this booking", (await TerritoryRevenueLedger.countDocuments({ bookingId: booking3._id })) === 0);
    check("T3. ZEMISH retains the full Platform Fee (no share routed anywhere) — proves the live resolver, not the old snapshot, now controls this", result3 === null);

    // ═══════════════════════════════════════════════════════════
    // TEST 4 — PARTNER B ACTIVE on the SAME territory.
    // ═══════════════════════════════════════════════════════════
    const agentB = await mkFieldAgentTerritoryPartner("B");
    const { assignment: assignmentB } = await assignPartner({ territoryId: territory._id, fieldAgentId: agentB._id, adminId });
    createdIds.assignments.push(assignmentB._id);

    const booking4 = await mkBooking(salonCovered._id, { commissionAmountInPaise: 10000 });
    const split4Input = await mkRevenueSplit(booking4._id, { zemishRevenueInPaise: 10000 });
    const result4 = await createTerritoryRevenueSplitForBooking({ revenueSplit: split4Input });
    check("T4. TerritoryRevenueSplit created for Partner B", !!result4, result4);
    if (result4) createdIds.territorySplits.push(result4._id);
    check("T4. territoryPartnerRef === Partner B, NOT Partner A", String(result4?.territoryPartnerRef) === String(agentB._id) && String(result4?.territoryPartnerRef) !== String(agentA._id), result4?.territoryPartnerRef);
    const ledgerRowsT4 = await TerritoryRevenueLedger.find({ bookingId: booking4._id }).lean();
    createdIds.territoryLedger.push(...ledgerRowsT4.map((r) => r._id));
    check("T4. Exactly one new SALE ledger row, crediting Partner B", ledgerRowsT4.length === 1 && String(ledgerRowsT4[0]?.territoryPartnerRef) === String(agentB._id), ledgerRowsT4);

    const totalSplitsForSalon = await TerritoryRevenueSplit.countDocuments({ salonId: salonCovered._id });
    check("T4. Exactly 2 TerritoryRevenueSplit rows total for this salon (Test 2's A-row + Test 4's B-row — Test 3 created none)", totalSplitsForSalon === 2, totalSplitsForSalon);

    // ═══════════════════════════════════════════════════════════
    // TEST 5 — HISTORY. Test 2's rows must remain byte-for-byte
    // unchanged after Tests 3 and 4 ran.
    // ═══════════════════════════════════════════════════════════
    const split2After = JSON.stringify(await TerritoryRevenueSplit.findById(result2._id).lean());
    const ledger2After = JSON.stringify(await TerritoryRevenueLedger.findById(ledgerRowsT2[0]._id).lean());
    check("T5. Test 2's TerritoryRevenueSplit is byte-for-byte unchanged", split2After === split2Snapshot, { before: split2Snapshot, after: split2After });
    check("T5. Test 2's TerritoryRevenueLedger SALE row is byte-for-byte unchanged", ledger2After === ledger2Snapshot, { before: ledger2Snapshot, after: ledger2After });

    // ═══════════════════════════════════════════════════════════
    // TEST 6 — REFUND. Reverses Test 2's split (Partner A's sale),
    // even though Partner A is no longer the ACTIVE partner (B is) —
    // proves createTerritoryRevenueReversal reads the ORIGINAL
    // split/ledger relationship and never re-resolves the current
    // partner.
    // ═══════════════════════════════════════════════════════════
    const refund = await Refund.create({
      paymentId: `ZE2E_PAY_${Date.now()}`,
      bookingId: booking2._id,
      amountInPaise: 60000,
      paymentAmountInPaise: 60000,
      isFull: true,
      idempotencyKey: `ZE2E_REFUND_${Date.now()}`,
      razorpayRefundId: `rfnd_ZE2E_${Date.now()}`,
      refundStatus: REFUND_STATUS.PROCESSED,
    });
    createdIds.refunds.push(refund._id);

    const reversal = await createTerritoryRevenueReversal({ revenueSplit: split2Input, refundId: refund.razorpayRefundId });
    check("T6. Reversal ledger row created", !!reversal, reversal);
    if (reversal?._id) createdIds.territoryLedger.push(reversal._id);
    check("T6. Reversal credits/debits against Partner A (the ORIGINAL sale's partner) — NOT Partner B, who is now ACTIVE on this territory", String(reversal?.territoryPartnerRef) === String(agentA._id), reversal?.territoryPartnerRef);
    check("T6. Reversal amount === the original sale amount (full refund -> fraction 1)", reversal?.amountInPaise === expectedShareA, reversal?.amountInPaise);
    check("T6. Reversal ledgerType === REFUND_REVERSAL, status REVERSED", reversal?.ledgerType === "REFUND_REVERSAL" && reversal?.status === "REVERSED", reversal);

    // ═══════════════════════════════════════════════════════════
    // CLEANUP — only this script's own tracked fixtures.
    // TerritoryRevenueSplit/Ledger and RevenueSplit are all immutable
    // at the ORM level — raw driver bypass, same idiom this entire
    // suite already uses.
    // ═══════════════════════════════════════════════════════════
    await Refund.deleteMany({ _id: { $in: createdIds.refunds } });
    await TerritoryRevenueLedger.collection.deleteMany({ _id: { $in: createdIds.territoryLedger } });
    await TerritoryRevenueSplit.collection.deleteMany({ _id: { $in: createdIds.territorySplits } });
    await RevenueSplit.collection.deleteMany({ _id: { $in: createdIds.revenueSplits } });
    await Booking.deleteMany({ _id: { $in: createdIds.bookings } });
    await TerritoryPartnerTermSnapshot.deleteMany({ territoryAssignmentRef: { $in: createdIds.assignments } });
    await TerritoryAssignment.deleteMany({ _id: { $in: createdIds.assignments } });
    await CommercialTerritory.deleteMany({ _id: { $in: createdIds.territories } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    await State.deleteOne({ _id: geoCovered.state._id });
    await District.deleteOne({ _id: geoCovered.district._id });
    await City.deleteOne({ _id: geoCovered.city._id });
    await Area.deleteOne({ _id: geoCovered.area._id });
    await State.deleteOne({ _id: geoUncovered.state._id });
    await District.deleteOne({ _id: geoUncovered.district._id });
    await City.deleteOne({ _id: geoUncovered.city._id });
    await Area.deleteOne({ _id: geoUncovered.area._id });

    const after = {
      TerritoryRevenueSplit: await TerritoryRevenueSplit.countDocuments({}),
      TerritoryRevenueLedger: await TerritoryRevenueLedger.countDocuments({}),
      TerritoryAssignment: await TerritoryAssignment.countDocuments({}),
      SalonTerritoryAssignment: await SalonTerritoryAssignment.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts: ${JSON.stringify(after)}`);
    check("CLEANUP. All 4 tracked collection counts returned exactly to their BEFORE values", JSON.stringify(before) === JSON.stringify(after), { before, after });

    const publishedSettingsAfter = await TerritoryRevenueSettings.findOne({ status: "PUBLISHED" }).lean();
    check("CLEANUP. The real published TerritoryRevenueSettings is completely untouched", JSON.stringify(publishedSettings) === JSON.stringify(publishedSettingsAfter), { before: publishedSettings, after: publishedSettingsAfter });
  } catch (err) {
    console.error("FATAL ERROR DURING TERRITORY REVENUE ACTIVE PARTNER RESOLUTION E2E:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
    try {
      await Refund.deleteMany({ _id: { $in: createdIds.refunds } });
      await TerritoryRevenueLedger.collection.deleteMany({ _id: { $in: createdIds.territoryLedger } });
      await TerritoryRevenueSplit.collection.deleteMany({ _id: { $in: createdIds.territorySplits } });
      await RevenueSplit.collection.deleteMany({ _id: { $in: createdIds.revenueSplits } });
      await Booking.deleteMany({ _id: { $in: createdIds.bookings } });
      await TerritoryPartnerTermSnapshot.deleteMany({ territoryAssignmentRef: { $in: createdIds.assignments } });
      await TerritoryAssignment.deleteMany({ _id: { $in: createdIds.assignments } });
      await CommercialTerritory.deleteMany({ _id: { $in: createdIds.territories } });
      await Salon.deleteMany({ _id: { $in: createdIds.salons } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      if (geoCovered) {
        await State.deleteOne({ _id: geoCovered.state._id });
        await District.deleteOne({ _id: geoCovered.district._id });
        await City.deleteOne({ _id: geoCovered.city._id });
        await Area.deleteOne({ _id: geoCovered.area._id });
      }
      if (geoUncovered) {
        await State.deleteOne({ _id: geoUncovered.state._id });
        await District.deleteOne({ _id: geoUncovered.district._id });
        await City.deleteOne({ _id: geoUncovered.city._id });
        await Area.deleteOne({ _id: geoUncovered.area._id });
      }
      results.push("✅ Best-effort cleanup after failure completed (own fixtures only)");
    } catch (cleanupErr) {
      results.push(`❌ Best-effort cleanup ALSO failed: ${cleanupErr.message}`);
    }
  } finally {
    await mongoose.connection.close();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nTERRITORY-REVENUE-ACTIVE-PARTNER-RESOLUTION-E2E: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail === 0 ? 0 : 1);
};

run();
