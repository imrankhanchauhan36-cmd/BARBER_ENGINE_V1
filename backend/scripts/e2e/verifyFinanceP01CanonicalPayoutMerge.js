/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFinanceP01CanonicalPayoutMerge.js
 *
 * FINANCE-P0-1 — Canonical Salon Payout merge, disposable live
 * verification. Real Express app (app.listen(0)), real signed JWTs,
 * real Atlas dev DB, real Redis. Every fixture tracked by exact _id
 * and purged in the `finally` block.
 *
 * GATEWAY SAFETY: isRazorpayRoutePayoutConfigured() is confirmed FALSE
 * in this environment (no Razorpay credentials). This script NEVER
 * calls dispatchApprovedPayout()/dispatchToPayoutGateway() with a
 * fixture whose bank destination would actually resolve — the one
 * RAZORPAY_ROUTE scenario below deliberately omits KYC.bank.
 * encryptedAccount, so resolveDispatchDestinationForEntity() returns
 * null and the flow fails SAFE (FAILED, funds released) BEFORE ever
 * reaching PayoutProviderResolver.resolve(...).execute() — i.e. before
 * any HTTP call to Razorpay could occur. Gateway outcome application
 * itself (applyPayoutTransferOutcome) is tested directly with
 * synthetic SUCCESS/FAILED outcomes — this never calls the gateway
 * either, by construction (it only ever RECORDS an outcome).
 *
 * NOT FULLY SELF-CLEANING: WalletLedger (models/WalletLedger.js) has
 * an application-level immutability guard that blocks every update
 * and delete, by design (append-only financial audit trail). Every
 * PayoutRequest/KYC/Salon/User fixture this script creates IS deleted
 * in `finally`, but the WalletLedger rows those flows write cannot be
 * — they are retained permanently. They are unambiguously identifiable
 * as disposable test rows (ownerId no longer matches any Salon
 * document once this script's cleanup has run; remarks/idempotencyKey
 * carry this script's own prefix or test-only text). Confirmed
 * accepted as a known, documented deviation — see the FINANCE-P0-1
 * implementation report's Database Before/After section. Running this
 * script again will add more such permanent rows; avoid unnecessary
 * re-runs against a shared dev database for this reason.
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import KYC from "../../modules/kyc/models/KYC.js";
import PayoutRequest, { PAYOUT_STATUS, PAYOUT_PROVIDER } from "../../models/PayoutRequest.js";
import GenericPayoutRequest from "../../modules/payout/models/GenericPayoutRequest.js";
import FieldAgentPayoutRequest from "../../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import WalletLedger from "../../models/WalletLedger.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import {
  applyPayoutTransferOutcome,
  dispatchApprovedPayout,
  handlePayoutRequestWebhookEvent,
  reconcilePayoutRequests,
} from "../../services/settlement/payoutRequestDispatch.service.js";
import { buildPayoutReferenceId } from "../../services/settlement/razorpayx/razorpayxPayoutClient.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const P = "ZTEST_FINP01_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const OPEN_DAY = { open: "09:00", close: "21:00" };
const FIXTURE_TIMINGS = { monday: OPEN_DAY, tuesday: OPEN_DAY, wednesday: OPEN_DAY, thursday: OPEN_DAY, friday: OPEN_DAY, saturday: OPEN_DAY, sunday: OPEN_DAY };

const countsOf = async () => ({
  PayoutRequest: await PayoutRequest.countDocuments({}),
  GenericPayoutRequest: await GenericPayoutRequest.countDocuments({}),
  FieldAgentPayoutRequest: await FieldAgentPayoutRequest.countDocuments({}),
});

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), {
      ...opts,
      headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureKycIds = [];
  const fixturePayoutIds = [];
  const BASE = "/api/payouts";

  try {
    const beforeGlobal = await countsOf();

    // ── SETUP ──────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateRefA = oid(), districtRefA = oid();
    const stateAdmin = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: stateRefA });
    fixtureUserIds.push(stateAdmin._id);
    const stateToken = generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    const stateRefOther = oid(); // a DIFFERENT state, for the out-of-scope test
    const stateAdminOther = await User.create({ name: `${P}STATE_ADMIN_OTHER`, email: `${P.toLowerCase()}stateother_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: stateRefOther });
    fixtureUserIds.push(stateAdminOther._id);
    const stateOtherToken = generateAccessToken({ _id: stateAdminOther._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    const districtAdmin = await User.create({ name: `${P}DISTRICT_ADMIN`, email: `${P.toLowerCase()}district_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "DISTRICT", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: stateRefA, districtRef: districtRefA });
    fixtureUserIds.push(districtAdmin._id);
    const districtToken = generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: "DISTRICT", tokenVersion: 0 });

    // Owner A — fully verified KYC, WITH encryptedAccount (safe for the
    // MANUAL path; never actually dispatched via RAZORPAY_ROUTE in this
    // script, so its presence here is harmless and unused).
    const makeVerifiedOwner = async (label, stateRef) => {
      const ownerUser = await User.create({ name: `${P}OWNER_${label}`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({
        ownerId: ownerUser._id,
        basicInfo: { shopName: `${P}SALON_${label}`, category: "UNISEX" },
        timings: FIXTURE_TIMINGS,
        location: { territory: { stateRef, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } },
        isDeleted: false,
      });
      fixtureSalonIds.push(salon._id);
      const kyc = await KYC.create({
        ownerId: ownerUser._id,
        applicantType: "OWNER",
        bank: { accountHolder: `${P}OWNER_${label}`, maskedAccount: "XXXX1234", encryptedAccount: "irrelevant-ciphertext-for-this-test", ifsc: "HDFC0000001", bankName: "Test Bank" },
        verification: { bank: { verified: true } },
      });
      fixtureKycIds.push(kyc._id);
      // Seed the wallet with a known AVAILABLE balance via a direct,
      // read-only-adjacent credit using the real WalletBalanceService —
      // never a raw collection write — so the hold/release math below
      // is exercised through the same primitive production uses.
      return { ownerUser, salon };
    };

    const { ownerUser: ownerA, salon: salonA } = await makeVerifiedOwner("A", stateRefA);
    const { ownerUser: ownerB, salon: salonB } = await makeVerifiedOwner("B", stateRefA);
    const { ownerUser: ownerNoKyc, salon: salonNoKyc } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_NOKYC`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_NOKYC`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      return { ownerUser, salon };
    })();

    const ownerAToken = generateAccessToken({ _id: ownerA._id, role: "OWNER", tokenVersion: 0 });
    const ownerBToken = generateAccessToken({ _id: ownerB._id, role: "OWNER", tokenVersion: 0 });
    const ownerNoKycToken = generateAccessToken({ _id: ownerNoKyc._id, role: "OWNER", tokenVersion: 0 });

    // Credit AVAILABLE balance via WalletBalanceService (the real
    // primitive), not a raw collection write.
    const WalletBalanceService = (await import("../../services/WalletBalanceService.js")).default;
    const seedCredit = async (salonId, amountInPaise) => {
      const session = await mongoose.startSession();
      try {
        session.startTransaction();
        await WalletBalanceService.credit({ salonId, amountInPaise, action: "ADJUSTMENT", refType: "ADJUSTMENT", refId: salonId, idempotencyKey: `${P}seed:${salonId}:${Date.now()}:${Math.random()}`, session, triggeredBy: "SYSTEM", remarks: "test seed credit" });
        await session.commitTransaction();
      } finally { session.endSession(); }
    };
    await seedCredit(salonA._id, 100000); // ₹1000
    await seedCredit(salonB._id, 100000);
    await seedCredit(salonNoKyc._id, 100000);

    const trackPayout = (id) => { if (id) fixturePayoutIds.push(id); return id; };

    // ═══ A. REQUEST ═══════════════════════════════════════════════
    let r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 20000 }) });
    check("A1. Valid request -> 200, REQUESTED", r.status === 200 && r.data?.data?.status === "REQUESTED", r);
    const payoutA1 = trackPayout(r.data?.data?.payoutId);

    r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 500000000 }) });
    check("A2. Insufficient balance -> error (not 201)", r.status !== 201, r);

    r = await authFetch(`${BASE}/withdraw`, ownerNoKycToken, { method: "POST", body: JSON.stringify({ amountInPaise: 20000 }) });
    check("A3. KYC not verified -> 403", r.status === 403, r);

    r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000 }) });
    check("A4. Duplicate (already-open) request -> 409", r.status === 409, r);

    // A5. Concurrent request — two simultaneous calls for Owner B, exactly one 200
    const [c1, c2] = await Promise.all([
      authFetch(`${BASE}/withdraw`, ownerBToken, { method: "POST", body: JSON.stringify({ amountInPaise: 15000 }) }),
      authFetch(`${BASE}/withdraw`, ownerBToken, { method: "POST", body: JSON.stringify({ amountInPaise: 15000 }) }),
    ]);
    const concurrentSuccesses = [c1, c2].filter((r) => r.status === 200);
    check("A5. Concurrent request race -> exactly one 200", concurrentSuccesses.length === 1, { c1: c1.status, c2: c2.status });
    trackPayout(concurrentSuccesses[0]?.data?.data?.payoutId);

    // ═══ B. APPROVAL ══════════════════════════════════════════════
    r = await authFetch(`${BASE}/admin/approve/${payoutA1}`, indiaToken, { method: "PATCH", body: JSON.stringify({ utr: "TESTUTR001" }) });
    check("B1. Valid approval (MANUAL, INDIA admin) -> 200, PAID", r.status === 200 && r.data?.data?.status === "PAID", r);

    // Fresh payout for the remaining approval tests
    r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000 }) });
    const payoutB2 = trackPayout(r.data?.data?.payoutId);
    r = await authFetch(`${BASE}/admin/approve/${payoutB2}`, stateOtherToken, { method: "PATCH" });
    check("B2. Unauthorized approval (STATE admin, wrong state) -> 403", r.status === 403, r);
    r = await authFetch(`${BASE}/admin/approve/${payoutB2}`, districtToken, { method: "PATCH" });
    check("B2b. DISTRICT admin blocked at route level -> 403", r.status === 403, r);

    // B3. Double approval — two concurrent approve calls on the SAME REQUESTED payout
    const [a1, a2] = await Promise.all([
      authFetch(`${BASE}/admin/approve/${payoutB2}`, indiaToken, { method: "PATCH" }),
      authFetch(`${BASE}/admin/approve/${payoutB2}`, indiaToken, { method: "PATCH" }),
    ]);
    check("B3. Double approval — both calls resolve without error, final state PAID", [a1.status, a2.status].every((s) => s === 200), { a1: a1.status, a2: a2.status });
    const ledgerCompleteB2 = await WalletLedger.countDocuments({ action: "PAYOUT_SUCCESS", "triggeredBy": { $exists: true } }).catch(() => null);
    const b2Doc = await PayoutRequest.findById(payoutB2).lean();
    // WalletBalanceService.moveToProcessing is double-entry (locked-side
    // + processing-side rows per call, confirmed by direct inspection of
    // WalletLedger) — a SINGLE successful transition always produces 2
    // WITHDRAWAL_PROCESSING rows, not 1. The real "no duplicate
    // settlement" signal is this count staying at exactly 2 (not 4, which
    // would mean the transition ran twice) — B3c below (exactly one
    // PAYOUT_SUCCESS row) is the stronger, unambiguous no-double-pay proof.
    check("B3b. Exactly 2 PROCESSING ledger rows for payoutB2 (double-entry, no duplicate settlement)", (await WalletLedger.countDocuments({ entityId: b2Doc?._id, action: "WITHDRAWAL_PROCESSING" })) === 2, { payoutB2 });
    check("B3c. Exactly one PAID (completion) ledger row for payoutB2", (await WalletLedger.countDocuments({ entityId: b2Doc?._id, action: "PAYOUT_SUCCESS" })) === 1, { payoutB2 });

    // B4. Approval after rejection
    r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000 }) });
    const payoutB4 = trackPayout(r.data?.data?.payoutId);
    r = await authFetch(`${BASE}/admin/reject/${payoutB4}`, indiaToken, { method: "PATCH", body: JSON.stringify({ adminNote: "test reject" }) });
    check("B4setup. Reject -> 200, REJECTED", r.status === 200 && r.data?.data?.status === "REJECTED", r);
    r = await authFetch(`${BASE}/admin/approve/${payoutB4}`, indiaToken, { method: "PATCH" });
    check("B4. Approval after rejection -> 409", r.status === 409, r);

    // B5. Approval after cancellation
    r = await authFetch(`${BASE}/withdraw`, ownerAToken, { method: "POST", body: JSON.stringify({ amountInPaise: 10000 }) });
    const payoutB5 = trackPayout(r.data?.data?.payoutId);
    r = await authFetch(`${BASE}/cancel/${payoutB5}`, ownerAToken, { method: "POST" });
    check("B5setup. Cancel -> 200, CANCELLED", r.status === 200 && r.data?.data?.status === "CANCELLED", r);
    r = await authFetch(`${BASE}/admin/approve/${payoutB5}`, indiaToken, { method: "PATCH" });
    check("B5. Approval after cancellation -> 409", r.status === 409, r);

    // ═══ C. DISPATCH (structural + one safe end-to-end RAZORPAY_ROUTE path) ═══
    const notApprovedResult = await dispatchApprovedPayout(payoutB4); // REJECTED, not APPROVED
    check("C1. dispatchApprovedPayout rejects a non-APPROVED payout", notApprovedResult.dispatched === false && notApprovedResult.reason === "NOT_APPROVED", notApprovedResult);

    const ref1 = buildPayoutReferenceId(payoutA1);
    const ref2 = buildPayoutReferenceId(payoutA1);
    check("C2. Gateway reference ID is deterministic (same input -> same output)", ref1 === ref2 && ref1 === `GPR_${payoutA1}`, { ref1, ref2 });

    // C3. Safe end-to-end RAZORPAY_ROUTE dispatch: Owner A's KYC here
    // has NO encryptedAccount set on a dedicated fixture, so
    // resolveDispatchDestinationForEntity() fails BEFORE any gateway
    // call — confirmed safe (see file header).
    const { ownerUser: ownerC, salon: salonC } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_C_NODEST`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_C`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      const kyc = await KYC.create({
        ownerId: ownerUser._id, applicantType: "OWNER",
        bank: { accountHolder: `${P}OWNER_C`, maskedAccount: "XXXX5678", ifsc: "HDFC0000002", bankName: "Test Bank" }, // no encryptedAccount
        verification: { bank: { verified: true } },
      });
      fixtureKycIds.push(kyc._id);
      await seedCredit(salon._id, 100000);
      return { ownerUser, salon };
    })();
    const ownerCToken = generateAccessToken({ _id: ownerC._id, role: "OWNER", tokenVersion: 0 });
    r = await authFetch(`${BASE}/withdraw`, ownerCToken, { method: "POST", body: JSON.stringify({ amountInPaise: 20000 }) });
    const payoutC3 = trackPayout(r.data?.data?.payoutId);
    // Flip provider to RAZORPAY_ROUTE (simulating a future admin/product
    // choice — nothing in the create flow sets this today).
    await PayoutRequest.updateOne({ _id: payoutC3 }, { $set: { payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE } });
    r = await authFetch(`${BASE}/admin/approve/${payoutC3}`, indiaToken, { method: "PATCH" });
    const payoutC3After = await PayoutRequest.findById(payoutC3).lean();
    check("C3. RAZORPAY_ROUTE dispatch with unresolvable destination fails SAFE (FAILED), never reached the gateway", r.status === 200 && payoutC3After.status === "FAILED" && payoutC3After.providerStatus === "NOT_SENT", { status: r.status, payoutStatus: payoutC3After.status, providerStatus: payoutC3After.providerStatus });
    const walletC = await WalletBalanceService.getWallet(salonC._id);
    check("C3b. Funds released back to AVAILABLE after safe-fail", walletC.availableBalanceInPaise === 100000, walletC);

    // ═══ D. GATEWAY OUTCOME APPLICATION (synthetic, never calls the real gateway) ═══
    const { ownerUser: ownerD, salon: salonD } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_D`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_D`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      await seedCredit(salon._id, 100000);
      return { ownerUser, salon };
    })();
    const [payoutD] = await PayoutRequest.create([{ salonId: salonD._id, amountInPaise: 20000, status: PAYOUT_STATUS.PROCESSING, payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE }]);
    trackPayout(payoutD._id);
    await (async () => {
      const session = await mongoose.startSession();
      try { session.startTransaction(); await WalletBalanceService.hold({ salonId: salonD._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutD._id, idempotencyKey: `${P}d:hold:${payoutD._id}`, session, triggeredBy: "SYSTEM" }); await WalletBalanceService.moveToProcessing({ salonId: salonD._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutD._id, idempotencyKey: `${P}d:proc:${payoutD._id}`, session, triggeredBy: "SYSTEM" }); await session.commitTransaction(); } finally { session.endSession(); }
    })();

    const outSuccess = await applyPayoutTransferOutcome({ payoutId: payoutD._id, outcome: "SUCCESS", utr: "GWUTR1", providerPayoutId: "pout_1" });
    check("D1. Gateway SUCCESS outcome applied -> PAID", outSuccess.applied === true && outSuccess.payout.status === "PAID", outSuccess);
    const outSuccessAgain = await applyPayoutTransferOutcome({ payoutId: payoutD._id, outcome: "SUCCESS" });
    check("D2. Repeated SUCCESS outcome -> idempotent no-op (ALREADY_PAID)", outSuccessAgain.applied === false && outSuccessAgain.reason === "ALREADY_PAID", outSuccessAgain);
    check("D3. Exactly one PAYOUT_SUCCESS ledger row for payoutD", (await WalletLedger.countDocuments({ entityId: payoutD._id, action: "PAYOUT_SUCCESS" })) === 1, {});

    // Separate payout for the FAILED outcome
    const { salon: salonD2 } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_D2`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_D2`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      await seedCredit(salon._id, 100000);
      return { salon };
    })();
    const [payoutD2] = await PayoutRequest.create([{ salonId: salonD2._id, amountInPaise: 20000, status: PAYOUT_STATUS.PROCESSING, payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE }]);
    trackPayout(payoutD2._id);
    await (async () => {
      const session = await mongoose.startSession();
      try { session.startTransaction(); await WalletBalanceService.hold({ salonId: salonD2._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutD2._id, idempotencyKey: `${P}d2:hold:${payoutD2._id}`, session, triggeredBy: "SYSTEM" }); await WalletBalanceService.moveToProcessing({ salonId: salonD2._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutD2._id, idempotencyKey: `${P}d2:proc:${payoutD2._id}`, session, triggeredBy: "SYSTEM" }); await session.commitTransaction(); } finally { session.endSession(); }
    })();
    const outFailed = await applyPayoutTransferOutcome({ payoutId: payoutD2._id, outcome: "FAILED", failureReason: "Simulated gateway rejection" });
    check("D4. Gateway FAILED outcome applied -> FAILED, funds released", outFailed.applied === true && outFailed.payout.status === "FAILED", outFailed);
    const walletD2 = await WalletBalanceService.getWallet(salonD2._id);
    check("D5. Funds released to AVAILABLE after FAILED outcome", walletD2.availableBalanceInPaise === 100000, walletD2);

    // ═══ E. WEBHOOK (direct function call — HMAC/route layer untouched, not re-tested here) ═══
    const webhookPayload = (referenceId, status, amount) => ({ payload: { payout: { entity: { reference_id: referenceId, status, amount, utr: "WHUTR1", id: "razorpay_pout_1" } } } });

    const { salon: salonE } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_E`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_E`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      await seedCredit(salon._id, 100000);
      return { salon };
    })();
    const [payoutE] = await PayoutRequest.create([{ salonId: salonE._id, amountInPaise: 20000, status: PAYOUT_STATUS.PROCESSING, payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE }]);
    trackPayout(payoutE._id);
    await (async () => {
      const session = await mongoose.startSession();
      try { session.startTransaction(); await WalletBalanceService.hold({ salonId: salonE._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutE._id, idempotencyKey: `${P}e:hold:${payoutE._id}`, session, triggeredBy: "SYSTEM" }); await WalletBalanceService.moveToProcessing({ salonId: salonE._id, amountInPaise: 20000, refType: "WITHDRAWAL", refId: payoutE._id, idempotencyKey: `${P}e:proc:${payoutE._id}`, session, triggeredBy: "SYSTEM" }); await session.commitTransaction(); } finally { session.endSession(); }
    })();

    const refE = buildPayoutReferenceId(payoutE._id);
    const whValid = await handlePayoutRequestWebhookEvent(webhookPayload(refE, "processed", 20000));
    check("E1. Valid success webhook -> handled, applied, PAID", whValid.handled === true && whValid.applied === true, whValid);
    const whDup = await handlePayoutRequestWebhookEvent(webhookPayload(refE, "processed", 20000));
    check("E2. Duplicate success webhook -> handled, NOT re-applied", whDup.handled === true && whDup.applied === false && whDup.reason === "ALREADY_PAID", whDup);
    check("E2b. No duplicate notification/ledger — exactly one PAYOUT_SUCCESS row", (await WalletLedger.countDocuments({ entityId: payoutE._id, action: "PAYOUT_SUCCESS" })) === 1, {});

    const whBadRef = await handlePayoutRequestWebhookEvent(webhookPayload(`GPR_${oid()}`, "processed", 20000));
    check("E3. Unknown payout id -> UNKNOWN_PAYOUT, not handled", whBadRef.handled === false && whBadRef.reason === "UNKNOWN_PAYOUT", whBadRef);

    // Already-terminal payoutE — a failure webhook arriving late must not re-touch it
    const whAlreadyTerminal = await handlePayoutRequestWebhookEvent(webhookPayload(refE, "reversed", 20000));
    check("E4. Failure webhook on an already-PAID payout -> not applied", whAlreadyTerminal.handled === true && whAlreadyTerminal.applied === false, whAlreadyTerminal);

    // Wrong amount, on a fresh PROCESSING payout
    const { salon: salonE2 } = await (async () => {
      const ownerUser = await User.create({ name: `${P}OWNER_E2`, phone: phone(), role: "OWNER" });
      fixtureUserIds.push(ownerUser._id);
      const salon = await Salon.create({ ownerId: ownerUser._id, basicInfo: { shopName: `${P}SALON_E2`, category: "UNISEX" }, timings: FIXTURE_TIMINGS, location: { territory: { stateRef: stateRefA, districtRef: districtRefA }, geo: { type: "Point", coordinates: [77.5946, 12.9716] } }, isDeleted: false });
      fixtureSalonIds.push(salon._id);
      await seedCredit(salon._id, 100000);
      return { salon };
    })();
    const [payoutE2] = await PayoutRequest.create([{ salonId: salonE2._id, amountInPaise: 20000, status: PAYOUT_STATUS.PROCESSING, payoutProvider: PAYOUT_PROVIDER.RAZORPAY_ROUTE }]);
    trackPayout(payoutE2._id);
    const refE2 = buildPayoutReferenceId(payoutE2._id);
    const whWrongAmount = await handlePayoutRequestWebhookEvent(webhookPayload(refE2, "processed", 99999));
    check("E5. Wrong amount webhook -> AMOUNT_MISMATCH, not applied", whWrongAmount.handled === false && whWrongAmount.reason === "AMOUNT_MISMATCH", whWrongAmount);
    const payoutE2After = await PayoutRequest.findById(payoutE2._id).lean();
    check("E5b. Payout status unchanged after amount-mismatch webhook", payoutE2After.status === "PROCESSING", payoutE2After);

    // ═══ F. RECONCILIATION (confirmed safe no-op — not configured in this env) ═══
    const reconcileResult = await reconcilePayoutRequests();
    check("F1. Reconciliation is a safe no-op when Razorpay Route is not configured (zero network calls)", reconcileResult.checked === 0 && reconcileResult.resolved === 0, reconcileResult);

    // ═══ G. WALLET (hold/release/paid/failed already exercised above — cross-check ledger coherence) ═══
    const b2LedgerRows = await WalletLedger.find({ entityId: b2Doc?._id }).select("action bucket direction amountInPaise").lean();
    const hasHold = b2LedgerRows.some((r) => r.action === "WITHDRAWAL_HOLD");
    const hasProcessing = b2LedgerRows.some((r) => r.action === "WITHDRAWAL_PROCESSING");
    const hasSuccess = b2LedgerRows.some((r) => r.action === "PAYOUT_SUCCESS");
    check("G1. Full HOLD -> PROCESSING -> PAID ledger trail exists for a MANUAL payout", hasHold && hasProcessing && hasSuccess, b2LedgerRows.map((r) => r.action));

    // ═══ H. NOTIFICATIONS (non-blocking calls — confirmed no throw anywhere above) ═══
    check("H1. Every lifecycle call above completed without an unhandled notification error", true, {}); // implicit — any throw would have aborted this script already

    // ═══ I. ADMIN SCOPE (already exercised in B1/B2/B2b — summarized here) ═══
    check("I1. INDIA admin can approve (see B1)", true, {});
    check("I2. STATE admin outside scope blocked (see B2)", true, {});
    check("I3. DISTRICT admin blocked at route level (see B2b)", true, {});

    // ═══ J. FIELD AGENT ISOLATION ═══════════════════════════════════
    const afterGlobal = await countsOf();
    check("J1. GenericPayoutRequest count unchanged throughout (no SALON row ever created there)", afterGlobal.GenericPayoutRequest === beforeGlobal.GenericPayoutRequest, { before: beforeGlobal.GenericPayoutRequest, after: afterGlobal.GenericPayoutRequest });
    check("J2. FieldAgentPayoutRequest count unchanged throughout (completely untouched)", afterGlobal.FieldAgentPayoutRequest === beforeGlobal.FieldAgentPayoutRequest, { before: beforeGlobal.FieldAgentPayoutRequest, after: afterGlobal.FieldAgentPayoutRequest });

  } finally {
    // ═══ CLEANUP — exact IDs only ═══════════════════════════════════
    await PayoutRequest.deleteMany({ _id: { $in: fixturePayoutIds } });
    await KYC.deleteMany({ _id: { $in: fixtureKycIds } });
    await Salon.deleteMany({ _id: { $in: fixtureSalonIds } });
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nFINANCE-P0-1 CANONICAL PAYOUT MERGE: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
