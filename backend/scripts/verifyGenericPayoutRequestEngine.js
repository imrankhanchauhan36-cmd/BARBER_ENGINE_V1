/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyGenericPayoutRequestEngine.js
 *
 * STEP 6.3 — Generic PayoutRequest Engine — disposable live
 * verification. No HTTP surface exists for this module yet — every
 * call here is a direct, real-Mongo service call, same precedent as
 * scripts/verifyUnifiedWalletEngine.js.
 *
 * Proves:
 *   1. SALON: KYC-verified (verification.bank.verified=true) →
 *      withdrawal request succeeds, AVAILABLE→LOCKED atomically,
 *      bankSnapshot correct and immutable.
 *   2. ACQUISITION_AGENT: KYC-verified via the OTHER existing signal
 *      (bank.pennyDropStatus="SUCCESS") → also succeeds — proves the
 *      universal resolver accepts either verification signal.
 *   3. TERRITORY_PARTNER: same as above, independently.
 *   4. Unverified KYC → request rejected, NOTHING created, wallet
 *      balance completely unchanged (no partial hold).
 *   5. Insufficient balance → request rejected, atomically — no
 *      GenericPayoutRequest row left behind (all-or-nothing).
 *   6. "One open payout request per entity" — a second request while
 *      one is open is rejected, both at the service-logic level and by
 *      the DB partial unique index directly.
 *   7. Idempotent: the same idempotencyKey replayed returns the SAME
 *      request, never a duplicate, never a second hold.
 *   8. bankSnapshot is immutable at the schema level.
 *   9. Refund compatibility preserved: with an OPEN GenericPayoutRequest
 *      (LOCKED balance) in place, WalletBalanceService.debitPending
 *      still correctly reverses a SEPARATE PENDING amount for the same
 *      entity — the two buckets never interfere.
 *  10. ISOLATION: models/PayoutRequest.js (SALON's existing, frozen
 *      model) and FieldAgentPayoutRequest are completely untouched by
 *      this entire run.
 *
 * Run:  cd backend && node scripts/verifyGenericPayoutRequestEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import PayoutRequest from "../models/PayoutRequest.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import KYC from "../modules/kyc/models/KYC.js";
import GenericPayoutRequest from "../modules/payout/models/GenericPayoutRequest.js";
import { requestGenericPayout } from "../modules/payout/services/GenericPayoutRequestService.js";
import { PAYOUT_ENTITY_TYPE } from "../modules/payout/constants/genericPayoutRequest.constants.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import { WALLET_ENTITY_TYPE } from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_GPR63_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `9${String(9990000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureSalonIds = [];
const fixtureFieldAgentIds = [];
const fixtureKycIds = [];
const fixtureWalletEntities = []; // { entityType, entityId }

const dayTiming = { open: "09:00", close: "20:00" };
const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };

