/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentManualWithdraw.js
 *
 * FA-P4-C Step 1 — disposable real-Mongo / real-HTTP verification of the
 * wallet-backed Field Agent manual withdrawal:
 *   GET  /api/field-agent/payout/wallet
 *   POST /api/field-agent/payout/withdraw
 * plus the EXISTING admin approve / reject / manual-result / retry and
 * agent cancel flows driving the same WalletBalanceService lifecycle.
 * Fixtures are prefix-marked and purged before and after. FieldAgentEarningLedger
 * and WalletLedger are append-only at schema level, so fixture removal
 * of those two uses the raw driver.
 *
 * Run:  cd backend && node scripts/verifyFieldAgentManualWithdraw.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import SalonEarnings from "../models/SalonEarnings.js";
import WalletLedger from "../models/WalletLedger.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentPayoutRequest from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import KYC from "../modules/kyc/models/KYC.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_FAP4C1_";
const oid = () => new mongoose.Types.ObjectId();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;
const key = () => `${P}KEY_${oid()}`;

const purge = async () => {
  const users = await User.find({ name: new RegExp(`^${P}`) }).select("_id").lean();
  const userIds = users.map((u) => u._id);
  const agents = await FieldAgent.find({ userRef: { $in: userIds } }).select("_id applicationRef").lean();
  const agentIds = agents.map((a) => a._id);
  const payoutIds = await FieldAgentPayoutRequest.distinct("_id", { fieldAgentRef: { $in: agentIds } });
  await WalletLedger.collection.deleteMany({ ownerId: { $in: agentIds } });
  await SalonEarnings.deleteMany({ entityType: "FIELD_AGENT", entityId: { $in: agentIds } });
  await FieldAgentEarningLedger.collection.deleteMany({ fieldAgentRef: { $in: agentIds } });
  await FieldAgentAuditEvent.deleteMany({ entityId: { $in: payoutIds } });
  await FieldAgentPayoutRequest.deleteMany({ _id: { $in: payoutIds } });
  await KYC.deleteMany({ ownerId: { $in: userIds } });
  await FieldAgent.deleteMany({ _id: { $in: agentIds } });
  await FieldAgentApplication.deleteMany({ _id: { $in: agents.map((a) => a.applicationRef) } });
  await User.deleteMany({ _id: { $in: userIds } });
};

