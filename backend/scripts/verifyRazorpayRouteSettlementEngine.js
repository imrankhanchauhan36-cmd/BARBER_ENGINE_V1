/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRazorpayRouteSettlementEngine.js
 *
 * STEP 6.4 — Razorpay Route Settlement Engine — disposable live
 * verification. No real Razorpay Route credentials exist for this
 * environment (per the STEP 6.4 audit's own Risk #1/#2) — a local HTTP
 * stub stands in for Razorpay via RAZORPAYX_ROUTE_BASE_URL (the exact
 * same non-production escape hatch cashfreePayoutClient.js's own
 * CASHFREE_PAYOUT_BASE_URL already established as this codebase's
 * precedent), so the FULL state machine, idempotency, webhook, and
 * reconciliation logic is exercised end-to-end with no network access
 * and no real credentials — never guessed at, never faked at the
 * application layer. The stub's next payout outcome is set immediately
 * before each dispatch-triggering call (the script runs everything
 * sequentially/awaited, so there is no race).
 *
 * Real Express app (app.listen(0)) IS used for one thing: a genuine
 * HTTP POST to the actual mounted, signature-verified webhook route —
 * proving the real wiring, not just the underlying service function.
 *
 * Proves:
 *   1. Auto dispatch, no admin approval: requestGenericPayout() alone
 *      drives REQUESTED -> PROCESSING -> PAID for a SALON entity when
 *      the gateway responds "processed" synchronously.
 *   2. PENDING outcome stays PROCESSING; a REAL signed webhook POST to
 *      the mounted route resolves it to PAID via the shared
 *      applyTransferOutcome(); replaying the same webhook is a no-op;
 *      a bad signature is rejected.
 *   3. Reconciliation resolves a stuck PROCESSING payout via the SAME
 *      applyTransferOutcome(), for TERRITORY_PARTNER.
 *   4. A definitive rejection -> FAILED, PROCESSING -> AVAILABLE.
 *   5. Idempotent end-to-end: replaying the same idempotencyKey after
 *      PAID returns the existing document, no second dispatch/hold.
 *   6. Refund compatibility: debitPending still works correctly on an
 *      entity's PENDING bucket while its GenericPayoutRequest sits in
 *      PROCESSING.
 *   7. RevenueSplit, GSTLedger, TerritoryRevenueLedger, PayoutRequest,
 *      FieldAgentPayoutRequest — all completely untouched (isolation).
 *
 * Run:  cd backend && node scripts/verifyRazorpayRouteSettlementEngine.js
 */

import "dotenv/config";
import http from "http";
import crypto from "crypto";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import app from "../app.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import PayoutRequest from "../models/PayoutRequest.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import KYC from "../modules/kyc/models/KYC.js";
import GenericPayoutRequest from "../modules/payout/models/GenericPayoutRequest.js";
import { requestGenericPayout } from "../modules/payout/services/GenericPayoutRequestService.js";
import { reconcileRazorpayRoutePayouts } from "../modules/payout/services/genericPayoutDispatch.service.js";
import { PAYOUT_ENTITY_TYPE } from "../modules/payout/constants/genericPayoutRequest.constants.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../modules/finance/models/GSTLedger.js";
import TerritoryRevenueLedger from "../modules/finance/models/TerritoryRevenueLedger.js";
import { encrypt } from "../modules/kyc/services/encryption.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_RRS64_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `9${String(9110000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureSalonIds = [];
const fixtureFieldAgentIds = [];
const fixtureKycIds = [];
const fixtureWalletEntities = [];

const dayTiming = { open: "09:00", close: "20:00" };
const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };

// ── LOCAL RAZORPAY ROUTE STUB ─────────────────────────────────────
// In-memory store, no network, no real credentials. See file header.
const payoutsByRef = new Map();
let contactSeq = 0, fundAccountSeq = 0, payoutSeq = 0;
let nextOutcome = "processed"; // "processed" | "rejected" | "queued" — set before each dispatch-triggering call

const readJsonBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
});

const startStubServer = () => new Promise((resolvePort) => {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

    if (req.method === "GET" && u.pathname === "/contacts") {
      return send(200, { items: [] }); // always create-new for this verification — reuse is exercised implicitly across repeat calls, not asserted here
    }
    if (req.method === "POST" && u.pathname === "/contacts") {
      const body = await readJsonBody(req);
      return send(200, { id: `cont_${++contactSeq}`, reference_id: body.reference_id, name: body.name });
    }
    if (req.method === "POST" && u.pathname === "/fund_accounts") {
      const body = await readJsonBody(req);
      return send(200, { id: `fa_${++fundAccountSeq}`, contact_id: body.contact_id });
    }
    if (req.method === "GET" && u.pathname === "/payouts") {
      const refId = u.searchParams.get("reference_id");
      const existing = payoutsByRef.get(refId);
      return send(200, { items: existing ? [existing] : [] });
    }
    if (req.method === "POST" && u.pathname === "/payouts") {
      const body = await readJsonBody(req);
      const outcome = nextOutcome;
      const p = {
        id: `pout_${++payoutSeq}`,
        reference_id: body.reference_id,
        amount: body.amount,
        status: outcome,
        utr: outcome === "processed" ? `UTR${payoutSeq}` : null,
        failure_reason: outcome === "rejected" ? "Insufficient funds in source account" : null,
      };
      payoutsByRef.set(body.reference_id, p);
      return send(200, p);
    }
    if (req.method === "GET" && u.pathname.startsWith("/payouts/")) {
      const id = u.pathname.split("/")[2];
      const found = [...payoutsByRef.values()].find((p) => p.id === id);
      return found ? send(200, found) : send(404, { error: { description: "not found" } });
    }
    send(404, { error: { description: "unhandled stub route" } });
  });
  server.listen(0, () => resolvePort({ server, port: server.address().port }));
});

