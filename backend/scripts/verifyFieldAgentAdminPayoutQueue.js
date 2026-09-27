/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentAdminPayoutQueue.js
 *
 * FA-P4-C Step 2 — disposable real-Mongo / real-HTTP verification of the
 * admin manual payout queue backend: multi-status list (Processing tab =
 * REQUESTED,PROCESSING), approve / reject (reason mandatory) / manual
 * result, and the wallet effect of each — all through the EXISTING admin
 * endpoints.
 *
 * Run:   node scripts/verifyFieldAgentAdminPayoutQueue.js
 * Serve: node scripts/verifyFieldAgentAdminPayoutQueue.js --serve
 *        seeds the same fixtures, listens on :6161 and prints an admin
 *        token, for driving the admin-panel page by hand. Ctrl-C purges.
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

const SERVE = process.argv.includes("--serve");
let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_FAP4C2_";
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
  const server = app.listen(SERVE ? 6161 : 0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const call = (path, token, { method = "GET", body } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  const W = "/api/field-agent/payout";
  const ADMIN = "/api/admin/field-agent/payouts";

  const cleanup = async () => {
    await purge().catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  };

  try {
    const mkAgent = async (label, commercialPath, name) => {
      const user = await User.create({ name: `${P}${name}`, phone: phone("8"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      const application = await FieldAgentApplication.create({ userRef: oid(), phone: phone("9"), status: "APPROVED", nonTerminal: false });
      const agent = await FieldAgent.create({
        userRef: user._id, applicationRef: application._id,
        agentCode: `ZFP4C2-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus: "ACTIVE", commercialPath,
      });
      await KYC.create({
        ownerId: user._id, applicantType: "FIELD_AGENT",
        bank: { accountHolder: `${name} Holder`, maskedAccount: "XXXX4321", ifsc: "HDFC0000123", bankName: "HDFC Bank", pennyDropStatus: "SUCCESS" },
      });
      await FieldAgentEarningLedger.create({
        bookingRef: oid(), entitlementType: "ACQUISITION", idempotencyKey: `${P}LEDGER_${oid()}`,
        fieldAgentRef: agent._id, policySource: "NATIONAL", policyVersionRef: oid(), appliedRatePercent: 10,
        bookingCommissionAmountInPaise: 200000, rawEligibleAmountInPaise: 200000, creditedAmountInPaise: 200000,
        creditOutcome: "CREDITED", bookingCompletedAt: new Date(),
      });
      return { user, agent, token: generateAccessToken({ _id: user._id, role: "FIELD_AGENT", tokenVersion: 0 }) };
    };
    const request = async (a, amountInPaise) => {
      const r = await call(`${W}/withdraw`, a.token, { method: "POST", body: { amountInPaise, idempotencyKey: key() } });
      if (r.status !== 201) throw new Error(`seed withdraw failed ${r.status} ${JSON.stringify(r.data?.message)}`);
      return r.data.data.payout;
    };
    const walletDoc = (a) => SalonEarnings.findOne({ entityType: "FIELD_AGENT", entityId: a.agent._id }).lean();

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB");
    const adminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
    const patch = (path, body) => call(`${ADMIN}/${path}`, adminToken, { method: "PATCH", body });

    // Seed: one payout per agent (one open request per agent is enforced).
    const a1 = await mkAgent("A1", "ACQUISITION_AGENT", "Asha Acquisition");   // stays REQUESTED
    const a2 = await mkAgent("A2", "TERRITORY_PARTNER", "Tarun Territory");    // rejected in the test
    const a3 = await mkAgent("A3", "ACQUISITION_AGENT", "Priya Processing");   // approved -> PROCESSING
    const a4 = await mkAgent("A4", "TERRITORY_PARTNER", "Paul Paid");          // approved -> PAID
    const a5 = await mkAgent("A5", "ACQUISITION_AGENT", "Farah Failed");       // approved -> FAILED
    const p1 = await request(a1, 60000);
    const p2 = await request(a2, 70000);
    const p3 = await request(a3, 80000);
    const p4 = await request(a4, 90000);
    const p5 = await request(a5, 100000);
    for (const p of [p3, p4, p5]) await patch(`${p._id}/approve`);
    await patch(`${p4._id}/manual-result`, { success: true, utr: `${P}UTR4` });
    await patch(`${p5._id}/manual-result`, { success: false, failureReason: `${P}bank timeout` });

    if (SERVE) {
      console.log(JSON.stringify({ port, adminToken, admin: { _id: indiaAdmin._id, name: indiaAdmin.name, adminLevel: "INDIA" }, seeded: { requested: p1._id, toReject: p2._id, processing: p3._id, paid: p4._id, failed: p5._id } }));
      await new Promise((resolve) => { process.on("SIGINT", resolve); process.on("SIGTERM", resolve); });
      await cleanup();
      return;
    }

    const mine = (rows) => rows.filter((p) => String(p.fieldAgentRef?.userRef?.name || "").startsWith(P));
    const ids = (rows) => mine(rows).map((p) => String(p._id)).sort();
    const list = async (status) => (await call(`${ADMIN}?limit=100${status ? `&status=${status}` : ""}`, adminToken));

    // ═══ Tab lists ═════════════════════════════════════════════
    let r = await list("REQUESTED,PROCESSING");
    let rows = r.data?.data?.payouts || [];
    check("T1 Processing tab (status=REQUESTED,PROCESSING) 200", r.status === 200, r.status);
    check("T2 returns REQUESTED + PROCESSING only", JSON.stringify(ids(rows)) === JSON.stringify([p1._id, p2._id, p3._id].map(String).sort()), ids(rows));
    check("T3 no PAID/FAILED leak into Processing tab", mine(rows).every((p) => ["REQUESTED", "PROCESSING"].includes(p.status)));
    const row1 = mine(rows).find((p) => String(p._id) === String(p1._id));
    check("T4 row carries Agent / Agent Type / Amount / Bank / Requested At / Status fields",
      row1?.fieldAgentRef?.userRef?.name === `${P}Asha Acquisition` && row1?.fieldAgentRef?.agentCode && row1?.fieldAgentRef?.commercialPath === "ACQUISITION_AGENT" &&
      row1?.amountInPaise === 60000 && row1?.bankSnapshot?.bankName === "HDFC Bank" && row1?.bankSnapshot?.maskedAccount === "XXXX4321" && row1?.createdAt && row1?.status === "REQUESTED", row1);
    check("T5 Agent Type distinguishes TERRITORY_PARTNER", mine(rows).find((p) => String(p._id) === String(p2._id))?.fieldAgentRef?.commercialPath === "TERRITORY_PARTNER");
    check("T6 pagination.total reflects the multi-status filter", (r.data?.pagination?.total ?? 0) >= 3, r.data?.pagination);
    r = await list("PAID");
    check("T7 Paid tab lists the paid payout (with UTR)", JSON.stringify(ids(r.data?.data?.payouts || [])) === JSON.stringify([String(p4._id)]) && mine(r.data.data.payouts)[0].utr === `${P}UTR4`);
    r = await list("FAILED");
    check("T8 Failed tab lists the failed payout (with reason)", JSON.stringify(ids(r.data?.data?.payouts || [])) === JSON.stringify([String(p5._id)]) && mine(r.data.data.payouts)[0].failureReason === `${P}bank timeout`);
    r = await list("REQUESTED");
    check("T9 single-status filter unchanged", JSON.stringify(ids(r.data?.data?.payouts || [])) === JSON.stringify([String(p1._id), String(p2._id)].sort()));
    check("T10 unknown status rejected (400)", (await list("BOGUS")).status === 400 && (await list("REQUESTED,BOGUS")).status === 400);
    const noFilter = await list("");
    check("T11 no filter still returns everything (5 fixtures)", ids(noFilter.data?.data?.payouts || []).length === 5);

    // ═══ Reject (reason mandatory) ═════════════════════════════
    const before = await walletDoc(a2);
    r = await patch(`${p2._id}/reject`, {});
    check("R1 reject without reason → 400", r.status === 400, r.status);
    r = await patch(`${p2._id}/reject`, { reason: "   " });
    check("R2 reject with blank reason → 400", r.status === 400, r.status);
    const same = await walletDoc(a2);
    check("R3 failed rejects change nothing (still REQUESTED, wallet locked)", (await FieldAgentPayoutRequest.findById(p2._id).lean()).status === "REQUESTED" && same.lockedBalanceInPaise === before.lockedBalanceInPaise && same.lockedBalanceInPaise === 70000, same);
    r = await patch(`${p2._id}/reject`, { reason: `${P}not eligible` });
    const w2 = await walletDoc(a2);
    check("R4 reject with reason → 200, REJECTED, adminNote stored", r.status === 200 && r.data?.data?.payout?.status === "REJECTED" && r.data.data.payout.adminNote === `${P}not eligible`, r.data);
    check("R5 wallet released: available 200000, locked 0", w2.availableBalanceInPaise === 200000 && w2.lockedBalanceInPaise === 0, w2);
    r = await list("REQUESTED,PROCESSING");
    check("R6 rejected payout left the Processing tab", !ids(r.data.data.payouts).includes(String(p2._id)));
    check("R7 second reject refused (409), no double release", (await patch(`${p2._id}/reject`, { reason: "again" })).status === 409 && (await walletDoc(a2)).availableBalanceInPaise === 200000);

    // ═══ Approve ═══════════════════════════════════════════════
    r = await patch(`${p1._id}/approve`);
    const w1 = await walletDoc(a1);
    check("A1 approve REQUESTED → PROCESSING; wallet locked 0 / processing 60000", r.status === 200 && r.data?.data?.payout?.status === "PROCESSING" && w1.lockedBalanceInPaise === 0 && w1.processingBalanceInPaise === 60000, { s: r.status, w1 });
    r = await list("REQUESTED,PROCESSING");
    check("A2 approved payout stays in Processing tab (as PROCESSING)", mine(r.data.data.payouts).find((p) => String(p._id) === String(p1._id))?.status === "PROCESSING");
    check("A3 approving again refused (409), wallet unchanged", (await patch(`${p1._id}/approve`)).status === 409 && (await walletDoc(a1)).processingBalanceInPaise === 60000);

    // ═══ Mark Paid / Failed from the Processing tab ════════════
    r = await patch(`${p1._id}/manual-result`, { success: true });
    check("M1 mark paid without UTR → 400", r.status === 400, r.status);
    r = await patch(`${p1._id}/manual-result`, { success: true, utr: `${P}UTR1` });
    const w1b = await walletDoc(a1);
    check("M2 mark paid with UTR → PAID; processing 0, lifetime withdrawals 60000", r.status === 200 && r.data?.data?.payout?.status === "PAID" && w1b.processingBalanceInPaise === 0 && w1b.lifetimeWithdrawalsInPaise === 60000, { s: r.status, w1b });
    r = await list("PAID");
    check("M3 payout now appears in Paid tab (2)", ids(r.data.data.payouts).length === 2);
    r = await patch(`${p3._id}/manual-result`, { success: false });
    check("M4 mark failed without reason → 400", r.status === 400, r.status);
    r = await patch(`${p3._id}/manual-result`, { success: false, failureReason: `${P}wrong IFSC` });
    check("M5 mark failed with reason → FAILED; funds stay in Processing", r.status === 200 && r.data?.data?.payout?.status === "FAILED" && (await walletDoc(a3)).processingBalanceInPaise === 80000);
    r = await list("FAILED");
    check("M6 payout now appears in Failed tab (2)", ids(r.data.data.payouts).length === 2);

    // ═══ Reconciliation + scope ═══════════════════════════════
    let allOk = true;
    for (const a of [a1, a2, a3, a4, a5]) {
      const rowsL = await WalletLedger.collection.find({ ownerId: a.agent._id }).toArray();
      const sum = (b) => rowsL.filter((x) => x.bucket === b).reduce((s, x) => s + (x.direction === "CREDIT" ? x.amountInPaise : -x.amountInPaise), 0);
      const w = await walletDoc(a);
      if (sum("AVAILABLE") !== w.availableBalanceInPaise || sum("LOCKED") !== (w.lockedBalanceInPaise || 0) || sum("PROCESSING") !== (w.processingBalanceInPaise || 0)) allOk = false;
    }
    check("L1 every fixture wallet reconciles with its ledger (Available/Locked/Processing)", allOk);
    const stateAdmin = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    const stateToken = generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });
    check("S1 STATE admin cannot list the queue (403)", (await call(`${ADMIN}?status=REQUESTED,PROCESSING`, stateToken)).status === 403);
    check("S2 no token → 401", (await call(`${ADMIN}?status=PAID`, null)).status === 401);
    await User.deleteMany({ _id: stateAdmin._id });
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  }
  if (!SERVE) {
    await cleanup();
    const leftUsers = await User.countDocuments({ name: new RegExp(`^${P}`) }).catch(() => -1);
    console.log(results.join("\n"));
    console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL (fixture users left: ${leftUsers})`);
    process.exit(fail ? 1 : 0);
  }
};
run().catch((e) => { console.error(e); process.exit(1); });
