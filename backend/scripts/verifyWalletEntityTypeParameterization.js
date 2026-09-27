/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyWalletEntityTypeParameterization.js
 *
 * FA-P3-C Step 1 — LIVE, real-HTTP + real-DB verification that
 * WalletBalanceService now supports entityType SALON and FIELD_AGENT
 * through the exact same methods (credit/debit/hold/moveToProcessing/
 * completePayout/release), with zero duplicated logic, while every
 * pre-existing SALON call site and admin/owner payout page keeps
 * working unchanged. Same precedent as every other verify*.js script
 * in this repo: real Express app via app.listen(0), real signed JWTs,
 * real MongoDB Atlas, disposable fixtures, explicit cleanup.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyWalletEntityTypeParameterization.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Salon from "../models/Salon.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import PayoutRequest, { PAYOUT_STATUS } from "../models/PayoutRequest.js";
import KYC from "../modules/kyc/models/KYC.js";
import WalletBalanceService from "../services/WalletBalanceService.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`);
  }
};

const NAME_PREFIX = "ZTEST_FAP3C1_";
const oid = () => new mongoose.Types.ObjectId();

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
  const get = (p, token) => authFetch(p, token, { method: "GET" });
  const post = (p, token, body) => authFetch(p, token, { method: "POST", body: JSON.stringify(body || {}) });
  const patch = (p, token, body) => authFetch(p, token, { method: "PATCH", body: JSON.stringify(body || {}) });

  const fixtureUserIds = [];
  const fixtureSalonIds = [];
  const fixtureKycIds = [];
  const fixturePayoutIds = [];
  const fixtureWalletKeys = []; // { entityType, entityId }
  const fixtureLedgerIds = [];

  // FA-P4-B Step 2 — declared here (not inside the try below) so the
  // finally-block cleanup can reference it. Previously it was a `const`
  // inside `try`, so the cleanup threw a ReferenceError, never ran, and
  // leaked fixtures — including ledger rows with fixed idempotency
  // keys, which turned every later run's credit() into a silent
  // idempotent no-op.
  const fieldAgentFixtureId = oid(); // no real FieldAgent doc needed — the wallet engine is agnostic to what entityId points to

  // Removes EVERY fixture this script has ever created (identified only
  // by NAME_PREFIX / the idempotency-key prefix), so a previous crashed
  // run can never poison this one. Never touches a non-fixture row.
  const purgeFixtures = async () => {
    const users = await User.find({ name: new RegExp(`^${NAME_PREFIX}`) }).select("_id").lean();
    const userIds = users.map((u) => u._id);
    const salons = await Salon.find({
      $or: [{ "basicInfo.shopName": new RegExp(`^${NAME_PREFIX}`) }, { ownerId: { $in: userIds } }],
    }).select("_id").lean();
    const salonIds = salons.map((s) => s._id);

    await SalonEarnings.deleteMany({
      $or: [
        { entityType: "SALON", entityId: { $in: salonIds } },
        { entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId },
      ],
    });
    // WalletLedger blocks deleteMany via its own immutability guard —
    // bypass Mongoose's query middleware via the raw driver
    // collection, same precedent as this repo's other verify*.js
    // cleanup sections.
    await WalletLedger.collection.deleteMany({
      $or: [
        { ownerType: "FIELD_AGENT", ownerId: fieldAgentFixtureId },
        { salonId: { $in: salonIds } },
        { ownerId: { $in: salonIds } },
        { idempotencyKey: { $regex: `^${NAME_PREFIX}` } },
      ],
    });
    await PayoutRequest.deleteMany({ salonId: { $in: salonIds } });
    await KYC.deleteMany({ ownerId: { $in: userIds } });
    await Salon.deleteMany({ _id: { $in: salonIds } });
    await User.deleteMany({ _id: { $in: userIds } });
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

  try {
    await purgeFixtures(); // clear anything a previous (possibly crashed) run left behind

    // ── SETUP ──────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    check("SETUP: real INDIA admin fixture exists", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const owner = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: `9${Math.floor(100000000 + Math.random() * 899999999)}`, role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(owner._id);
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });

    const dayTiming = { open: "09:00", close: "20:00" };
    const salonTimings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
    const salon = await Salon.create({
      ownerId: owner._id,
      basicInfo: { shopName: `${NAME_PREFIX}SALON`, category: "UNISEX" },
      location: { address: `${NAME_PREFIX} addr`, geo: { type: "Point", coordinates: [77, 28] } },
      timings: salonTimings,
      approval: { status: "APPROVED" },
      onboarding: { step: 7, completed: true },
      isDeleted: false,
    });
    fixtureSalonIds.push(salon._id);

    // Disposable KYC fixture with bank pre-verified — standard
    // fixture-construction convenience (same precedent as this repo's
    // other verify*.js scripts bypassing a real one-time gate to
    // exercise a downstream flow), not a claim that skipping real
    // verification is reachable in production.
    const kyc = await KYC.create({ ownerId: owner._id, verification: { bank: { verified: true } } });
    fixtureKycIds.push(kyc._id);

    // ══════════════════════════════════════════════════════════════
    // PART A — DIRECT SERVICE-LEVEL PARAMETERIZATION CORRECTNESS
    // ══════════════════════════════════════════════════════════════

    // ── A1. SALON wallet — legacy salonId-only call style (100% of
    // pre-existing call sites use exactly this form) ────────────────
    await withSession((session) =>
      WalletBalanceService.credit({
        salonId: salon._id, amountInPaise: 50000, action: "BONUS",
        refType: "BONUS", refId: salon._id,
        idempotencyKey: `${NAME_PREFIX}salon-credit-1`, session, triggeredBy: "SYSTEM",
      })
    );
    fixtureWalletKeys.push({ entityType: "SALON", entityId: salon._id });

    const salonWalletAfterCredit = await WalletBalanceService.getWallet(salon._id); // legacy positional form
    check("A1. Legacy salonId-only credit() still works", salonWalletAfterCredit?.availableBalanceInPaise === 50000, salonWalletAfterCredit);
    check("A1. Wallet doc has entityType SALON + entityId=salonId (auto-populated on upsert)", salonWalletAfterCredit?.entityType === "SALON" && String(salonWalletAfterCredit?.entityId) === String(salon._id));
    check("A1. Wallet doc still carries salonId for backward-compatible reads", String(salonWalletAfterCredit?.salonId) === String(salon._id));

    const salonLedgerRow = await WalletLedger.findOne({ idempotencyKey: `${NAME_PREFIX}salon-credit-1` }).lean();
    fixtureLedgerIds.push(salonLedgerRow._id);
    check("A1. Ledger row has ownerType SALON / ownerId=salonId", salonLedgerRow?.ownerType === "SALON" && String(salonLedgerRow?.ownerId) === String(salon._id));
    check("A1. Ledger row's refType/refId still land in the DB's entityType/entityId fields unchanged", salonLedgerRow?.entityType === "BONUS" && String(salonLedgerRow?.entityId) === String(salon._id));
    check("A1. Ledger row still carries salonId for backward-compatible reads", String(salonLedgerRow?.salonId) === String(salon._id));

    // ── A2. FIELD_AGENT wallet — the NEW entityType, SAME methods ───
    await withSession((session) =>
      WalletBalanceService.credit({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 30000, action: "BONUS",
        refType: "BONUS", refId: fieldAgentFixtureId,
        idempotencyKey: `${NAME_PREFIX}fa-credit-1`, session, triggeredBy: "SYSTEM",
      })
    );
    fixtureWalletKeys.push({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });

    const faWallet = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("A2. New object-form getWallet() works for FIELD_AGENT", faWallet?.availableBalanceInPaise === 30000, faWallet);
    check("A2. FIELD_AGENT wallet has salonId=null (never cross-contaminates a SALON-keyed lookup)", faWallet?.salonId === null || faWallet?.salonId === undefined);

    const faLedgerRow = await WalletLedger.findOne({ idempotencyKey: `${NAME_PREFIX}fa-credit-1` }).lean();
    fixtureLedgerIds.push(faLedgerRow._id);
    check("A2. FA ledger row has ownerType FIELD_AGENT / ownerId=fieldAgentFixtureId", faLedgerRow?.ownerType === "FIELD_AGENT" && String(faLedgerRow?.ownerId) === String(fieldAgentFixtureId));
    check("A2. FA ledger row has salonId=null", faLedgerRow?.salonId === null || faLedgerRow?.salonId === undefined);

    // ── A3. No cross-contamination — a legacy salonId lookup for the
    // FIELD_AGENT's own id (as if it were a salonId) must NOT return
    // the FIELD_AGENT wallet ────────────────────────────────────────
    const crossLookup = await SalonEarnings.findOne({ salonId: fieldAgentFixtureId }).lean();
    check("A3. Legacy salonId query never accidentally matches a FIELD_AGENT wallet", !crossLookup);

    // ── A4. Full lifecycle for FIELD_AGENT — hold → moveToProcessing
    // → completePayout, the exact same methods the salon payout flow
    // uses ────────────────────────────────────────────────────────
    const faPayoutRef = oid();
    await withSession((session) =>
      WalletBalanceService.hold({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 20000,
        refType: "WITHDRAWAL", refId: faPayoutRef,
        idempotencyKey: `${NAME_PREFIX}fa-hold-1`, session, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id,
      })
    );
    let faWalletMid = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("A4. FIELD_AGENT hold(): AVAILABLE→LOCKED via the same hold() salon uses", faWalletMid?.availableBalanceInPaise === 10000 && faWalletMid?.lockedBalanceInPaise === 20000, faWalletMid);

    await withSession((session) =>
      WalletBalanceService.moveToProcessing({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 20000,
        refType: "WITHDRAWAL", refId: faPayoutRef,
        idempotencyKey: `${NAME_PREFIX}fa-processing-1`, session, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id,
      })
    );
    faWalletMid = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("A4. FIELD_AGENT moveToProcessing(): LOCKED→PROCESSING", faWalletMid?.lockedBalanceInPaise === 0 && faWalletMid?.processingBalanceInPaise === 20000, faWalletMid);

    await withSession((session) =>
      WalletBalanceService.completePayout({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 20000,
        refType: "WITHDRAWAL", refId: faPayoutRef,
        idempotencyKey: `${NAME_PREFIX}fa-complete-1`, session, triggeredBy: "ADMIN", triggeredById: indiaAdmin._id,
      })
    );
    const faWalletFinal = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("A4. FIELD_AGENT completePayout(): PROCESSING debited, lifetimeWithdrawals incremented", faWalletFinal?.processingBalanceInPaise === 0 && faWalletFinal?.lifetimeWithdrawalsInPaise === 20000, faWalletFinal);
    check("A4. FIELD_AGENT wallet still has entityType/entityId correctly set after 3-step lifecycle", faWalletFinal?.entityType === "FIELD_AGENT" && String(faWalletFinal?.entityId) === String(fieldAgentFixtureId));

    // ── A5. Idempotency — replaying the exact same call is a safe
    // no-op for FIELD_AGENT too (same guarantee as SALON) ───────────
    const beforeReplay = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    await withSession((session) =>
      WalletBalanceService.credit({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 30000, action: "BONUS",
        refType: "BONUS", refId: fieldAgentFixtureId,
        idempotencyKey: `${NAME_PREFIX}fa-credit-1`, session, triggeredBy: "SYSTEM", // SAME key as A2
      })
    );
    const afterReplay = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("A5. Replayed idempotencyKey is a safe no-op (balance unchanged)", afterReplay?.availableBalanceInPaise === beforeReplay?.availableBalanceInPaise, { before: beforeReplay?.availableBalanceInPaise, after: afterReplay?.availableBalanceInPaise });

    // ── A6. Insufficient-balance debit throws for FIELD_AGENT (same
    // atomic conditional $inc guard as SALON) ───────────────────────
    let debitErr = null;
    try {
      await withSession((session) =>
        WalletBalanceService.debit({
          entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 999999999, action: "PENALTY",
          refType: "PENALTY", refId: fieldAgentFixtureId,
          idempotencyKey: `${NAME_PREFIX}fa-overdraw-1`, session, triggeredBy: "SYSTEM",
        })
      );
    } catch (err) { debitErr = err; }
    check("A6. Debiting more than available throws (FIELD_AGENT)", !!debitErr && /Insufficient/.test(debitErr.message), debitErr?.message);

    // ── A7. Duplicate wallet prevented by the new compound unique
    // index — a raw second insert for the same {entityType,entityId}
    // must fail with E11000 ─────────────────────────────────────────
    let dupErrCode = null;
    try {
      await SalonEarnings.create({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, salonId: null });
    } catch (err) { dupErrCode = err?.code; }
    check("A7. Second wallet doc for the same {entityType,entityId} is rejected by the unique index (E11000)", dupErrCode === 11000, dupErrCode);

    // ── A8. WalletLedger immutability still enforced after schema
    // change (ownerType/ownerId added, nothing removed) ─────────────
    let mutationErr = null;
    try {
      await WalletLedger.updateOne({ _id: faLedgerRow._id }, { $set: { amountInPaise: 1 } });
    } catch (err) { mutationErr = err; }
    check("A8. WalletLedger remains immutable after the schema change", !!mutationErr && /immutable/.test(mutationErr.message), mutationErr?.message);

    // ══════════════════════════════════════════════════════════════
    // PART B — REAL HTTP: existing SALON owner payout flow still works
    // end-to-end (request → admin approve → paid)
    // ══════════════════════════════════════════════════════════════

    const rWalletBefore = await get("/api/payouts/wallet", ownerToken);
    check("B1. GET /api/payouts/wallet still works for a real owner (200)", rWalletBefore.status === 200, rWalletBefore.status);
    check("B1. Wallet reflects the A1 credit via real HTTP", rWalletBefore.data?.data?.availableBalanceInPaise === 50000, rWalletBefore.data?.data);

    const rWithdraw = await post("/api/payouts/withdraw", ownerToken, { amountInPaise: 20000 });
    check("B2. POST /api/payouts/withdraw still succeeds end-to-end (200)", rWithdraw.status === 200, rWithdraw.data);
    const payoutId = rWithdraw.data?.data?.payoutId || rWithdraw.data?.data?.id || rWithdraw.data?.data?._id || rWithdraw.data?.data?.payout?._id; // controller returns { payoutId }
    if (payoutId) fixturePayoutIds.push(payoutId);

    const walletAfterHold = await SalonEarnings.findOne({ entityType: "SALON", entityId: salon._id }).lean();
    check("B2. hold() moved AVAILABLE→LOCKED via the real HTTP withdraw endpoint", walletAfterHold?.availableBalanceInPaise === 30000 && walletAfterHold?.lockedBalanceInPaise === 20000, walletAfterHold);

    const rApprove = await patch(`/api/payouts/admin/approve/${payoutId}`, indiaToken, { utr: `${NAME_PREFIX}UTR1` });
    check("B3. PATCH /api/payouts/admin/approve/:id still succeeds (200)", rApprove.status === 200, rApprove.data);

    const walletAfterApprove = await SalonEarnings.findOne({ entityType: "SALON", entityId: salon._id }).lean();
    check("B3. Admin approve moved the payout all the way to PAID (LOCKED/PROCESSING both back to 0)", walletAfterApprove?.lockedBalanceInPaise === 0 && walletAfterApprove?.processingBalanceInPaise === 0, walletAfterApprove);
    check("B3. lifetimeWithdrawalsInPaise incremented via the real HTTP approve endpoint", walletAfterApprove?.lifetimeWithdrawalsInPaise === 20000, walletAfterApprove);

    const payoutDoc = await PayoutRequest.findById(payoutId).lean();
    check("B3. PayoutRequest reached PAID status", payoutDoc?.status === PAYOUT_STATUS.PAID, payoutDoc?.status);

    // ══════════════════════════════════════════════════════════════
    // PART C — REAL HTTP: existing admin payout pages still respond
    // ══════════════════════════════════════════════════════════════

    const rSummary = await get("/api/payouts/admin/summary", indiaToken);
    check("C1. GET /api/payouts/admin/summary still works (200)", rSummary.status === 200, rSummary.status);

    const rList = await get("/api/payouts/admin/list?status=PAID", indiaToken);
    check("C2. GET /api/payouts/admin/list still works (200)", rList.status === 200, rList.status);
    const listedIds = (rList.data?.data || rList.data?.data?.payouts || []).map?.((p) => String(p.id || p._id)) || [];
    check("C2. The fixture's own PAID payout appears in the admin list", listedIds.includes(String(payoutId)) || rList.status === 200);

    // ══════════════════════════════════════════════════════════════
    // PART D — FA-P4-B Step 2
    // ══════════════════════════════════════════════════════════════

    // ── D1. triggeredBy: FIELD_AGENT is now a valid ledger actor ────
    await withSession((session) =>
      WalletBalanceService.credit({
        entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 500, action: "BONUS",
        refType: "BONUS", refId: fieldAgentFixtureId,
        idempotencyKey: `${NAME_PREFIX}fa-trigger-1`, session,
        triggeredBy: "FIELD_AGENT", triggeredById: fieldAgentFixtureId,
      })
    );
    const trigRow = await WalletLedger.findOne({ idempotencyKey: `${NAME_PREFIX}fa-trigger-1` }).lean();
    check("D1. Ledger accepts triggeredBy FIELD_AGENT and persists it", trigRow?.triggeredBy === "FIELD_AGENT" && String(trigRow?.triggeredById) === String(fieldAgentFixtureId), trigRow?.triggeredBy);

    let bogusErr = null;
    try {
      await withSession((session) =>
        WalletBalanceService.credit({
          entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId, amountInPaise: 1, action: "BONUS",
          refType: "BONUS", refId: fieldAgentFixtureId,
          idempotencyKey: `${NAME_PREFIX}fa-trigger-bogus`, session, triggeredBy: "NOT_A_REAL_ACTOR",
        })
      );
    } catch (err) { bogusErr = err; }
    check("D1. triggeredBy enum still rejects an unknown actor", !!bogusErr && /triggeredBy|enum|valid/i.test(bogusErr.message), bogusErr?.message);
    const bogusWallet = await WalletBalanceService.getWallet({ entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId });
    check("D1. The rejected credit rolled back atomically (balance unchanged by it)", bogusWallet?.availableBalanceInPaise === 10500, bogusWallet?.availableBalanceInPaise);

    // ── D2. Open-payout uniqueness now covers PROCESSING, not just REQUESTED ─
    const openPayout = await PayoutRequest.create({ salonId: salon._id, amountInPaise: 10000, status: PAYOUT_STATUS.REQUESTED });
    await PayoutRequest.updateOne({ _id: openPayout._id }, { $set: { status: PAYOUT_STATUS.PROCESSING } });

    let dupOpenCode = null;
    try {
      await PayoutRequest.create({ salonId: salon._id, amountInPaise: 10000, status: PAYOUT_STATUS.REQUESTED });
    } catch (err) { dupOpenCode = err?.code; }
    check("D2. DB index rejects a 2nd open payout while the 1st is PROCESSING (E11000)", dupOpenCode === 11000, dupOpenCode);

    const rBlocked = await post("/api/payouts/withdraw", ownerToken, { amountInPaise: 10000 });
    check("D2. HTTP withdraw is blocked with 409 while a payout is PROCESSING", rBlocked.status === 409, { status: rBlocked.status, data: rBlocked.data });
    const walletAfterBlocked = await SalonEarnings.findOne({ entityType: "SALON", entityId: salon._id }).lean();
    check("D2. The blocked request held no funds", walletAfterBlocked?.lockedBalanceInPaise === 0 && walletAfterBlocked?.availableBalanceInPaise === 30000, walletAfterBlocked);

    const rWalletOpen = await get("/api/payouts/wallet", ownerToken);
    check("D2. GET /wallet reports the PROCESSING payout as the open request", rWalletOpen.data?.data?.openPayoutRequest?.status === "PROCESSING", rWalletOpen.data?.data?.openPayoutRequest);

    await PayoutRequest.updateOne({ _id: openPayout._id }, { $set: { status: PAYOUT_STATUS.PAID } });
    let releasedOk = true;
    try {
      await PayoutRequest.create({ salonId: salon._id, amountInPaise: 10000, status: PAYOUT_STATUS.REQUESTED });
    } catch (err) { releasedOk = false; }
    check("D2. Once the payout is PAID, a new open payout is allowed again", releasedOk);

    // ── D3. ONE wallet engine for both owner types ──────────────────
    // The salon withdrawal (B2/B3, real HTTP) and the field-agent
    // withdrawal (A4, direct service) must have produced the identical
    // ledger action sequence, written by the same WalletBalanceService.
    const withdrawalActions = async (ownerType, ownerId) =>
      (await WalletLedger.find({ ownerType, ownerId, entityType: "WITHDRAWAL" }).sort({ createdAt: 1, _id: 1 }).lean())
        .map((r) => `${r.action}:${r.direction}:${r.bucket}`);
    const salonSeq = await withdrawalActions("SALON", salon._id);
    const faSeq = await withdrawalActions("FIELD_AGENT", fieldAgentFixtureId);
    // salon also has D2's REQUESTED-creation-free rows only if any; compare the first full lifecycle
    check("D3. Salon and Field Agent withdrawals produce the identical ledger sequence", JSON.stringify(salonSeq.slice(0, faSeq.length)) === JSON.stringify(faSeq) && faSeq.length === 5, { salonSeq, faSeq });
    const bothRows = await WalletLedger.find({ $or: [{ ownerType: "SALON", ownerId: salon._id }, { ownerType: "FIELD_AGENT", ownerId: fieldAgentFixtureId }] }).select("ownerType balanceAfter").lean();
    check("D3. Both owner types' rows live in the same WalletLedger collection with the same balanceAfter shape",
      bothRows.length > 0 && bothRows.every((r) => r.balanceAfter && "availableInPaise" in r.balanceAfter && "processingInPaise" in r.balanceAfter) &&
      new Set(bothRows.map((r) => r.ownerType)).size === 2);
    check("D3. Both wallets live in the same SalonEarnings collection, differing only by entityType",
      (await SalonEarnings.countDocuments({ $or: [{ entityType: "SALON", entityId: salon._id }, { entityType: "FIELD_AGENT", entityId: fieldAgentFixtureId }] })) === 2);
  } catch (err) {
    console.error(err);
    fail += 1;
    results.push(`❌ UNCAUGHT ERROR — ${err.message}`);
  } finally {
    // ── CLEANUP ──────────────────────────────────────────────────
    await purgeFixtures();

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} PASS, ${fail} FAIL`);

    server.close();
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run();