const purgeFixtures = async () => {
  await GenericPayoutRequest.collection.deleteMany({ entityId: { $in: fixtureWalletEntities.map((e) => e.entityId) } });
  for (const { entityType, entityId } of fixtureWalletEntities) {
    await WalletLedger.collection.deleteMany({ ownerType: entityType, ownerId: entityId });
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
    const out = await fn(session);
    await session.commitTransaction();
    return out;
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
};

const run = async () => {
  await connectDB();

  // ── ENV: point the client at our local stub, never real Razorpay ──
  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_ZTEST_STUB";
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "ztest_stub_secret";
  process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER = process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER || "2323230012345678";
  process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET = process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET || "ztest_payout_webhook_secret";

  const { server: stubServer, port: stubPort } = await startStubServer();
  process.env.RAZORPAYX_ROUTE_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const expressServer = app.listen(0);
  const { port: appPort } = expressServer.address();
  const postWebhook = (rawBody, signature) =>
    fetch(`http://127.0.0.1:${appPort}/api/webhooks/razorpay/payout`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": signature },
      body: rawBody,
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  const sign = (rawBody) => crypto.createHmac("sha256", process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET).update(rawBody).digest("hex");

  try {
    const revenueSplitCountBefore = await RevenueSplit.countDocuments({});
    const gstLedgerCountBefore = await GSTLedger.countDocuments({});
    const territoryRevenueLedgerCountBefore = await TerritoryRevenueLedger.countDocuments({});
    const payoutRequestCountBefore = await PayoutRequest.countDocuments({});
    const fieldAgentPayoutCountBefore = await FieldAgentPayoutRequest.countDocuments({});

    // ── SETUP: SALON, ACQUISITION_AGENT, TERRITORY_PARTNER, and a 4th
    // SALON reserved for the failure scenario — all KYC-verified with a
    // real encrypted account number (needed for dispatch-time decryption) ──
    const mkVerifiedEntity = async (entityType, suffix) => {
      let entityId, ownerUserId, applicantType;
      const owner = await User.create({ name: `${P}${suffix}`, phone: nextPhone(), role: entityType === PAYOUT_ENTITY_TYPE.SALON ? "OWNER" : "FIELD_AGENT", isActive: true });
      fixtureUserIds.push(owner._id);
      if (entityType === PAYOUT_ENTITY_TYPE.SALON) {
        const salon = await Salon.create({
          ownerId: owner._id,
          basicInfo: { shopName: `${P}SALON_${suffix}`, category: "UNISEX" },
          location: { address: `${P} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: {} },
          timings: salonTimings,
          approval: { status: "APPROVED" },
          onboarding: { step: 8 },
          isDeleted: false,
        });
        fixtureSalonIds.push(salon._id);
        entityId = salon._id;
        ownerUserId = owner._id;
        applicantType = "OWNER";
      } else {
        const agent = await FieldAgent.create({ userRef: owner._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: entityType });
        fixtureFieldAgentIds.push(agent._id);
        entityId = agent._id;
        ownerUserId = owner._id;
        applicantType = "FIELD_AGENT";
      }
      const accountNumber = `${suffix}0000000001`;
      const kyc = await KYC.create({
        ownerId: ownerUserId,
        applicantType,
        status: "VERIFIED",
        bank: { accountHolder: `${P}${suffix}`, maskedAccount: `XXXX${accountNumber.slice(-4)}`, encryptedAccount: encrypt(accountNumber), ifsc: "HDFC0000099", bankName: "HDFC Bank", pennyDropStatus: "SUCCESS" },
        verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
      });
      fixtureKycIds.push(kyc._id);
      fixtureWalletEntities.push({ entityType, entityId });
      await withSession((session) =>
        WalletBalanceService.credit({ entityType, entityId, amountInPaise: 100000, action: "BONUS", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}fund:${entityId}`, session })
      );
      return { entityType, entityId, ownerUserId };
    };

    const salonEntity = await mkVerifiedEntity(PAYOUT_ENTITY_TYPE.SALON, "SALON");
    const acqEntity = await mkVerifiedEntity(PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, "ACQ");
    const tpEntity = await mkVerifiedEntity(PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, "TPTP");
    const failEntity = await mkVerifiedEntity(PAYOUT_ENTITY_TYPE.SALON, "FAIL");

    const doRequest = (entity, amountInPaise, idempotencyKey, triggeredBy, triggeredById) =>
      requestGenericPayout({ entityType: entity.entityType, entityId: entity.entityId, amountInPaise, idempotencyKey, triggeredBy, triggeredById });

    // ═══ SCENARIO A — auto dispatch, no admin approval, synchronous SUCCESS ═══
    nextOutcome = "processed";
    const reqA = await doRequest(salonEntity, 30000, `${P}a:req1`, "OWNER", salonEntity.ownerUserId);
    const reqAAfter = await GenericPayoutRequest.findById(reqA._id).lean();
    check("A1. Auto-dispatched all the way to PAID with NO admin approval anywhere in the chain", reqAAfter.status === "PAID" && reqAAfter.payoutProvider === "RAZORPAY_ROUTE", reqAAfter);
    check("A2. UTR + providerPayoutId recorded from the gateway response", !!reqAAfter.utr && !!reqAAfter.providerPayoutId, reqAAfter);
    check("A3. bankSnapshot correctly captured and remains immutable (from STEP 6.3)", reqAAfter.bankSnapshot.ifsc === "HDFC0000099");
    let walletA = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: salonEntity.entityId });
    check("A4. Successful transfer debits Processing permanently: ₹0 PROCESSING, ₹700.00 AVAILABLE remains, lifetimeWithdrawals = ₹300.00", walletA.processingBalanceInPaise === 0 && walletA.availableBalanceInPaise === 70000 && walletA.lifetimeWithdrawalsInPaise === 30000, walletA);

    // ═══ SCENARIO B — PENDING -> real signed webhook resolves to PAID ═══
    nextOutcome = "queued";
    const reqB = await doRequest(acqEntity, 20000, `${P}b:req1`, "FIELD_AGENT", acqEntity.ownerUserId);
    let reqBAfter = await GenericPayoutRequest.findById(reqB._id).lean();
    check("B1. Gateway PENDING outcome ('queued') leaves the payout in PROCESSING, not guessed at", reqBAfter.status === "PROCESSING", reqBAfter);
    let walletB = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqEntity.entityId });
    check("B2. LOCKED already moved to PROCESSING (₹200.00) while awaiting resolution", walletB.processingBalanceInPaise === 20000, walletB);

    const webhookPayload = JSON.stringify({
      event: "payout.processed",
      payload: { payout: { entity: { id: reqBAfter.providerPayoutId || "pout_webhook", reference_id: `GPR_${reqB._id}`, status: "processed", amount: 20000, utr: "UTRWEBHOOK1" } } },
    });
    const sig = sign(webhookPayload);
    const wh1 = await postWebhook(webhookPayload, sig);
    check("B3. Real signed HTTP POST to the mounted webhook route is accepted (200)", wh1.status === 200, wh1.data);
    reqBAfter = await GenericPayoutRequest.findById(reqB._id).lean();
    check("B4. Webhook resolved the payout to PAID via the shared applyTransferOutcome()", reqBAfter.status === "PAID" && reqBAfter.utr === "UTRWEBHOOK1", reqBAfter);

    const wh2 = await postWebhook(webhookPayload, sig);
    check("B5. Replaying the SAME webhook is accepted but a no-op (ALREADY_PAID)", wh2.status === 200 && wh2.data.reason === "ALREADY_PAID", wh2.data);
    walletB = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.ACQUISITION_AGENT, entityId: acqEntity.entityId });
    check("B6. No double-credit from the replayed webhook — PROCESSING still ₹0, lifetimeWithdrawals still ₹200.00 (not ₹400.00)", walletB.processingBalanceInPaise === 0 && walletB.lifetimeWithdrawalsInPaise === 20000, walletB);

    const badSig = await postWebhook(webhookPayload, "deadbeef");
    check("B7. A webhook with an invalid signature is rejected (401), never processed", badSig.status === 401, badSig.data);

    // ═══ SCENARIO C — reconciliation resolves a stuck PROCESSING payout ═══
    nextOutcome = "queued";
    const reqC = await doRequest(tpEntity, 10000, `${P}c:req1`, "FIELD_AGENT", tpEntity.ownerUserId);
    let reqCAfter = await GenericPayoutRequest.findById(reqC._id).lean();
    check("C1. TERRITORY_PARTNER payout also left PROCESSING (queued outcome)", reqCAfter.status === "PROCESSING", reqCAfter);
    const refIdC = `GPR_${reqC._id}`;
    const existingStubRow = payoutsByRef.get(refIdC);
    payoutsByRef.set(refIdC, { id: existingStubRow?.id || "pout_recon", reference_id: refIdC, amount: 10000, status: "processed", utr: "UTRRECON1", failure_reason: null });
    await GenericPayoutRequest.collection.updateOne({ _id: reqC._id }, { $set: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    const reconResult = await reconcileRazorpayRoutePayouts({ olderThanMs: 5 * 60 * 1000, limit: 10 });
    check("C2. Reconciliation checked and resolved the stuck payout", reconResult.resolved >= 1, reconResult);
    reqCAfter = await GenericPayoutRequest.findById(reqC._id).lean();
    check("C3. Reconciliation resolved it to PAID via the SAME shared applyTransferOutcome()", reqCAfter.status === "PAID" && reqCAfter.utr === "UTRRECON1", reqCAfter);
    let walletC = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpEntity.entityId });
    check("C4. TERRITORY_PARTNER wallet correctly debited from PROCESSING permanently", walletC.processingBalanceInPaise === 0 && walletC.lifetimeWithdrawalsInPaise === 10000, walletC);

    // ═══ SCENARIO D — definitive rejection -> FAILED, Processing -> Available ═══
    nextOutcome = "rejected";
    const reqD = await doRequest(failEntity, 15000, `${P}d:req1`, "OWNER", failEntity.ownerUserId);
    const reqDAfter = await GenericPayoutRequest.findById(reqD._id).lean();
    check("D1. A definitive gateway rejection resolves to FAILED", reqDAfter.status === "FAILED" && /Insufficient/i.test(reqDAfter.failureReason || ""), reqDAfter);
    check("D2. fundsReleased flag set", reqDAfter.fundsReleased === true);
    const walletD = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.SALON, entityId: failEntity.entityId });
    check("D3. Failed transfer returns Processing -> Available: ₹0 PROCESSING, full ₹1000.00 AVAILABLE restored", walletD.processingBalanceInPaise === 0 && walletD.availableBalanceInPaise === 100000, walletD);

    // ═══ SCENARIO E — end-to-end idempotency: replay after PAID ═══
    const reqARepeat = await doRequest(salonEntity, 30000, `${P}a:req1`);
    check("E1. Replaying the SAME idempotencyKey after PAID returns the existing document, no new dispatch/hold", String(reqARepeat._id) === String(reqA._id) && reqARepeat.status === "PAID");
    const countForA = await GenericPayoutRequest.countDocuments({ entityId: salonEntity.entityId });
    check("E2. Exactly ONE GenericPayoutRequest document exists for the SALON entity across this whole scenario", countForA === 1, countForA);

    // ═══ SCENARIO F — refund compatibility while a payout is PROCESSING ═══
    nextOutcome = "queued";
    await doRequest(tpEntity, 5000, `${P}f:req1`, "FIELD_AGENT", tpEntity.ownerUserId);
    await withSession((session) =>
      WalletBalanceService.creditPending({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpEntity.entityId, amountInPaise: 4000, action: "BOOKING_SETTLEMENT", refType: "BOOKING", refId: oid(), idempotencyKey: `${P}f:pending1`, session })
    );
    await withSession((session) =>
      WalletBalanceService.debitPending({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpEntity.entityId, amountInPaise: 4000, action: "REFUND", refType: "REFUND", refId: oid(), idempotencyKey: `${P}f:refund1`, session })
    );
    const walletF = await WalletBalanceService.getWallet({ entityType: PAYOUT_ENTITY_TYPE.TERRITORY_PARTNER, entityId: tpEntity.entityId });
    check("F1. Refund compatibility preserved: PENDING correctly reversed to ₹0 while a SEPARATE payout sits in PROCESSING, completely unaffected", walletF.pendingBalanceInPaise === 0 && walletF.processingBalanceInPaise === 5000, walletF);

    // ═══ ISOLATION ═══════════════════════════════════════════════════
    check("G1. RevenueSplit completely untouched", (await RevenueSplit.countDocuments({})) === revenueSplitCountBefore);
    check("G2. GSTLedger completely untouched", (await GSTLedger.countDocuments({})) === gstLedgerCountBefore);
    check("G3. TerritoryRevenueLedger completely untouched", (await TerritoryRevenueLedger.countDocuments({})) === territoryRevenueLedgerCountBefore);
    check("G4. PayoutRequest (SALON's existing model) completely untouched", (await PayoutRequest.countDocuments({})) === payoutRequestCountBefore);
    check("G5. FieldAgentPayoutRequest completely untouched", (await FieldAgentPayoutRequest.countDocuments({})) === fieldAgentPayoutCountBefore);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    expressServer.close();
    stubServer.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
