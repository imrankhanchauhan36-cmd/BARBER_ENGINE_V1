/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyPayoutSalonAmbiguity.mjs
 *
 * Payout module — multi-salon ambiguity fixes (Parts C + D of the
 * approved implementation scope). Real HTTP-level integration test
 * against a fully isolated stack: a disposable mongodb-memory-server
 * replica set, a real Express server bound to an OS-assigned local
 * port (app.listen(0)), a locally-generated test-only JWT secret, and
 * Redis left intentionally disconnected (SKIP_REDIS_AUTOCONNECT) —
 * none of the payout routes run behind the idempotency middleware.
 *
 * PART C — controllers/payout.controller.js#cancelWithdrawal used to
 * resolve the caller's salon via an unscoped Salon.findOne({ownerId})
 * BEFORE fetching the payout, then filtered the payout lookup by
 * whichever salon that returned. For an owner with 2+ real salons,
 * this could false-negative (404) an owner cancelling their own real
 * withdrawal if the unscoped lookup picked their OTHER salon. Fixed:
 * fetch the payout by _id FIRST (its own salonId is authoritative),
 * then verify ownership against THAT salon — same shape as the
 * already-fixed ownerCancelBooking.
 *
 * PART D — getWallet/requestWithdrawal/getPayoutHistory/getLedger all
 * used the same unscoped Salon.findOne({ownerId}) with no
 * disambiguation at all — for getWallet/getPayoutHistory/getLedger
 * this could show an owner the WRONG salon's financial data; for
 * requestWithdrawal it could actually HOLD FUNDS against the wrong
 * salon's wallet. Fixed: resolveOwnerSalonOrThrow fails closed with
 * 409 AMBIGUOUS_SALON for an owner with 2+ real salons, exactly
 * preserving today's behavior for 0 or 1.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyPayoutSalonAmbiguity.mjs
 */

import crypto from "crypto";
import net from "net";
import http from "http";

const TEST_JWT_SECRET = crypto.randomBytes(32).toString("hex");
if (!TEST_JWT_SECRET || TEST_JWT_SECRET.length < 32) {
  throw new Error("FAIL-CLOSED: could not generate a test-only JWT secret — refusing to proceed.");
}
process.env.JWT_ACCESS_SECRET = TEST_JWT_SECRET;
delete process.env.JWT_SECRET;

process.env.SKIP_REDIS_AUTOCONNECT = "true";
delete process.env.REDIS_URL;

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);
let networkGuardInstalled = false;
let blockedAttempts = [];

const installNetworkGuard = () => {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let host = null;
    if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].host ?? args[0].address ?? null;
    } else if (typeof args[1] === "string") {
      host = args[1];
    }
    const isLoopback = host === null || LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
    if (!isLoopback) {
      blockedAttempts.push(host);
      throw new Error(`NETWORK GUARD: blocked outbound connection attempt to non-loopback host "${host}"`);
    }
    return originalConnect.apply(this, args);
  };
  networkGuardInstalled = true;
};

