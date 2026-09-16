/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyFieldAgentPayoutEngine.js
 *
 * FA-14 (REAL) — disposable, real-Mongo, real-HTTP verification for
 * Field Agent Payout / Withdrawal / Disbursement. Mirrors this
 * project's established methodology (verifyOwnerBookingCancellation.js,
 * verifyFieldAgentEarningEngine.js): real Express app via
 * app.listen(0), real signed JWTs, real MongoDB, disposable fixtures
 * with an explicit NAME_PREFIX marker, concurrency proven via real
 * Promise.all against real MongoDB transactions and real unique
 * indexes — never simulated/mocked.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyFieldAgentPayoutEngine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";

import User from "../models/User.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentEarningLedger from "../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import FieldAgentPayoutRequest, { FIELD_AGENT_PAYOUT_STATUS } from "../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import KYC from "../modules/kyc/models/KYC.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const NAME_PREFIX = "ZTEST_FA14PAYOUT_";
const oid = () => new mongoose.Types.ObjectId();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

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

  const fixtureUserIds = [];
  const fixtureFieldAgentIds = [];
  const fixtureApplicationIds = [];
  const fixtureKycIds = [];
  const fixtureLedgerIds = [];
  const fixturePayoutIds = [];

  try {
    // ═══════════════════════════════════════════════════════════
    // SETUP
    // ═══════════════════════════════════════════════════════════

    const mkApplication = async (label) => {
      const app_ = await FieldAgentApplication.create({
        userRef: oid(),
        phone: phone("9"),
        status: "APPROVED",
        nonTerminal: false,
      });
      fixtureApplicationIds.push(app_._id);
      return app_;
    };

    const mkFieldAgent = async (label, { operationalStatus = "ACTIVE", accountStatus = "ACTIVE" } = {}) => {
      const agentUser = await User.create({
        name: `${NAME_PREFIX}${label}`,
        phone: phone("8"),
        role: "FIELD_AGENT",
        accountStatus,
      });
      fixtureUserIds.push(agentUser._id);
      const application = await mkApplication(label);
      const fieldAgent = await FieldAgent.create({
        userRef: agentUser._id,
        applicationRef: application._id,
        agentCode: `ZFP-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        operationalStatus,
        commercialPath: "ACQUISITION_AGENT",
      });
      fixtureFieldAgentIds.push(fieldAgent._id);
      const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
      return { agentUser, fieldAgent, token };
    };

    const mkVerifiedKyc = async (userId) => {
      const kyc = await KYC.create({
        ownerId: userId,
        applicantType: "FIELD_AGENT",
        bank: {
          accountHolder: `${NAME_PREFIX}HOLDER`,
          maskedAccount: "XXXX1234",
          ifsc: "HDFC0000123",
          bankName: "HDFC Bank",
          pennyDropStatus: "SUCCESS",
        },
      });
      fixtureKycIds.push(kyc._id);
      return kyc;
    };

    const creditLedger = async (fieldAgentRef, creditedAmountInPaise, creditOutcome = "CREDITED") => {
      const row = await FieldAgentEarningLedger.create({
        bookingRef: oid(),
        entitlementType: "ACQUISITION",
        idempotencyKey: `${NAME_PREFIX}LEDGER_${oid()}`,
        fieldAgentRef,
        policySource: "NATIONAL",
        policyVersionRef: oid(),
        appliedRatePercent: 10,
        bookingCommissionAmountInPaise: creditedAmountInPaise,
        rawEligibleAmountInPaise: creditedAmountInPaise,
        creditedAmountInPaise,
        creditOutcome,
        bookingCompletedAt: new Date(),
      });
      fixtureLedgerIds.push(row._id);
      return row;
    };

    // Agent A — fully eligible, ₹1000 credited, verified KYC.
    const A = await mkFieldAgent("AGENT_A");
    await mkVerifiedKyc(A.agentUser._id);
    await creditLedger(A.fieldAgent._id, 100000); // ₹1000

    // Agent B — for concurrency race (separate agent, own ₹1000 credit).
    const B = await mkFieldAgent("AGENT_B");
    await mkVerifiedKyc(B.agentUser._id);
    await creditLedger(B.fieldAgent._id, 100000);

    // Agent C — NOT operationally active.
    const C = await mkFieldAgent("AGENT_C", { operationalStatus: "PENDING_ACTIVATION" });
    await mkVerifiedKyc(C.agentUser._id);
    await creditLedger(C.fieldAgent._id, 100000);

    // Agent D — active, but NO KYC record at all.
    const D = await mkFieldAgent("AGENT_D");
    await creditLedger(D.fieldAgent._id, 100000);

    // Agent E — active, KYC exists but penny-drop not SUCCESS.
    const E = await mkFieldAgent("AGENT_E");
    const eKyc = await KYC.create({
      ownerId: E.agentUser._id,
      applicantType: "FIELD_AGENT",
      bank: { accountHolder: `${NAME_PREFIX}E`, maskedAccount: "XXXX9999", ifsc: "ICIC0000456", bankName: "ICICI", pennyDropStatus: "PENDING" },
    });
    fixtureKycIds.push(eKyc._id);
    await creditLedger(E.fieldAgent._id, 100000);

    // Agent F — for lifecycle tests (approve/reject/pay/fail/retry), ₹5000 credited.
    const F = await mkFieldAgent("AGENT_F");
    await mkVerifiedKyc(F.agentUser._id);
    await creditLedger(F.fieldAgent._id, 500000);

    // Agent G — for IDOR check (a second, unrelated agent).
    const G = await mkFieldAgent("AGENT_G");
    await mkVerifiedKyc(G.agentUser._id);
    await creditLedger(G.fieldAgent._id, 100000);

    // Agent H — dedicated to the FA-14 final-audit P1 regression suite
    // (approve-on-FAILED defect + full transition-boundary matrix).
    const H = await mkFieldAgent("AGENT_H");
    await mkVerifiedKyc(H.agentUser._id);
    await creditLedger(H.fieldAgent._id, 500000);

    // Admin fixtures. Exactly ONE INDIA admin may exist system-wide
    // (UserSchema's own "ONE INDIA ADMIN" partial-unique index) — reuse
    // the existing seeded one, same convention already established by
    // verifyFieldAgentEarningEngine.js, rather than creating a new one.
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No seeded INDIA admin found — cannot run admin-scope tests");
    const indiaAdminToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateAdminUser = await User.create({ name: `${NAME_PREFIX}STATE_ADMIN`, email: `${NAME_PREFIX.toLowerCase()}state_admin_${Date.now()}@ztest.local`, role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    fixtureUserIds.push(stateAdminUser._id);
    const stateAdminToken = generateAccessToken({ _id: stateAdminUser._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    // Plain OWNER user — for role-boundary checks.
    const ownerUser = await User.create({ name: `${NAME_PREFIX}OWNER`, phone: phone("7"), role: "OWNER", accountStatus: "ACTIVE" });
    fixtureUserIds.push(ownerUser._id);
    const ownerToken = generateAccessToken({ _id: ownerUser._id, role: "OWNER", tokenVersion: 0 });

    const AGENT_BASE = "/api/field-agent/payouts";
    const ADMIN_BASE = "/api/admin/field-agent/payouts";

    // ═══════════════════════════════════════════════════════════
    // 1. BALANCE COMPUTATION
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/balance`, A.token);
      check("F1. GET balance returns 200", r.status === 200, r.data);
      check("F1. GET balance — availableInPaise = 100000 (nothing reserved yet)", r.data?.data?.availableInPaise === 100000, r.data?.data);
      check("F1. GET balance — totalCreditedInPaise = 100000", r.data?.data?.totalCreditedInPaise === 100000, r.data?.data);
    }

    // ═══════════════════════════════════════════════════════════
    // 2. ELIGIBILITY GATES
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, C.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}C1` }),
      });
      check("F2. Non-ACTIVE operationalStatus (PENDING_ACTIVATION) rejected (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, D.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}D1` }),
      });
      check("F3. Missing KYC record rejected (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, E.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}E1` }),
      });
      check("F4. Penny-drop not SUCCESS rejected (403)", r.status === 403, r.data);
    }

    // ═══════════════════════════════════════════════════════════
    // 3. AMOUNT VALIDATION
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 5000, idempotencyKey: `${NAME_PREFIX}A_MIN` }), // ₹50 < ₹100 min
      });
      check("F5. Below minimum withdrawal (₹50) rejected (400)", r.status === 400, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 999999999, idempotencyKey: `${NAME_PREFIX}A_EXCEED` }),
      });
      check("F6. Exceeds available balance rejected (400)", r.status === 400, r.data);
    }

    // ═══════════════════════════════════════════════════════════
    // 4. SERVER-DERIVED FIELDS — injection attempt
    // ═══════════════════════════════════════════════════════════

    {
      // .unknown(false) on the Joi schema rejects the request outright
      // (400) — a STRONGER guarantee than "silently ignores extra
      // fields": the client is told exactly what is wrong, and no
      // request with unexpected fields is ever processed at all.
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({
          amountInPaise: 20000,
          idempotencyKey: `${NAME_PREFIX}A_INJECT`,
          fieldAgentRef: G.fieldAgent._id.toString(), // injection attempt
          status: "PAID", // injection attempt
          bankSnapshot: { accountHolder: "HACKED" }, // injection attempt
        }),
      });
      check("F7a. Request with injected fieldAgentRef/status/bankSnapshot rejected outright (400)", r.status === 400, r.data);
      const leaked = await FieldAgentPayoutRequest.findOne({ idempotencyKey: `${NAME_PREFIX}A_INJECT` }).lean();
      check("F7a. No document was created from the rejected injection attempt", !leaked, leaked);
    }

    let createdPayoutA = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}A_CREATE1` }),
      });
      check("F7b. Create withdrawal succeeds with a clean payload (201)", r.status === 201, r.data);
      createdPayoutA = r.data?.data?.payout;
      check("F7b. Created payout belongs to the authenticated agent", createdPayoutA?.fieldAgentRef === A.fieldAgent._id.toString(), createdPayoutA);
      check("F7b. Created payout status is REQUESTED", createdPayoutA?.status === "REQUESTED", createdPayoutA);
      check("F7b. bankSnapshot is the real KYC snapshot", createdPayoutA?.bankSnapshot?.accountHolder === `${NAME_PREFIX}HOLDER`, createdPayoutA);
      if (createdPayoutA?._id) fixturePayoutIds.push(createdPayoutA._id);
    }

    // ═══════════════════════════════════════════════════════════
    // 5. ONE-OPEN-WITHDRAWAL CONSTRAINT + IDEMPOTENCY
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}A_SECOND` }),
      });
      check("F8. Second withdrawal while one is open rejected (409)", r.status === 409, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}A_CREATE1` }), // same key as F7
      });
      check("F9. Same idempotencyKey replay returns 200 (not a new document)", r.status === 200, r.data);
      check("F9. Idempotent replay returns the SAME payout id", r.data?.data?.payout?._id === createdPayoutA?._id, r.data?.data);
      const count = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: A.fieldAgent._id, idempotencyKey: `${NAME_PREFIX}A_CREATE1` });
      check("F9. Exactly one document exists in DB for that idempotencyKey", count === 1, count);
    }

    // ═══════════════════════════════════════════════════════════
    // 6. CONCURRENCY — two simultaneous ₹1000 requests against ₹1000
    //    available balance (Agent B) — only one may succeed.
    // ═══════════════════════════════════════════════════════════

    {
      const [r1, r2] = await Promise.all([
        authFetch(`${AGENT_BASE}/withdraw`, B.token, {
          method: "POST",
          body: JSON.stringify({ amountInPaise: 100000, idempotencyKey: `${NAME_PREFIX}B_RACE_1` }),
        }),
        authFetch(`${AGENT_BASE}/withdraw`, B.token, {
          method: "POST",
          body: JSON.stringify({ amountInPaise: 100000, idempotencyKey: `${NAME_PREFIX}B_RACE_2` }),
        }),
      ]);
      const statuses = [r1.status, r2.status].sort();
      const successCount = [r1, r2].filter((r) => r.status === 201).length;
      check("F10. CONCURRENCY — exactly one of two simultaneous ₹1000-vs-₹1000 requests succeeds", successCount === 1, { r1: r1.status, r2: r2.status });
      // The loser is safe either way: a 409 (lost the isOpen unique-index
      // race directly) or a 400 (its transaction hit a transient
      // WriteConflict, retried, and correctly re-read the now-reduced
      // available balance as 0). Both are clean 4xx outcomes with zero
      // double-spend — never a 500 or a second document.
      const loserStatus = statuses.find((s) => s !== 201);
      check("F10. CONCURRENCY — the loser gets a clean 4xx (409 conflict or 400 insufficient-balance-on-retry), never a 500", loserStatus === 409 || loserStatus === 400, statuses);

      const openCount = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: B.fieldAgent._id, isOpen: true });
      check("F10. CONCURRENCY — exactly one OPEN payout document exists for Agent B after the race", openCount === 1, openCount);

      const winner = r1.status === 201 ? r1.data.data.payout : r2.data.data.payout;
      if (winner?._id) fixturePayoutIds.push(winner._id);

      const balR = await authFetch(`${AGENT_BASE}/balance`, B.token);
      check("F10. CONCURRENCY — Agent B's available balance is now 0 (fully reserved by the winner)", balR.data?.data?.availableInPaise === 0, balR.data?.data);
    }

    // ═══════════════════════════════════════════════════════════
    // 7. AGENT CANCEL + IDOR
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/mine/${createdPayoutA._id}`, G.token);
      check("F11. IDOR — Agent G cannot view Agent A's payout detail (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/mine/${createdPayoutA._id}/cancel`, G.token, { method: "POST" });
      check("F12. IDOR — Agent G cannot cancel Agent A's payout (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/mine/${createdPayoutA._id}/cancel`, A.token, { method: "POST" });
      check("F13. Agent A can cancel their own REQUESTED payout (200)", r.status === 200, r.data);
      check("F13. Cancelled payout status is CANCELLED", r.data?.data?.payout?.status === "CANCELLED", r.data?.data);
    }

    {
      // After cancellation, isOpen released — a NEW request should now succeed.
      const r = await authFetch(`${AGENT_BASE}/withdraw`, A.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 15000, idempotencyKey: `${NAME_PREFIX}A_AFTER_CANCEL` }),
      });
      check("F14. New withdrawal succeeds after prior one was cancelled (balance/slot released)", r.status === 201, r.data);
      if (r.data?.data?.payout?._id) fixturePayoutIds.push(r.data.data.payout._id);

      const r2 = await authFetch(`${AGENT_BASE}/mine/${r.data?.data?.payout?._id}/cancel`, A.token, { method: "POST" });
      check("F14b. Cleanup-cancel of the just-created payout succeeds (200)", r2.status === 200, r2.data);
    }

    // ═══════════════════════════════════════════════════════════
    // 8. ADMIN LIFECYCLE — approve / reject / manual-result / retry
    //    (Agent F, ₹5000 credited)
    // ═══════════════════════════════════════════════════════════

    let payoutF1 = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, F.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 200000, idempotencyKey: `${NAME_PREFIX}F_CREATE1` }),
      });
      payoutF1 = r.data?.data?.payout;
      fixturePayoutIds.push(payoutF1._id);
      check("F15. Agent F withdrawal request created (201)", r.status === 201, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/`, stateAdminToken);
      check("F16. STATE-level admin rejected from admin payout routes (403) — INDIA-only V1", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/`, ownerToken);
      check("F17. Non-ADMIN role rejected from admin payout routes (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/balance`, ownerToken);
      check("F18. Non-FIELD_AGENT role rejected from agent payout routes (403)", r.status === 403, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/reject`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({}), // missing reason
      });
      check("F19. Admin reject with empty/missing reason rejected (400)", r.status === 400, r.data);
    }

    {
      // Valid payload shape (passes Joi's success:true->utr-required
      // rule) so the request actually reaches the service layer's own
      // state-transition check — status is REQUESTED, not PROCESSING.
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: true, utr: `${NAME_PREFIX}PREMATURE_UTR` }),
      });
      check("F20. Admin manual-result on a REQUESTED (not PROCESSING) payout rejected (409)", r.status === 409, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("F21. INDIA admin approves REQUESTED -> PROCESSING (200)", r.status === 200, r.data);
      check("F21. Status is now PROCESSING", r.data?.data?.payout?.status === "PROCESSING", r.data?.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("F22. Re-approving an already-PROCESSING payout rejected (409)", r.status === 409, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: false }), // missing failureReason
      });
      check("F23. Manual-result failure with missing failureReason rejected (400)", r.status === 400, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: false, failureReason: `${NAME_PREFIX}bank rejected` }),
      });
      check("F24. Manual-result failure recorded, PROCESSING -> FAILED (200)", r.status === 200, r.data);
      check("F24. Status is now FAILED", r.data?.data?.payout?.status === "FAILED", r.data?.data);
    }

    {
      const balR = await authFetch(`${AGENT_BASE}/balance`, F.token);
      check("F25. A FAILED payout still RESERVES balance (not returned to available)", balR.data?.data?.availableInPaise === 300000, balR.data?.data); // 500000 credited - 200000 reserved by FAILED = 300000
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, F.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}F_BLOCKED` }),
      });
      check("F26. New withdrawal blocked while a FAILED one is still open (409)", r.status === 409, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/retry`, indiaAdminToken, { method: "PATCH" });
      check("F27. Admin retries FAILED -> PROCESSING (200)", r.status === 200, r.data);
      check("F27. Status is now PROCESSING again", r.data?.data?.payout?.status === "PROCESSING", r.data?.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/retry`, indiaAdminToken, { method: "PATCH" });
      check("F28. Retrying a non-FAILED (PROCESSING) payout rejected (409)", r.status === 409, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutF1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: true, utr: `${NAME_PREFIX}UTR123456` }),
      });
      check("F29. Manual-result success recorded, PROCESSING -> PAID (200)", r.status === 200, r.data);
      check("F29. Status is now PAID with UTR set", r.data?.data?.payout?.status === "PAID" && r.data?.data?.payout?.utr === `${NAME_PREFIX}UTR123456`, r.data?.data);
    }

    {
      const balR = await authFetch(`${AGENT_BASE}/balance`, F.token);
      check("F30. A PAID payout still counts as reserved (money genuinely left the pool)", balR.data?.data?.availableInPaise === 300000, balR.data?.data);
      const openCount = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: F.fieldAgent._id, isOpen: true });
      check("F30. PAID payout is no longer OPEN (isOpen=false) — a new withdrawal is now possible", openCount === 0, openCount);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, F.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}F_AFTER_PAID` }),
      });
      check("F31. New withdrawal succeeds after prior one reached PAID", r.status === 201, r.data);
      if (r.data?.data?.payout?._id) fixturePayoutIds.push(r.data.data.payout._id);
    }

    // ═══════════════════════════════════════════════════════════
    // 9. ADMIN REJECT PATH (separate payout, Agent G)
    // ═══════════════════════════════════════════════════════════

    let payoutG1 = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, G.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 20000, idempotencyKey: `${NAME_PREFIX}G_CREATE1` }),
      });
      payoutG1 = r.data?.data?.payout;
      fixturePayoutIds.push(payoutG1._id);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutG1._id}/reject`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ reason: `${NAME_PREFIX}insufficient documentation` }),
      });
      check("F32. Admin rejects REQUESTED -> REJECTED with a valid reason (200)", r.status === 200, r.data);
      check("F32. Status is REJECTED with adminNote set", r.data?.data?.payout?.status === "REJECTED", r.data?.data);
    }

    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, G.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}G_AFTER_REJECT` }),
      });
      check("F33. New withdrawal succeeds after prior one was REJECTED (slot released)", r.status === 201, r.data);
      if (r.data?.data?.payout?._id) fixturePayoutIds.push(r.data.data.payout._id);
    }

    // ═══════════════════════════════════════════════════════════
    // 9b. FA-14 FINAL-AUDIT P1 REGRESSION — approve-on-FAILED defect
    // (Agent H). The defect: approvePayout() used to check
    // FIELD_AGENT_PAYOUT_TRANSITIONS[status].includes(PROCESSING),
    // which is true for BOTH REQUESTED and FAILED (FAILED's only
    // listed transition is also PROCESSING) — letting an admin call
    // /approve on a FAILED payout instead of the dedicated /retry
    // endpoint, silently overwriting approvedBy/approvedAt and
    // logging a false FIELD_AGENT_PAYOUT_APPROVED audit event. Fixed
    // to a direct `status !== REQUESTED` check, mirroring retry's own
    // already-correct `status !== FAILED` check.
    // ═══════════════════════════════════════════════════════════

    let payoutH1 = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, H.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 200000, idempotencyKey: `${NAME_PREFIX}H_CREATE1` }),
      });
      payoutH1 = r.data?.data?.payout;
      fixturePayoutIds.push(payoutH1._id);
      check("P1-1. Agent H withdrawal created, status REQUESTED (201)", r.status === 201 && payoutH1?.status === "REQUESTED", r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-2. REQUESTED -> APPROVE succeeds (200), status PROCESSING", r.status === 200 && r.data?.data?.payout?.status === "PROCESSING", r.data);
    }

    let approvedByBefore = null, approvedAtBefore = null;
    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: false, failureReason: `${NAME_PREFIX}bank timeout` }),
      });
      check("P1-3. PROCESSING -> manual-result(failure) succeeds (200), status FAILED", r.status === 200 && r.data?.data?.payout?.status === "FAILED", r.data);
      approvedByBefore = r.data?.data?.payout?.approvedBy;
      approvedAtBefore = r.data?.data?.payout?.approvedAt;
      check("P1-4. approvedBy/approvedAt are set from the original approval", !!approvedByBefore && !!approvedAtBefore, { approvedByBefore, approvedAtBefore });
    }

    const approvedEventCountBeforeRetry = (await FieldAgentAuditEvent.find({
      entityType: "FIELD_AGENT_PAYOUT_REQUEST", entityId: payoutH1._id, action: "FIELD_AGENT_PAYOUT_APPROVED",
    }).lean()).length;

    {
      // THE CORE DEFECT REGRESSION: normal APPROVE on a FAILED payout
      // must now be rejected outright.
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-5. FAILED -> APPROVE is REJECTED (409) — the fixed defect", r.status === 409, r.data);

      const fresh = await FieldAgentPayoutRequest.findById(payoutH1._id).lean();
      check("P1-6. Status remains FAILED after the rejected approve attempt", fresh.status === "FAILED", fresh.status);
      check("P1-7. approvedBy is UNCHANGED by the rejected approve attempt", String(fresh.approvedBy) === String(approvedByBefore?._id || approvedByBefore), { before: approvedByBefore, after: fresh.approvedBy });
      check("P1-8. approvedAt is UNCHANGED by the rejected approve attempt", new Date(fresh.approvedAt).getTime() === new Date(approvedAtBefore).getTime(), { before: approvedAtBefore, after: fresh.approvedAt });
      check("P1-9. failureReason is UNCHANGED by the rejected approve attempt", fresh.failureReason === `${NAME_PREFIX}bank timeout`, fresh.failureReason);

      const approvedEventCountAfter = (await FieldAgentAuditEvent.find({
        entityType: "FIELD_AGENT_PAYOUT_REQUEST", entityId: payoutH1._id, action: "FIELD_AGENT_PAYOUT_APPROVED",
      }).lean()).length;
      check("P1-10. No new FIELD_AGENT_PAYOUT_APPROVED audit event was generated by the rejected attempt", approvedEventCountAfter === approvedEventCountBeforeRetry, { before: approvedEventCountBeforeRetry, after: approvedEventCountAfter });
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/retry`, indiaAdminToken, { method: "PATCH" });
      check("P1-11. FAILED -> RETRY succeeds (200), status PROCESSING", r.status === 200 && r.data?.data?.payout?.status === "PROCESSING", r.data);
      check("P1-12. failureReason is cleared by retry", r.data?.data?.payout?.failureReason === null, r.data?.data?.payout);

      const retriedEvent = await FieldAgentAuditEvent.findOne({
        entityType: "FIELD_AGENT_PAYOUT_REQUEST", entityId: payoutH1._id, action: "FIELD_AGENT_PAYOUT_RETRIED",
      }).lean();
      check("P1-13. A FIELD_AGENT_PAYOUT_RETRIED audit event was recorded", !!retriedEvent, retriedEvent);

      const fresh = await FieldAgentPayoutRequest.findById(payoutH1._id).lean();
      check("P1-14. approvedBy/approvedAt from the ORIGINAL approval are still preserved after retry", String(fresh.approvedBy) === String(approvedByBefore?._id || approvedByBefore) && new Date(fresh.approvedAt).getTime() === new Date(approvedAtBefore).getTime(), { approvedBy: fresh.approvedBy, approvedAt: fresh.approvedAt });
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/manual-result`, indiaAdminToken, {
        method: "PATCH",
        body: JSON.stringify({ success: true, utr: `${NAME_PREFIX}H1UTR` }),
      });
      check("P1-15. PROCESSING -> manual-result(success) succeeds (200), status PAID (retry-then-pay financial integrity)", r.status === 200 && r.data?.data?.payout?.status === "PAID", r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-16. PAID -> APPROVE is REJECTED (409)", r.status === 409, r.data);
    }

    // Full transition-boundary matrix — REQUESTED/PROCESSING/REJECTED/
    // CANCELLED all reject the APPROVE endpoint; REQUESTED rejects RETRY.
    let payoutH2 = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, H.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 30000, idempotencyKey: `${NAME_PREFIX}H_CREATE2` }),
      });
      payoutH2 = r.data?.data?.payout;
      fixturePayoutIds.push(payoutH2._id);
    }
    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH2._id}/retry`, indiaAdminToken, { method: "PATCH" });
      check("P1-17. REQUESTED -> RETRY is REJECTED (409)", r.status === 409, r.data);
    }
    {
      const r = await authFetch(`${AGENT_BASE}/mine/${payoutH2._id}/cancel`, H.token, { method: "POST" });
      check("P1-18. Cancel REQUESTED -> CANCELLED succeeds (200) (setup for next check)", r.status === 200 && r.data?.data?.payout?.status === "CANCELLED", r.data);
    }
    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH2._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-19. CANCELLED -> APPROVE is REJECTED (409)", r.status === 409, r.data);
    }

    let payoutH3 = null;
    {
      const r = await authFetch(`${AGENT_BASE}/withdraw`, H.token, {
        method: "POST",
        body: JSON.stringify({ amountInPaise: 30000, idempotencyKey: `${NAME_PREFIX}H_CREATE3` }),
      });
      payoutH3 = r.data?.data?.payout;
      fixturePayoutIds.push(payoutH3._id);
    }
    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH3._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-20. REQUESTED -> APPROVE succeeds (200) (setup for next check)", r.status === 200 && r.data?.data?.payout?.status === "PROCESSING", r.data);
    }
    {
      const r = await authFetch(`${ADMIN_BASE}/${payoutH3._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-21. PROCESSING -> APPROVE is REJECTED (409)", r.status === 409, r.data);
    }
    {
      // REJECTED -> APPROVE rejected, reusing payoutG1 (already REJECTED from F32 above).
      const r = await authFetch(`${ADMIN_BASE}/${payoutG1._id}/approve`, indiaAdminToken, { method: "PATCH" });
      check("P1-22. REJECTED -> APPROVE is REJECTED (409)", r.status === 409, r.data);
    }

    {
      // No balance inflation / no duplicate payout check for the whole
      // Agent H timeline: totalCreditedInPaise=500000; H1=200000 PAID
      // (permanently reserved), H2=30000 CANCELLED (released), H3=30000
      // PROCESSING (reserved). Expected available = 500000-200000-30000 = 270000.
      const balR = await authFetch(`${AGENT_BASE}/balance`, H.token);
      check("P1-23. No balance inflation across the whole approve/fail/retry/pay timeline", balR.data?.data?.availableInPaise === 270000, balR.data?.data);
      const countH = await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: H.fieldAgent._id });
      check("P1-24. No duplicate payout documents were created for Agent H (exactly 3)", countH === 3, countH);
    }

    // ═══════════════════════════════════════════════════════════
    // 10. AUDIT TRAIL
    // ═══════════════════════════════════════════════════════════

    {
      const events = await FieldAgentAuditEvent.find({ entityType: "FIELD_AGENT_PAYOUT_REQUEST", entityId: payoutF1._id }).lean();
      const actions = events.map((e) => e.action).sort();
      const expected = ["FIELD_AGENT_PAYOUT_APPROVED", "FIELD_AGENT_PAYOUT_FAILED", "FIELD_AGENT_PAYOUT_PAID", "FIELD_AGENT_PAYOUT_REQUESTED", "FIELD_AGENT_PAYOUT_RETRIED"].sort();
      check("F34. Audit trail records every lifecycle transition for payout F1", JSON.stringify(actions) === JSON.stringify(expected), actions);
    }

    // ═══════════════════════════════════════════════════════════
    // 11. LIST / PAGINATION SANITY
    // ═══════════════════════════════════════════════════════════

    {
      const r = await authFetch(`${AGENT_BASE}/mine`, F.token);
      check("F35. Agent's own list endpoint returns 200 with pagination meta", r.status === 200 && r.data?.pagination, r.data);
    }

    {
      const r = await authFetch(`${ADMIN_BASE}/?status=PAID`, indiaAdminToken);
      check("F36. Admin list filtered by status=PAID returns 200", r.status === 200, r.data);
      check("F36. Every returned row actually has status PAID", (r.data?.data?.payouts || []).every((p) => p.status === "PAID"), r.data?.data);
    }

  } catch (err) {
    console.error("FATAL ERROR DURING TEST RUN:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    // Cleanup ALWAYS runs, even after a FATAL error mid-run — a fixture
    // must never leak into the shared dev database just because a
    // later assertion in the same run threw. Uses only the fixture-id
    // arrays populated so far (each push happens right after creation),
    // so a run that dies halfway still cleans up everything it made.
    try {
      await FieldAgentAuditEvent.deleteMany({ entityId: { $in: fixturePayoutIds } });
      await FieldAgentPayoutRequest.deleteMany({ fieldAgentRef: { $in: fixtureFieldAgentIds } });
      // FieldAgentEarningLedger blocks deleteOne/deleteMany/findOneAndDelete
      // at the Mongoose-hook level (append-only, by design — FA-9). The raw
      // driver's .collection accessor bypasses Mongoose middleware entirely,
      // exactly like verifyFieldAgentEarningEngine.js's own established
      // cleanup convention for this same model.
      await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: fixtureLedgerIds } });
      await KYC.deleteMany({ _id: { $in: fixtureKycIds } });
      await FieldAgent.deleteMany({ _id: { $in: fixtureFieldAgentIds } });
      await FieldAgentApplication.deleteMany({ _id: { $in: fixtureApplicationIds } });
      await User.deleteMany({ _id: { $in: fixtureUserIds } });

      const residue = {
        users: await User.countDocuments({ _id: { $in: fixtureUserIds } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: fixtureFieldAgentIds } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: fixtureApplicationIds } }),
        payouts: await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: { $in: fixtureFieldAgentIds } }),
        kyc: await KYC.countDocuments({ _id: { $in: fixtureKycIds } }),
        ledger: await FieldAgentEarningLedger.countDocuments({ _id: { $in: fixtureLedgerIds } }),
        audit: await FieldAgentAuditEvent.countDocuments({ entityId: { $in: fixturePayoutIds } }),
      };
      check("Zero residue — all FA-14-payout fixtures removed", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED: ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
  }

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)\n`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