const run = async () => {
  await connectDB();
  await purge();
  const server = app.listen(0);
  const { port } = server.address();
  const call = (path, token, { method = "GET", body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

  const W = "/api/field-agent/payout";
  const ADMIN = "/api/admin/field-agent/payouts";

  try {
    const mkAgent = async (label, { kyc = true, credit = 0 } = {}) => {
      const user = await User.create({ name: `${P}${label}`, phone: phone("8"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      const application = await FieldAgentApplication.create({ userRef: oid(), phone: phone("9"), status: "APPROVED", nonTerminal: false });
      const agent = await FieldAgent.create({
        userRef: user._id, applicationRef: application._id,
        agentCode: `ZFP4C1-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT",
      });
      if (kyc) {
        await KYC.create({
          ownerId: user._id, applicantType: "FIELD_AGENT",
          bank: { accountHolder: `${P}HOLDER`, maskedAccount: "XXXX4321", ifsc: "HDFC0000123", bankName: "HDFC Bank", pennyDropStatus: "SUCCESS" },
        });
      }
      const credits = Array.isArray(credit) ? credit : credit ? [credit] : [];
      for (const amt of credits) {
        await FieldAgentEarningLedger.create({
          bookingRef: oid(), entitlementType: "ACQUISITION", idempotencyKey: `${P}LEDGER_${oid()}`,
          fieldAgentRef: agent._id, policySource: "NATIONAL", policyVersionRef: oid(), appliedRatePercent: 10,
          bookingCommissionAmountInPaise: amt, rawEligibleAmountInPaise: amt, creditedAmountInPaise: amt,
          creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
        });
      }
      return { user, agent, token: generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: 0 }) };
    };
    const walletDoc = (agent) => SalonEarnings.findOne({ entityType: "FIELD_AGENT", entityId: agent._id }).lean();
    const ledgerRows = (agent) => WalletLedger.collection.find({ ownerId: agent._id }).sort({ createdAt: 1, _id: 1 }).toArray();
    const seq = (rows) => rows.filter((r) => r.action !== "EARNING_CREDIT").map((r) => r.action).join(",");

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive the existing approval flow");
    const adminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    // ═══ GET /wallet ═══════════════════════════════════════════
    const A = await mkAgent("A", { credit: [70000, 30000] }); // ₹1000 in two earnings
    const g1 = await call(`${W}/wallet`, A.token);
    const g = g1.data?.data || {};
    check("G1 GET /payout/wallet 200", g1.status === 200, g1);
    check("G2 availableBalance = ₹1000 (unmirrored earnings counted)", g.availableBalance === 100000, g);
    check("G3 minimumPayout = ₹500", g.minimumPayout === 50000, g);
    check("G4 bankAccountSnapshot verified + masked", g.bankAccountSnapshot?.maskedAccount === "XXXX4321" && g.bankAccountSnapshot?.ifsc === "HDFC0000123" && !("accountNumber" in (g.bankAccountSnapshot || {})), g.bankAccountSnapshot);
    check("G5 hasPendingRequest false", g.hasPendingRequest === false, g);
    check("G6 GET is read-only (no wallet doc, no ledger rows created)", (await walletDoc(A.agent)) === null && (await ledgerRows(A.agent)).length === 0);
    const gAlias = await call("/api/field-agent/payouts/wallet", A.token);
    check("G7 legacy /payouts/wallet path serves the same handler", gAlias.status === 200 && gAlias.data?.data?.availableBalance === 100000, gAlias.data);

    // ═══ POST /withdraw — rules ════════════════════════════════
    let r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 49999, idempotencyKey: key() } });
    check("W1 below ₹500 rejected (400)", r.status === 400, r);
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 100001, idempotencyKey: key() } });
    check("W2 above available rejected (400)", r.status === 400, r);
    check("W3 rejected attempts leave no wallet/ledger trace (sync rolled back)", (await walletDoc(A.agent)) === null && (await ledgerRows(A.agent)).length === 0);
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 60000 } });
    check("W4 missing idempotencyKey rejected (400)", r.status === 400, r);
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 60000, idempotencyKey: key(), fieldAgentRef: oid() } });
    check("W5 client-supplied fieldAgentRef rejected (400)", r.status === 400, r);

    const idemKey = key();
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 60000, idempotencyKey: idemKey } });
    const payoutA = r.data?.data?.payout;
    check("W6 valid ₹600 withdraw created (201, REQUESTED)", r.status === 201 && payoutA?.status === "REQUESTED", r);
    check("W7 bank snapshot stored on the request", payoutA?.bankSnapshot?.maskedAccount === "XXXX4321", payoutA?.bankSnapshot);
    let w = await walletDoc(A.agent);
    check("W8 wallet: available 40000 / locked 60000 (Available → held)", w?.availableBalanceInPaise === 40000 && w?.lockedBalanceInPaise === 60000, w);
    let rows = await ledgerRows(A.agent);
    check("W9 ledger: 2×EARNING_CREDIT + WITHDRAWAL_HOLD×2, all ownerType FIELD_AGENT",
      rows.filter((x) => x.action === "EARNING_CREDIT").length === 2 && seq(rows) === "WITHDRAWAL_HOLD,WITHDRAWAL_HOLD" && rows.every((x) => x.ownerType === "FIELD_AGENT"), rows.map((x) => x.action));
    check("W10 hold rows attributed triggeredBy FIELD_AGENT", rows.filter((x) => x.action === "WITHDRAWAL_HOLD").every((x) => x.triggeredBy === "FIELD_AGENT"));

    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 60000, idempotencyKey: idemKey } });
    check("I1 idempotent replay: 200, same payout", r.status === 200 && r.data?.data?.payout?._id === payoutA._id, r);
    check("I2 replay wrote nothing new", (await ledgerRows(A.agent)).length === rows.length && (await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: A.agent._id })) === 1);
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } });
    check("O1 second open request with a new key rejected (409)", r.status === 409, r);
    w = await walletDoc(A.agent);
    check("O2 wallet unchanged by the rejected second request", w.availableBalanceInPaise === 40000 && w.lockedBalanceInPaise === 60000);
    const g2 = (await call(`${W}/wallet`, A.token)).data?.data;
    check("G8 wallet now: availableBalance 40000, hasPendingRequest true", g2?.availableBalance === 40000 && g2?.hasPendingRequest === true, g2);
    const dash = (await call("/api/field-agent/acquisition/dashboard", A.token)).data?.data;
    check("G9 dashboard availablePayout (unchanged calc) agrees with wallet AVAILABLE", dash?.availablePayout === 40000, dash);

    // ═══ Cancel → release ═════════════════════════════════════
    r = await call(`${W}/mine/${payoutA._id}/cancel`, A.token, { method: "POST" });
    w = await walletDoc(A.agent);
    check("C1 cancel 200; wallet available 100000 / locked 0", r.status === 200 && w.availableBalanceInPaise === 100000 && w.lockedBalanceInPaise === 0, w);
    check("C2 cancel ledger = WITHDRAWAL_RELEASE×2 appended", seq(await ledgerRows(A.agent)) === "WITHDRAWAL_HOLD,WITHDRAWAL_HOLD,WITHDRAWAL_RELEASE,WITHDRAWAL_RELEASE");

    // ═══ Full admin flow: request → approve → paid ════════════
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 55000, idempotencyKey: key() } });
    const p2 = r.data?.data?.payout;
    check("A0 new request after cancel allowed (201)", r.status === 201, r);
    r = await call(`${ADMIN}/${p2._id}/approve`, adminToken, { method: "PATCH" });
    w = await walletDoc(A.agent);
    check("A1 existing admin approve → PROCESSING; wallet locked 0 / processing 55000", r.status === 200 && w.lockedBalanceInPaise === 0 && w.processingBalanceInPaise === 55000, { s: r.status, w });
    r = await call(`${ADMIN}/${p2._id}/manual-result`, adminToken, { method: "PATCH", body: { success: false, failureReason: `${P}bank timeout` } });
    w = await walletDoc(A.agent);
    check("A2 manual FAILED: funds stay in PROCESSING (FA-14 failed-is-reserving preserved)", r.status === 200 && w.processingBalanceInPaise === 55000, w);
    r = await call(`${ADMIN}/${p2._id}/retry`, adminToken, { method: "PATCH" });
    check("A3 retry FAILED → PROCESSING, no wallet move", r.status === 200 && (await walletDoc(A.agent)).processingBalanceInPaise === 55000);
    r = await call(`${ADMIN}/${p2._id}/manual-result`, adminToken, { method: "PATCH", body: { success: true, utr: `${P}UTR1` } });
    w = await walletDoc(A.agent);
    check("A4 manual PAID: processing 0, available 45000, lifetimeWithdrawals 55000", r.status === 200 && w.processingBalanceInPaise === 0 && w.availableBalanceInPaise === 45000 && w.lifetimeWithdrawalsInPaise === 55000, w);
    rows = await ledgerRows(A.agent);
    check("A5 lifecycle ledger identical to Salon: HOLD×2, PROCESSING×2, PAYOUT_SUCCESS×1 (for this payout)",
      seq(rows.filter((x) => String(x.entityId) === p2._id)) === "WITHDRAWAL_HOLD,WITHDRAWAL_HOLD,WITHDRAWAL_PROCESSING,WITHDRAWAL_PROCESSING,PAYOUT_SUCCESS", seq(rows.filter((x) => String(x.entityId) === p2._id)));
    r = await call(`${ADMIN}/${p2._id}/manual-result`, adminToken, { method: "PATCH", body: { success: true, utr: `${P}UTR1` } });
    check("A6 re-recording PAID is refused (409); wallet not double-debited", r.status === 409 && (await walletDoc(A.agent)).availableBalanceInPaise === 45000, r.status);

    // ═══ Reject → release ═════════════════════════════════════
    const R = await mkAgent("R", { credit: 100000 });
    r = await call(`${W}/withdraw`, R.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } });
    const p3 = r.data?.data?.payout;
    r = await call(`${ADMIN}/${p3._id}/reject`, adminToken, { method: "PATCH", body: { reason: `${P}rejected` } });
    w = await walletDoc(R.agent);
    check("R1 admin reject → funds released to AVAILABLE (100000), locked 0", r.status === 200 && w.availableBalanceInPaise === 100000 && w.lockedBalanceInPaise === 0, w);
    check("R2 reject ledger = HOLD×2 then RELEASE×2, and a new request is allowed again",
      seq(await ledgerRows(R.agent)) === "WITHDRAWAL_HOLD,WITHDRAWAL_HOLD,WITHDRAWAL_RELEASE,WITHDRAWAL_RELEASE" &&
      (await call(`${W}/withdraw`, R.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } })).status === 201);

    // ═══ Reconciliation + immutability ════════════════════════
    rows = await ledgerRows(A.agent);
    w = await walletDoc(A.agent);
    const sum = (bucket) => rows.filter((x) => x.bucket === bucket).reduce((a, x) => a + (x.direction === "CREDIT" ? x.amountInPaise : -x.amountInPaise), 0);
    w = await walletDoc(A.agent);
    check("L1 wallet buckets == Σ WalletLedger per bucket (AVAILABLE/LOCKED/PROCESSING)",
      sum("AVAILABLE") === w.availableBalanceInPaise && sum("LOCKED") === (w.lockedBalanceInPaise || 0) && sum("PROCESSING") === (w.processingBalanceInPaise || 0),
      { ledger: [sum("AVAILABLE"), sum("LOCKED"), sum("PROCESSING")], wallet: [w.availableBalanceInPaise, w.lockedBalanceInPaise, w.processingBalanceInPaise] });
    let blocked = false;
    try { await WalletLedger.updateOne({ _id: rows[0]._id }, { $set: { amountInPaise: 1 } }); } catch { blocked = true; }
    check("L2 WalletLedger is immutable (schema hook blocks update)", blocked);
    check("L3 no duplicate idempotency keys in this wallet's ledger", new Set(rows.map((x) => x.idempotencyKey)).size === rows.length);
    // Earnings arriving later are mirrored exactly once.
    await FieldAgentEarningLedger.create({
      bookingRef: oid(), entitlementType: "ACQUISITION", idempotencyKey: `${P}LEDGER_${oid()}`,
      fieldAgentRef: A.agent._id, policySource: "NATIONAL", policyVersionRef: oid(), appliedRatePercent: 10,
      bookingCommissionAmountInPaise: 20000, rawEligibleAmountInPaise: 20000, creditedAmountInPaise: 20000,
      creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
    });
    const g3 = (await call(`${W}/wallet`, A.token)).data?.data;
    check("E1 later earning shows in availableBalance (45000+20000) without a write", g3?.availableBalance === 65000, g3);
    r = await call(`${W}/withdraw`, A.token, { method: "POST", body: { amountInPaise: 65000, idempotencyKey: key() } });
    w = await walletDoc(A.agent);
    check("E2 withdrawing the full mirrored balance works; available 0, locked 65000", r.status === 201 && w.availableBalanceInPaise === 0 && w.lockedBalanceInPaise === 65000, { s: r.status, w });
    check("E3 each earning mirrored exactly once (3 EARNING_CREDIT rows)", (await ledgerRows(A.agent)).filter((x) => x.action === "EARNING_CREDIT").length === 3);

    // ═══ Concurrency ═══════════════════════════════════════════
    const C = await mkAgent("C", { credit: 200000 });
    const [c1, c2] = await Promise.all([
      call(`${W}/withdraw`, C.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } }),
      call(`${W}/withdraw`, C.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } }),
    ]);
    const created = [c1, c2].filter((x) => x.status === 201).length;
    const wc = await walletDoc(C.agent);
    check("K1 two concurrent different-key withdrawals → exactly one created", created === 1 && (await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: C.agent._id })) === 1, [c1.status, c2.status]);
    check("K2 wallet holds exactly one request (locked 50000, available 150000)", wc.lockedBalanceInPaise === 50000 && wc.availableBalanceInPaise === 150000, wc);
    const D = await mkAgent("D", { credit: 200000 });
    const sameKey = key();
    const d = await Promise.all([1, 2, 3].map(() => call(`${W}/withdraw`, D.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: sameKey } })));
    const wd = await walletDoc(D.agent);
    check("K3 three concurrent SAME-key withdrawals → one payout, no error 5xx, wallet held once",
      (await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: D.agent._id })) === 1 && d.every((x) => x.status < 500) && wd.lockedBalanceInPaise === 50000, { st: d.map((x) => x.status), wd });

    // ═══ Eligibility / auth ═══════════════════════════════════
    const N = await mkAgent("N", { kyc: false, credit: 100000 });
    const n1 = await call(`${W}/wallet`, N.token);
    check("N1 no KYC: wallet still loads, bankAccountSnapshot null", n1.status === 200 && n1.data?.data?.bankAccountSnapshot === null, n1.data);
    r = await call(`${W}/withdraw`, N.token, { method: "POST", body: { amountInPaise: 50000, idempotencyKey: key() } });
    check("N2 no verified bank: withdraw refused (403), nothing written", r.status === 403 && (await walletDoc(N.agent)) === null, r.status);
    const noAuth = await call(`${W}/wallet`, null);
    check("S1 unauthenticated → 401", noAuth.status === 401);
    const salonish = generateAccessToken({ _id: (await User.findOne({ role: { $ne: "FIELD_AGENT" } }).select("_id").lean())._id, role: "USER", tokenVersion: 0 });
    const s2 = await call(`${W}/wallet`, salonish);
    check("S2 non-Field-Agent token cannot use the wallet endpoint (401/403)", [401, 403].includes(s2.status), s2.status);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purge().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    const leftUsers = await User.countDocuments({ name: new RegExp(`^${P}`) });
    const leftWallets = await SalonEarnings.countDocuments({ entityType: "FIELD_AGENT" });
    check("Z1 fixtures purged (no fixture users; no FIELD_AGENT wallets left)", leftUsers === 0 && leftWallets === 0, { leftUsers, leftWallets });
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