const run = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const mongoose = (await import("mongoose")).default;

  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  let httpServer = null;

  try {
    await mongoose.connect(mem.getUri(), { dbName: "payout_salon_ambiguity" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const app = (await import("../../app.js")).default;
    const User = (await import("../../models/User.js")).default;
    const Salon = (await import("../../models/Salon.js")).default;
    const PayoutRequest = (await import("../../models/PayoutRequest.js")).default;
    const WalletLedger = (await import("../../models/WalletLedger.js")).default;
    const KYC = (await import("../../modules/kyc/models/KYC.js")).default;
    const WalletBalanceService = (await import("../../services/WalletBalanceService.js")).default;
    const { generateAccessToken } = await import("../../services/token.service.js");

    // TEST-ONLY lock-contention fix — same root cause/fix already
    // validated for Salon (onboarding test) and KYC (KYC ambiguity
    // test): Mongoose's autoIndex builds a model's indexes
    // asynchronously, unawaited, on first use. This script's fixture
    // helpers hit Salon/PayoutRequest/WalletLedger with back-to-back
    // transactions almost immediately, so all three are warmed here
    // first. Confirmed none of the three has the invalid-syntax index
    // defect found in Staff.js/Chair.js.
    await Promise.all([Salon.createIndexes(), PayoutRequest.createIndexes(), WalletLedger.createIndexes()]);

    httpServer = app.listen(0);
    const port = await new Promise((resolve) => httpServer.on("listening", () => resolve(httpServer.address().port)));

    const authFetch = (path, token, opts = {}) =>
      new Promise((resolve, reject) => {
        const headers = {
          "Content-Type": "application/json",
          ...(token !== null ? { Authorization: `Bearer ${token}` } : {}),
          ...(opts.headers || {}),
        };
        const req = http.request(
          { host: "127.0.0.1", port, path, method: opts.method || "GET", headers },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
              const raw = Buffer.concat(chunks).toString("utf8");
              resolve({ status: res.statusCode, json: async () => (raw ? JSON.parse(raw) : {}) });
            });
          }
        );
        req.on("error", reject);
        if (opts.body !== undefined) req.write(opts.body);
        req.end();
      });

    let phoneCounter = 0;
    const nextPhone = () => `9${String(100000000 + Math.floor(Math.random() * 800000000) + phoneCounter++)}`.slice(0, 10);

    const OPEN_ALL_DAY = { open: "00:00", close: "23:59", isClosed: false };
    const ALL_DAYS_OPEN = { monday: OPEN_ALL_DAY, tuesday: OPEN_ALL_DAY, wednesday: OPEN_ALL_DAY, thursday: OPEN_ALL_DAY, friday: OPEN_ALL_DAY, saturday: OPEN_ALL_DAY, sunday: OPEN_ALL_DAY };

    const makeSalon = (ownerId, label, isDeleted = false) =>
      Salon.create({
        ownerId,
        basicInfo: { shopName: `ZE2E Payout Salon ${label}`, category: "UNISEX" },
        manager: { phone: nextPhone() },
        timings: ALL_DAYS_OPEN,
        approval: { status: "APPROVED" },
        business: { isForceClosed: false, isShopOpen: true },
        onboarding: { step: 8, completed: true },
        isDeleted,
      });

    const makeOwner = (label) => User.create({ name: `ZE2E_PAYOUT_OWNER_${label}`, phone: nextPhone(), role: "OWNER", accountStatus: "ACTIVE" });
    const tokenFor = (owner) => generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: owner.tokenVersion ?? 0 });

    // Bank-verified KYC — required by requestWithdrawal's own gate.
    const makeBankVerifiedKyc = (ownerId) =>
      KYC.create({ ownerId, applicantType: "OWNER", status: "VERIFIED", verification: { bank: { status: "VERIFIED", verified: true, verifiedAt: new Date() } } });

    // Credits a salon's AVAILABLE wallet balance directly (bypassing
    // booking settlement, which is out of scope here) — same
    // WalletBalanceService.credit() shape used in other scripts'
    // own fixtures this session.
    const creditAvailable = async (salonId, amountInPaise) => {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await WalletBalanceService.credit({
            salonId, amountInPaise, action: "BONUS", refType: "ADJUSTMENT",
            refId: new mongoose.Types.ObjectId(),
            idempotencyKey: `ze2e:credit:${salonId}:${Date.now()}:${Math.random()}`,
            session, triggeredBy: "SYSTEM", remarks: "ZE2E fixture — pre-fund AVAILABLE balance",
          });
        });
      } finally {
        session.endSession();
      }
    };

    // Simulates exactly what requestWithdrawal itself does (credit ->
    // create PayoutRequest -> hold), bypassing the HTTP endpoint only
    // because the endpoint itself cannot target a specific salon for
    // a multi-salon owner (that is the exact ambiguity under test).
    const makeLockedPayout = async (salon, amountInPaise) => {
      await creditAvailable(salon._id, amountInPaise);
      const session = await mongoose.startSession();
      try {
        let payout;
        await session.withTransaction(async () => {
          [payout] = await PayoutRequest.create([{ salonId: salon._id, amountInPaise, status: "REQUESTED" }], { session });
          await WalletBalanceService.hold({
            salonId: salon._id, amountInPaise, refType: "WITHDRAWAL", refId: payout._id,
            idempotencyKey: `ze2e:hold:${payout._id}`, session, triggeredBy: "SYSTEM",
            remarks: "ZE2E fixture — simulated real withdrawal request",
          });
        });
        return payout;
      } finally {
        session.endSession();
      }
    };

    //////////////////////////////////////////////////////////////
    // PART C — cancelWithdrawal authoritative-record scoping
    //////////////////////////////////////////////////////////////

    const cancelOwner = await makeOwner("CANCEL");
    const cancelOwnerToken = tokenFor(cancelOwner);
    const cancelSalonA = await makeSalon(cancelOwner._id, "CANCEL_A");
    const cancelSalonB = await makeSalon(cancelOwner._id, "CANCEL_B");

    // 1. Owner cancels a payout belonging to Salon B (the SECOND of
    //    their two salons — the one the OLD unscoped-ownerId lookup
    //    was least likely to pick first).
    const payoutB = await makeLockedPayout(cancelSalonB, 50000);
    const cancelAttemptB = await authFetch(`/api/payouts/cancel/${payoutB._id}`, cancelOwnerToken, { method: "POST" });
    const cancelAttemptBBody = await cancelAttemptB.json();
    check("C1. Owner cancels their own payout on Salon B (2nd of 2 salons) → 200", cancelAttemptB.status === 200 && cancelAttemptBBody?.data?.status === "CANCELLED", { status: cancelAttemptB.status, body: cancelAttemptBBody });
    const payoutBRow = await PayoutRequest.findById(payoutB._id).lean();
    check("C1b. Payout B is genuinely CANCELLED in the database", payoutBRow?.status === "CANCELLED", payoutBRow);

    // 2. Owner cancels a payout belonging to Salon A (the FIRST of
    //    their two salons).
    const payoutA = await makeLockedPayout(cancelSalonA, 40000);
    const cancelAttemptA = await authFetch(`/api/payouts/cancel/${payoutA._id}`, cancelOwnerToken, { method: "POST" });
    const cancelAttemptABody = await cancelAttemptA.json();
    check("C2. Owner cancels their own payout on Salon A (1st of 2 salons) → 200", cancelAttemptA.status === 200 && cancelAttemptABody?.data?.status === "CANCELLED", { status: cancelAttemptA.status, body: cancelAttemptABody });

    // 3. A different owner cannot cancel this owner's payout.
    const foreignOwner = await makeOwner("FOREIGN_CANCEL");
    const foreignOwnerToken = tokenFor(foreignOwner);
    await makeSalon(foreignOwner._id, "FOREIGN_CANCEL");
    const payoutForForeignTest = await makeLockedPayout(cancelSalonA, 30000);
    const foreignCancelAttempt = await authFetch(`/api/payouts/cancel/${payoutForForeignTest._id}`, foreignOwnerToken, { method: "POST" });
    check("C3. A different owner's token cannot cancel this owner's payout → 404, not 200", foreignCancelAttempt.status === 404, { status: foreignCancelAttempt.status, body: await foreignCancelAttempt.json().catch(() => null) });
    const payoutForForeignTestRow = await PayoutRequest.findById(payoutForForeignTest._id).lean();
    check("C3b. The foreign cancel attempt had no effect — payout is still REQUESTED, not fetched/mutated", payoutForForeignTestRow?.status === "REQUESTED", payoutForForeignTestRow);

    // 4. Missing payout → 404.
    const missingPayoutAttempt = await authFetch(`/api/payouts/cancel/${new mongoose.Types.ObjectId()}`, cancelOwnerToken, { method: "POST" });
    check("C4. A nonexistent payout id → 404, not a crash", missingPayoutAttempt.status === 404, { status: missingPayoutAttempt.status });

    // 5. A soft-deleted salon cannot authorize a cancel, even for its
    //    own true owner.
    const deletedSalonOwner = await makeOwner("DELETED_SALON_CANCEL");
    const deletedSalonOwnerToken = tokenFor(deletedSalonOwner);
    const deletedSalon = await makeSalon(deletedSalonOwner._id, "DELETED_CANCEL");
    const payoutOnDeletedSalon = await makeLockedPayout(deletedSalon, 20000);
    await Salon.updateOne({ _id: deletedSalon._id }, { $set: { isDeleted: true } });
    const deletedSalonCancelAttempt = await authFetch(`/api/payouts/cancel/${payoutOnDeletedSalon._id}`, deletedSalonOwnerToken, { method: "POST" });
    check("C5. The payout's salon is soft-deleted → 404, even for its own true owner", deletedSalonCancelAttempt.status === 404, { status: deletedSalonCancelAttempt.status });

    //////////////////////////////////////////////////////////////
    // PART D — fail-closed ambiguity for getWallet/requestWithdrawal/
    //          getPayoutHistory/getLedger
    //////////////////////////////////////////////////////////////

    // ── D-single: one real salon — preserve existing behavior exactly ──
    const singleOwner = await makeOwner("SINGLE_D");
    const singleOwnerToken = tokenFor(singleOwner);
    const singleSalon = await makeSalon(singleOwner._id, "SINGLE_D");
    await makeBankVerifiedKyc(singleOwner._id);
    await creditAvailable(singleSalon._id, 100000);

    const singleWallet = await authFetch("/api/payouts/wallet", singleOwnerToken);
    check("D-single-1. Single-salon owner — getWallet → 200 (unchanged)", singleWallet.status === 200, { status: singleWallet.status });

    const singleHistory = await authFetch("/api/payouts/history", singleOwnerToken);
    check("D-single-2. Single-salon owner — getPayoutHistory → 200 (unchanged)", singleHistory.status === 200, { status: singleHistory.status });

    const singleLedger = await authFetch("/api/payouts/ledger", singleOwnerToken);
    check("D-single-3. Single-salon owner — getLedger → 200 (unchanged)", singleLedger.status === 200, { status: singleLedger.status });

    const singleWithdraw = await authFetch("/api/payouts/withdraw", singleOwnerToken, { method: "POST", body: JSON.stringify({ amountInPaise: 50000 }) });
    const singleWithdrawBody = await singleWithdraw.json();
    check("D-single-4. Single-salon owner — requestWithdrawal → 200 (unchanged), real funds held", singleWithdraw.status === 200 && !!singleWithdrawBody?.data?.payoutId, { status: singleWithdraw.status, body: singleWithdrawBody });
    const singlePayoutRow = await PayoutRequest.findOne({ salonId: singleSalon._id }).lean();
    check("D-single-5. The real PayoutRequest was created against the single real salon", String(singlePayoutRow?.salonId) === String(singleSalon._id), singlePayoutRow);

    // ── D-zero: zero salons — preserve existing 404 behavior exactly ──
    const zeroOwner = await makeOwner("ZERO_D");
    const zeroOwnerToken = tokenFor(zeroOwner);

    const zeroWallet = await authFetch("/api/payouts/wallet", zeroOwnerToken);
    check("D-zero-1. Zero-salon owner — getWallet → 404 'Salon not found' (unchanged)", zeroWallet.status === 404, { status: zeroWallet.status, body: await zeroWallet.json().catch(() => null) });

    const zeroHistory = await authFetch("/api/payouts/history", zeroOwnerToken);
    check("D-zero-2. Zero-salon owner — getPayoutHistory → 404 (unchanged)", zeroHistory.status === 404, { status: zeroHistory.status });

    const zeroLedger = await authFetch("/api/payouts/ledger", zeroOwnerToken);
    check("D-zero-3. Zero-salon owner — getLedger → 404 (unchanged)", zeroLedger.status === 404, { status: zeroLedger.status });

    const zeroWithdraw = await authFetch("/api/payouts/withdraw", zeroOwnerToken, { method: "POST", body: JSON.stringify({ amountInPaise: 50000 }) });
    check("D-zero-4. Zero-salon owner — requestWithdrawal → 404 (unchanged)", zeroWithdraw.status === 404, { status: zeroWithdraw.status });

    // ── D-ambiguous: two real salons — fail closed with 409 AMBIGUOUS_SALON ──
    const ambigOwner = await makeOwner("AMBIGUOUS_D");
    const ambigOwnerToken = tokenFor(ambigOwner);
    const ambigSalon1 = await makeSalon(ambigOwner._id, "AMBIGUOUS_D1");
    const ambigSalon2 = await makeSalon(ambigOwner._id, "AMBIGUOUS_D2");
    await makeBankVerifiedKyc(ambigOwner._id);
    await creditAvailable(ambigSalon1._id, 100000);
    await creditAvailable(ambigSalon2._id, 100000);

    const isAmbiguous = (res, body) => res.status === 409 && body?.success === false && body?.code === "AMBIGUOUS_SALON";

    const ambigWallet = await authFetch("/api/payouts/wallet", ambigOwnerToken);
    const ambigWalletBody = await ambigWallet.json();
    check("D-ambig-1. Multi-salon owner — getWallet → 409 AMBIGUOUS_SALON (fails closed, never guesses)", isAmbiguous(ambigWallet, ambigWalletBody), { status: ambigWallet.status, body: ambigWalletBody });

    const ambigHistory = await authFetch("/api/payouts/history", ambigOwnerToken);
    const ambigHistoryBody = await ambigHistory.json();
    check("D-ambig-2. Multi-salon owner — getPayoutHistory → 409 AMBIGUOUS_SALON", isAmbiguous(ambigHistory, ambigHistoryBody), { status: ambigHistory.status, body: ambigHistoryBody });

    const ambigLedger = await authFetch("/api/payouts/ledger", ambigOwnerToken);
    const ambigLedgerBody = await ambigLedger.json();
    check("D-ambig-3. Multi-salon owner — getLedger → 409 AMBIGUOUS_SALON", isAmbiguous(ambigLedger, ambigLedgerBody), { status: ambigLedger.status, body: ambigLedgerBody });

    // Snapshot BEFORE the ambiguous withdrawal attempt, to prove it
    // truly has zero side effects.
    const ledgerCountBefore = await WalletLedger.countDocuments({ salonId: { $in: [ambigSalon1._id, ambigSalon2._id] } });
    const payoutCountBefore = await PayoutRequest.countDocuments({ salonId: { $in: [ambigSalon1._id, ambigSalon2._id] } });

    const ambigWithdraw = await authFetch("/api/payouts/withdraw", ambigOwnerToken, { method: "POST", body: JSON.stringify({ amountInPaise: 50000 }) });
    const ambigWithdrawBody = await ambigWithdraw.json();
    check("D-ambig-4. Multi-salon owner — requestWithdrawal → 409 AMBIGUOUS_SALON, never guesses which wallet to hold", isAmbiguous(ambigWithdraw, ambigWithdrawBody), { status: ambigWithdraw.status, body: ambigWithdrawBody });

    const ledgerCountAfter = await WalletLedger.countDocuments({ salonId: { $in: [ambigSalon1._id, ambigSalon2._id] } });
    const payoutCountAfter = await PayoutRequest.countDocuments({ salonId: { $in: [ambigSalon1._id, ambigSalon2._id] } });
    check("D-ambig-5. The ambiguous withdrawal attempt created ZERO WalletLedger entries for either salon", ledgerCountAfter === ledgerCountBefore, { before: ledgerCountBefore, after: ledgerCountAfter });
    check("D-ambig-6. The ambiguous withdrawal attempt created ZERO PayoutRequest documents for either salon", payoutCountAfter === payoutCountBefore, { before: payoutCountBefore, after: payoutCountAfter });

    const wallet1AfterAmbig = await WalletBalanceService.getWallet(ambigSalon1._id);
    const wallet2AfterAmbig = await WalletBalanceService.getWallet(ambigSalon2._id);
    check("D-ambig-7. Neither salon's AVAILABLE balance was touched by the ambiguous attempt (still the pre-funded 100000 each)", wallet1AfterAmbig?.availableBalanceInPaise === 100000 && wallet2AfterAmbig?.availableBalanceInPaise === 100000, { wallet1: wallet1AfterAmbig?.availableBalanceInPaise, wallet2: wallet2AfterAmbig?.availableBalanceInPaise });

    // ── Network guard sanity ─────────────────────────────────────
    check("E1. Network guard was installed before any app/model import", networkGuardInstalled === true, networkGuardInstalled);
    check("E2. Network guard recorded zero blocked non-loopback attempts during this run", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nPAYOUT SALON AMBIGUITY (Parts C+D): ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
