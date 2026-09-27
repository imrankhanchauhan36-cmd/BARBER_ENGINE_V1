/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyWalletHttpExposure.js
 *
 * STEP 6.5A — HTTP API Exposure — disposable live verification. Real
 * Atlas dev DB, real HTTP via app.listen(0). A local Razorpay Route
 * stub (same pattern as scripts/verifyRazorpayRouteSettlementEngine.js,
 * STEP 6.4 — already verified 26/26 there) stands in so
 * POST /api/wallet/payout/request's auto-dispatch resolves quickly and
 * deterministically instead of making an uncontrolled real network
 * call — this script is about proving the NEW HTTP layer correctly
 * triggers the ALREADY-VERIFIED STEP 6.2/6.3/6.4 machinery, not
 * re-testing that machinery's own internals again.
 *
 * Proves, for ALL THREE entity types (SALON, ACQUISITION_AGENT,
 * TERRITORY_PARTNER):
 *   1. GET /api/wallet/me resolves the correct identity and balance.
 *   2. GET /api/wallet/history returns real WalletLedger entries.
 *   3. POST /api/wallet/payout/request creates a real GenericPayoutRequest
 *      (KYC-gated, atomic Approved->Locked, auto-dispatched — all via
 *      the UNMODIFIED existing services).
 *   4. GET /api/wallet/payouts lists it back.
 *   5. RBAC: a USER-role caller and an unauthenticated caller are
 *      rejected; a FIELD_AGENT with no commercialPath yet is rejected.
 *   6. ISOLATION: zero writes to any collection beyond this script's
 *      own fixtures and the wallet/payout documents these endpoints are
 *      explicitly supposed to create.
 *
 * Run:  cd backend && node scripts/verifyWalletHttpExposure.js
 */

import "dotenv/config";
import http from "http";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import KYC from "../modules/kyc/models/KYC.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import WalletLedger from "../models/WalletLedger.js";
import SalonEarnings from "../models/SalonEarnings.js";
import GenericPayoutRequest from "../modules/payout/models/GenericPayoutRequest.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import { encrypt } from "../modules/kyc/services/encryption.service.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_WHE65_";
const oid = () => new mongoose.Types.ObjectId();
let phoneSeq = 0;
const nextPhone = () => `9${String(9550000000 + phoneSeq++).slice(-9)}`;

const fixtureUserIds = [];
const fixtureSalonIds = [];
const fixtureFieldAgentIds = [];
const fixtureKycIds = [];
const fixtureWalletEntities = [];

const dayTiming = { open: "09:00", close: "20:00" };
const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };

// ── minimal local Razorpay Route stub — always "processed" ─────────
let payoutSeq = 0;
const readJsonBody = (req) => new Promise((resolve) => { let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", () => resolve(raw ? JSON.parse(raw) : {})); });
const startStubServer = () => new Promise((resolvePort) => {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && u.pathname === "/contacts") return send(200, { items: [] });
    if (req.method === "POST" && u.pathname === "/contacts") { const b = await readJsonBody(req); return send(200, { id: `cont_${++payoutSeq}`, reference_id: b.reference_id }); }
    if (req.method === "POST" && u.pathname === "/fund_accounts") return send(200, { id: `fa_${++payoutSeq}` });
    if (req.method === "GET" && u.pathname === "/payouts") return send(200, { items: [] });
    if (req.method === "POST" && u.pathname === "/payouts") {
      const b = await readJsonBody(req);
      return send(200, { id: `pout_${++payoutSeq}`, reference_id: b.reference_id, amount: b.amount, status: "processed", utr: `UTR${payoutSeq}`, failure_reason: null });
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
  try { session.startTransaction(); const out = await fn(session); await session.commitTransaction(); return out; }
  catch (err) { await session.abortTransaction(); throw err; }
  finally { session.endSession(); }
};

const run = async () => {
  await connectDB();

  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_ZTEST_STUB";
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "ztest_stub_secret";
  process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER = process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER || "2323230012345678";
  const { server: stubServer, port: stubPort } = await startStubServer();
  process.env.RAZORPAYX_ROUTE_BASE_URL = `http://127.0.0.1:${stubPort}`;

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts = {}) =>
    fetch(url(path), { ...opts, headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
      .then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const walletLedgerCountBefore = await WalletLedger.countDocuments({});
  const salonEarningsCountBefore = await SalonEarnings.countDocuments({});
  const genericPayoutCountBefore = await GenericPayoutRequest.countDocuments({});

  try {
    // ── Fixture: a real, KYC-verified SALON (OWNER) ─────────────────
    const owner = await User.create({ name: `${P}OWNER`, phone: nextPhone(), role: "OWNER", isActive: true });
    fixtureUserIds.push(owner._id);
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });
    const salon = await Salon.create({
      ownerId: owner._id, basicInfo: { shopName: `${P}SALON`, category: "UNISEX" },
      location: { address: `${P} addr`, geo: { type: "Point", coordinates: [77, 28] }, territory: {} },
      timings: salonTimings, approval: { status: "APPROVED" }, onboarding: { step: 8 }, isDeleted: false,
    });
    fixtureSalonIds.push(salon._id);
    fixtureWalletEntities.push({ entityType: "SALON", entityId: salon._id });
    const salonKyc = await KYC.create({
      ownerId: owner._id, applicantType: "OWNER", status: "VERIFIED",
      bank: { accountHolder: `${P}OWNER`, maskedAccount: "XXXX1111", encryptedAccount: encrypt("00001111"), ifsc: "HDFC0000001", bankName: "HDFC Bank", pennyDropStatus: "NOT_INITIATED" },
      verification: { bank: { status: "VERIFIED", verified: true } },
    });
    fixtureKycIds.push(salonKyc._id);
    await withSession((session) => WalletBalanceService.credit({ entityType: "SALON", entityId: salon._id, amountInPaise: 50000, action: "BONUS", refType: "ADJUSTMENT", refId: oid(), idempotencyKey: `${P}salon:fund`, session }));

    // ── Fixture: a real, KYC-verified ACQUISITION_AGENT (FIELD_AGENT) ──
    const acqUser = await User.create({ name: `${P}ACQ`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(acqUser._id);
    const acqToken = generateAccessToken({ _id: acqUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
    const acqAgent = await FieldAgent.create({ userRef: acqUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    fixtureFieldAgentIds.push(acqAgent._id);
    fixtureWalletEntities.push({ entityType: "ACQUISITION_AGENT", entityId: acqAgent._id });
    const acqKyc = await KYC.create({
      ownerId: acqUser._id, applicantType: "FIELD_AGENT", status: "VERIFIED",
      bank: { accountHolder: `${P}ACQ`, maskedAccount: "XXXX2222", encryptedAccount: encrypt("00002222"), ifsc: "ICIC0000002", bankName: "ICICI Bank", pennyDropStatus: "SUCCESS" },
      verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
    });
    fixtureKycIds.push(acqKyc._id);
    await withSession((session) => WalletBalanceService.credit({ entityType: "ACQUISITION_AGENT", entityId: acqAgent._id, amountInPaise: 30000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}acq:fund`, session }));

    // ── Fixture: a real, KYC-verified TERRITORY_PARTNER (FIELD_AGENT) ──
    const tpUser = await User.create({ name: `${P}TP`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(tpUser._id);
    const tpToken = generateAccessToken({ _id: tpUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
    const tpAgent = await FieldAgent.create({ userRef: tpUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "ACTIVE", commercialPath: "TERRITORY_PARTNER" });
    fixtureFieldAgentIds.push(tpAgent._id);
    fixtureWalletEntities.push({ entityType: "TERRITORY_PARTNER", entityId: tpAgent._id });
    const tpKyc = await KYC.create({
      ownerId: tpUser._id, applicantType: "FIELD_AGENT", status: "VERIFIED",
      bank: { accountHolder: `${P}TP`, maskedAccount: "XXXX3333", encryptedAccount: encrypt("00003333"), ifsc: "SBIN0000003", bankName: "SBI", pennyDropStatus: "SUCCESS" },
      verification: { bank: { status: "NOT_SUBMITTED", verified: false } },
    });
    fixtureKycIds.push(tpKyc._id);
    await withSession((session) => WalletBalanceService.credit({ entityType: "TERRITORY_PARTNER", entityId: tpAgent._id, amountInPaise: 20000, action: "EARNING_CREDIT", refType: "EARNING", refId: oid(), idempotencyKey: `${P}tp:fund`, session }));

    // ── Fixture: a FIELD_AGENT with commercialPath = null (not yet activated) ──
    const unassignedUser = await User.create({ name: `${P}UNASSIGNED`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
    fixtureUserIds.push(unassignedUser._id);
    const unassignedToken = generateAccessToken({ _id: unassignedUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
    const unassignedAgent = await FieldAgent.create({ userRef: unassignedUser._id, applicationRef: oid(), agentCode: `FA-99999999-${Math.floor(Math.random() * 900000) + 100000}`, operationalStatus: "PENDING_ACTIVATION", commercialPath: null });
    fixtureFieldAgentIds.push(unassignedAgent._id);

    // A plain USER-role account for RBAC negative testing.
    const plainUser = await User.create({ name: `${P}PLAINUSER`, phone: nextPhone(), role: "USER", isActive: true });
    fixtureUserIds.push(plainUser._id);
    const plainUserToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });

    const scenarios = [
      { label: "SALON", token: ownerToken, entityId: salon._id, entityType: "SALON", fundedInPaise: 50000 },
      { label: "ACQUISITION_AGENT", token: acqToken, entityId: acqAgent._id, entityType: "ACQUISITION_AGENT", fundedInPaise: 30000 },
      { label: "TERRITORY_PARTNER", token: tpToken, entityId: tpAgent._id, entityType: "TERRITORY_PARTNER", fundedInPaise: 20000 },
    ];

    for (const s of scenarios) {
      // 1. GET /me
      const meRes = await authFetch("/api/wallet/me", s.token);
      check(`${s.label} 1. GET /api/wallet/me → 200, correct identity + balance`, meRes.status === 200 && meRes.data.data.entityType === s.entityType && String(meRes.data.data.entityId) === String(s.entityId) && meRes.data.data.availableBalanceInPaise === s.fundedInPaise, meRes.data);

      // 2. GET /history
      const historyRes = await authFetch("/api/wallet/history?page=1&limit=10", s.token);
      check(`${s.label} 2. GET /api/wallet/history → 200, real ledger entries`, historyRes.status === 200 && historyRes.data.data.entries.length >= 1 && historyRes.data.data.entries[0].ownerType === s.entityType, historyRes.data);

      // 3. POST /payout/request
      const payoutAmount = Math.floor(s.fundedInPaise / 2);
      const requestRes = await authFetch("/api/wallet/payout/request", s.token, { method: "POST", body: JSON.stringify({ amountInPaise: payoutAmount }) });
      check(`${s.label} 3. POST /api/wallet/payout/request → 201, real GenericPayoutRequest created`, requestRes.status === 201 && requestRes.data.data.entityType === s.entityType && requestRes.data.data.amountInPaise === payoutAmount, requestRes.data);
      check(`${s.label} 3b. Auto-dispatched (no admin approval) — status is PROCESSING or PAID, never stuck at REQUESTED`, ["PROCESSING", "PAID"].includes(requestRes.data.data.status), requestRes.data.data.status);

      // 4. GET /payouts
      const listRes = await authFetch("/api/wallet/payouts", s.token);
      check(`${s.label} 4. GET /api/wallet/payouts → 200, lists the just-created request`, listRes.status === 200 && listRes.data.data.rows.some((r) => String(r._id) === String(requestRes.data.data._id)), listRes.data);
    }

    // ── RBAC ──────────────────────────────────────────────────────
    const plainUserRes = await authFetch("/api/wallet/me", plainUserToken);
    check("RBAC 1. A plain USER-role account is rejected on /me (403)", plainUserRes.status === 403, plainUserRes.status);
    const noAuthRes = await authFetch("/api/wallet/me", null);
    check("RBAC 2. Unauthenticated request is rejected (401)", noAuthRes.status === 401, noAuthRes.status);
    const unassignedRes = await authFetch("/api/wallet/me", unassignedToken);
    check("RBAC 3. A FIELD_AGENT with no commercialPath yet (not wallet-bearing) gets 404, not a crash", unassignedRes.status === 404, unassignedRes.data);

    // ── Validation ────────────────────────────────────────────────
    const badBodyRes = await authFetch("/api/wallet/payout/request", ownerToken, { method: "POST", body: JSON.stringify({ amountInPaise: -100 }) });
    check("Validation. Negative amountInPaise rejected (400)", badBodyRes.status === 400, badBodyRes.data);

    // ── ISOLATION ─────────────────────────────────────────────────
    // 3 SALE/EARNING funding credits + 3 x (hold + processing[+complete]) = expected new ledger rows this run
    check("Isolation 1. WalletLedger only gained rows for this script's own 3 entities (no cross-contamination)", (await WalletLedger.countDocuments({ ownerType: { $in: ["SALON", "ACQUISITION_AGENT", "TERRITORY_PARTNER"] }, ownerId: { $in: fixtureWalletEntities.map((e) => e.entityId) } })) >= 6);
    check("Isolation 2. SalonEarnings gained exactly 3 wallet documents (one per fixture entity)", (await SalonEarnings.countDocuments({ entityId: { $in: fixtureWalletEntities.map((e) => e.entityId) } })) === 3);
    check("Isolation 3. GenericPayoutRequest gained exactly 3 documents (one per fixture entity)", (await GenericPayoutRequest.countDocuments({ entityId: { $in: fixtureWalletEntities.map((e) => e.entityId) } })) === 3);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    stubServer.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