const purgeFixtures = async () => {
  await GenericPayoutRequest.collection.deleteMany({ entityId: { $in: fixtureWalletEntities.map((e) => e.entityId) } });
  for (const { entityType, entityId } of fixtureWalletEntities) {
    await WalletLedger.collection.deleteMany({ ownerType: entityType, ownerId: entityId });
  }
  const SalonEarnings = (await import("../models/SalonEarnings.js")).default;
  for (const { entityType, entityId } of fixtureWalletEntities) {
    await SalonEarnings.deleteMany({ entityType, entityId });
  }
  await KYC.deleteMany({ _id: { $in: fixtureKycIds } });
  await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
  await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const withSession = async (fn) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await fn(session);
    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const run = async () => {
  await connectDB();

  try {
    const payoutRequestCountBefore = await PayoutRequest.countDocuments({});
    const fieldAgentPayoutCountBefore = await FieldAgentPayoutRequest.countDocuments({});

    // ── SETUP: a SALON, verified via verification.bank.verified ────
    const owner = await User.create({ name: `${P}OWNER`, phone: nextPhone(), role: "OWNER", isActive: true });
    fixtureUserIds.push(owner._id);
    const salon = await Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      location: { address: `${P} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: {} },
      timings: salonTimings,
      approval: { status: "APPROVED" },
      onboarding: { step: 8 },
      isDeleted: false,
    });
    fixtureSalonIds.push(salon._id);
    const salonKyc = await KYC.create({
      ownerId: owner._id,
      applicantType: "OWNER",
      status: "VERIFIED",
      bank: { accountHolder: `${P}OWNER`, maskedAccount: "XXXX1111", ifsc: "HDFC0000001", bankName: "HDFC Bank", pennyDropStatus: "NOT_INITIATED" },
      verification: { bank: { status: "VERIFIED", verified: true, verifiedAt: new Date() } },
    });
    fixtureKycIds.push(salonKyc._id);
    fixtureWalletEntities.push({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id });

    // ── SETUP: an ACQUISITION_AGENT, verified via bank.pennyDropStatus ──
    const acqUser = await User.create({ name: `${P}ACQUSER`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(acqUser._id);
    const acqAgent = await FieldAgent.create({ userRef: acqUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    fixtureFieldAgentIds.push(acqAgent._id);
    const acqKyc = await KYC.create({
      ownerId: acqUser._id,
      applicantType: "FIELD_AGENT",
      status: "VERIFIED",
      bank: { accountHolder: `${P}ACQUSER`, maskedAccount: "XXXX2222", ifsc: "ICIC0000002", bankName: "ICICI Bank", pennyDropStatus: "SUCCESS" },
      verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
    });
    fixtureKycIds.push(acqKyc._id);
    fixtureWalletEntities.push({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgent._id });

    // ── SETUP: a TERRITORY_PARTNER, verified via bank.pennyDropStatus ──
    const tpUser = await User.create({ name: `${P}TPUSER`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(tpUser._id);
    const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
    fixtureFieldAgentIds.push(tpAgent._id);
    const tpKyc = await KYC.create({
      ownerId: tpUser._id,
      applicantType: "FIELD_AGENT",
      status: "VERIFIED",
      bank: { accountHolder: `${P}TPUSER`, maskedAccount: "XXXX3333", ifsc: "SBIN0000003", bankName: "SBI", pennyDropStatus: "SUCCESS" },
      verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
    });
    fixtureKycIds.push(tpKyc._id);
    fixtureWalletEntities.push({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id });

    // ── SETUP: an UNVERIFIED ACQUISITION_AGENT (neither signal true) ──
    const unverifiedUser = await User.create({ name: `${P}UNVER`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(unverifiedUser._id);
    const unverifiedAgent = await FieldAgent.create({ userRef: unverifiedUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    fixtureFieldAgentIds.push(unverifiedAgent._id);
    const unverifiedKyc = await KYC.create({
      ownerId: unverifiedUser._id,
      applicantType: "FIELD_AGENT",
      status: "PENDING",
      bank: { accountHolder: `${P}UNVER`, maskedAccount: "XXXX4444", ifsc: "AXIS0000004", bankName: "Axis Bank", pennyDropStatus: "PENDING" },
      verification: { bank: { status: "PENDING", verified: false } },
    });
    fixtureKycIds.push(unverifiedKyc._id);
    fixtureWalletEntities.push({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: unverifiedAgent._id });

    // Fund every entity's wallet with ₹500.00 AVAILABLE.
    for (const { entityType, entityId } of fixtureWalletEntities) {
      await withSession((session) =>
        WalletBalanceService.credit({ entityType, entityId, amountInPaise: 50000, action: "BONUS", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}fund:${entityId}`, session })
      );
    }

    // ═══ SCENARIO A — SALON, verified via verification.bank.verified ═══
    const reqA = await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id, amountInPaise: 20000, idempotencyKey: `${P}salon:req1`, triggeredBy: "OWNER", triggeredById: owner._id });
    check("A1. SALON withdrawal request succeeds (KYC verified via verification.bank.verified)", reqA?.status === "REQUESTED" && reqA.amountInPaise === 20000, reqA);
    check("A2. bankSnapshot correctly captured from KYC", reqA?.bankSnapshot?.maskedAccount === "XXXX1111" && reqA.bankSnapshot.ifsc === "HDFC0000001", reqA?.bankSnapshot);
    let salonWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id });
    check("A3. AVAILABLE → LOCKED atomically: ₹300.00 AVAILABLE remains, ₹200.00 LOCKED", salonWallet?.availableBalanceInPaise === 30000 && salonWallet?.lockedBalanceInPaise === 20000, salonWallet);

    // ═══ SCENARIO B — ACQUISITION_AGENT, verified via pennyDropStatus ═══
    const reqB = await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgent._id, amountInPaise: 15000, idempotencyKey: `${P}acq:req1`, triggeredBy: "FIELD_AGENT", triggeredById: acqUser._id });
    check("B1. ACQUISITION_AGENT withdrawal succeeds via the OTHER verification signal (bank.pennyDropStatus=SUCCESS) — universal resolver accepts either signal", reqB?.status === "REQUESTED", reqB);
    let acqWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqAgent._id });
    check("B2. ACQUISITION_AGENT wallet: ₹350.00 AVAILABLE remains, ₹150.00 LOCKED", acqWallet?.availableBalanceInPaise === 35000 && acqWallet?.lockedBalanceInPaise === 15000, acqWallet);

    // ═══ SCENARIO C — TERRITORY_PARTNER ═══════════════════════════════
    const reqC = await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id, amountInPaise: 10000, idempotencyKey: `${P}tp:req1`, triggeredBy: "FIELD_AGENT", triggeredById: tpUser._id });
    check("C1. TERRITORY_PARTNER withdrawal succeeds — same universal resolver, same service, third entity type", reqC?.status === "REQUESTED" && reqC.entityType === "TERRITORY_PARTNER", reqC);
    let tpWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id });
    check("C2. TERRITORY_PARTNER wallet: ₹400.00 AVAILABLE, ₹100.00 LOCKED", tpWallet?.availableBalanceInPaise === 40000 && tpWallet?.lockedBalanceInPaise === 10000, tpWallet);

    // ═══ SCENARIO D — unverified KYC → rejected, NOTHING created ═══════
    let unverifiedErr;
    try {
      await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: unverifiedAgent._id, amountInPaise: 10000, idempotencyKey: `${P}unver:req1` });
    } catch (e) { unverifiedErr = e; }
    check("D1. Unverified KYC → rejected (forbidden)", /verified/i.test(unverifiedErr?.message || ""), unverifiedErr?.message);
    const unverifiedWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: unverifiedAgent._id });
    check("D2. Wallet balance completely unchanged — no partial hold (still ₹500.00 AVAILABLE, ₹0 LOCKED)", unverifiedWallet?.availableBalanceInPaise === 50000 && unverifiedWallet?.lockedBalanceInPaise === 0, unverifiedWallet);
    check("D3. NO GenericPayoutRequest document created for the rejected attempt", (await GenericPayoutRequest.countDocuments({ entityId: unverifiedAgent._id })) === 0);

    // ═══ SCENARIO E — insufficient balance → rejected atomically ═══════
    // A FRESH entity with no open request, so this exercises the
    // balance check specifically, not the one-open-request guard.
    const overdraftUser = await User.create({ name: `${P}OVERDRAFT`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(overdraftUser._id);
    const overdraftAgent = await FieldAgent.create({ userRef: overdraftUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
    fixtureFieldAgentIds.push(overdraftAgent._id);
    const overdraftKyc = await KYC.create({
      ownerId: overdraftUser._id,
      applicantType: "FIELD_AGENT",
      status: "VERIFIED",
      bank: { accountHolder: `${P}OVERDRAFT`, maskedAccount: "XXXX5555", ifsc: "SBIN0000005", bankName: "SBI", pennyDropStatus: "SUCCESS" },
      verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
    });
    fixtureKycIds.push(overdraftKyc._id);
    fixtureWalletEntities.push({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: overdraftAgent._id });
    await withSession((session) =>
      WalletBalanceService.credit({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: overdraftAgent._id, amountInPaise: 1000, action: "BONUS", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}fund:${overdraftAgent._id}`, session })
    );

    let insufficientErr;
    try {
      await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: overdraftAgent._id, amountInPaise: 999999999, idempotencyKey: `${P}overdraft:req1` });
    } catch (e) { insufficientErr = e; }
    check("E1. Insufficient balance → rejected", /Insufficient/i.test(insufficientErr?.message || ""), insufficientErr?.message);
    check("E2. NO orphaned GenericPayoutRequest left behind (all-or-nothing transaction)", (await GenericPayoutRequest.countDocuments({ entityId: overdraftAgent._id })) === 0);
    const overdraftWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: overdraftAgent._id });
    check("E3. Wallet balance completely unchanged after the rejected overdraft attempt (still ₹10.00 AVAILABLE, ₹0 LOCKED)", overdraftWallet?.availableBalanceInPaise === 1000 && overdraftWallet?.lockedBalanceInPaise === 0, overdraftWallet);

    // ═══ SCENARIO F — one open payout request per entity ═══════════════
    let openConflictErr;
    try {
      await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id, amountInPaise: 5000, idempotencyKey: `${P}salon:req2` });
    } catch (e) { openConflictErr = e; }
    check("F1. A second request while one is OPEN is rejected (service-level check)", /pending/i.test(openConflictErr?.message || ""), openConflictErr?.message);
    // DB-level backstop — bypass the service, attempt a direct duplicate create.
    let dbLevelErr;
    try {
      await GenericPayoutRequest.create({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id, amountInPaise: 1000, bankSnapshot: reqA.bankSnapshot, idempotencyKey: `${P}salon:bypass`, isOpen: true });
    } catch (e) { dbLevelErr = e; }
    check("F2. Even a DIRECT model write attempting a second OPEN request is rejected by the partial unique index (not just the service)", dbLevelErr?.code === 11000, dbLevelErr?.message);

    // ═══ SCENARIO G — idempotency: replaying the SAME key returns the SAME request ═══
    const reqARepeat = await requestGenericPayout({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id, amountInPaise: 20000, idempotencyKey: `${P}salon:req1` });
    check("G1. Replaying the SAME idempotencyKey returns the SAME request, not a new one", String(reqARepeat._id) === String(reqA._id));
    salonWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salon._id });
    check("G2. No second hold applied — LOCKED still exactly ₹200.00, not ₹400.00", salonWallet?.lockedBalanceInPaise === 20000, salonWallet);
    check("G3. Exactly ONE GenericPayoutRequest document exists for this entity", (await GenericPayoutRequest.countDocuments({ entityId: salon._id })) === 1);

    // ═══ SCENARIO H — bankSnapshot is immutable ═════════════════════════
    let snapshotMutationErr;
    try {
      const doc = await GenericPayoutRequest.findById(reqA._id);
      doc.bankSnapshot.maskedAccount = "HACKED0000";
      await doc.save();
    } catch (e) { snapshotMutationErr = e; }
    const reqAAfterAttack = await GenericPayoutRequest.findById(reqA._id).lean();
    check("H1. bankSnapshot fields are immutable — mutation attempt did not change the stored value", reqAAfterAttack.bankSnapshot.maskedAccount === "XXXX1111", reqAAfterAttack.bankSnapshot);

    // ═══ SCENARIO I — refund compatibility: LOCKED + a separate PENDING reversal coexist correctly ═══
    await withSession((session) =>
      WalletBalanceService.creditPending({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id, amountInPaise: 6000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}tp:pending1`, session })
    );
    await withSession((session) =>
      WalletBalanceService.debitPending({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id, amountInPaise: 6000, action: "REFUND", refType: "REFUND", refId: oid(), idempotencyKey: `${P}tp:refund1`, session })
    );
    tpWallet = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpAgent._id });
    check("I1. Refund compatibility preserved: PENDING correctly reversed to ₹0 while the ₹100.00 LOCKED (open payout request) is completely unaffected", tpWallet?.pendingBalanceInPaise === 0 && tpWallet?.lockedBalanceInPaise === 10000, tpWallet);

    // ═══ ISOLATION ═══════════════════════════════════════════════════
    check("J1. models/PayoutRequest.js (SALON's existing, frozen model) completely untouched by this entire run", (await PayoutRequest.countDocuments({})) === payoutRequestCountBefore);
    check("J2. FieldAgentPayoutRequest completely untouched", (await FieldAgentPayoutRequest.countDocuments({})) === fieldAgentPayoutCountBefore);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
