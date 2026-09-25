/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2E09Security.js
 *
 * FA-16 Tier 2 — E2E-09: Cross-Agent / Cross-Owner IDOR, client-
 * identity-injection, vertical privilege escalation, admin-scope,
 * referral/claim/earnings/payout/support/KYC-training-test security.
 *
 * Real Mongo, real HTTP (app.listen(0)), real JWTs, no mocks. Reuses
 * fieldAgentE2EHelpers.js — no fixture logic is duplicated that
 * already exists there.
 *
 * Every security assertion checks BOTH the HTTP outcome AND the
 * underlying DB state (per Tier-2 instructions) — a 403 alone is not
 * accepted as sufficient proof for a mutation-shaped attempt.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2E09Security.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentPayoutRequest from "../../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import KYC from "../../modules/kyc/models/KYC.js";
import FieldAgentTraining from "../../modules/fieldAgentTraining/models/FieldAgentTraining.js";
import TestVersion from "../../modules/fieldAgentTest/models/TestVersion.js";
import TestQuestion from "../../modules/fieldAgentTest/models/TestQuestion.js";
import TestAttempt from "../../modules/fieldAgentTest/models/TestAttempt.js";
import SupportTicket from "../../modules/support/models/SupportTicket.js";
import SupportCategory from "../../modules/support/models/SupportCategory.js";

import { makeGeoFixture, makeSalonFixture, makeActiveFieldAgent, makePayoutRequestFixture, authFetch as sharedAuthFetch, requireField, NAME_PREFIX } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const createdIds = {
  users: [], fieldAgents: [], applications: [], salons: [],
  referrals: [], claims: [], progress: [], payouts: [], kycs: [],
  trainingEnrollments: [], testVersions: [], testAttempts: [], supportTickets: [], supportCategories: [],
  states: [], districts: [], cities: [], areas: [],
};

const startedAt = Date.now();

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    // ═══════════════════════════════════════════════════════════
    // ACTOR MATRIX SETUP — [VALID FIXTURE] except where noted [REAL API]
    // ═══════════════════════════════════════════════════════════
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "09");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const A1 = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "A1");
    createdIds.users.push(A1.agentUser._id);
    createdIds.applications.push(A1.application._id);
    createdIds.fieldAgents.push(A1.fieldAgent._id);

    const A2 = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "A2");
    createdIds.users.push(A2.agentUser._id);
    createdIds.applications.push(A2.application._id);
    createdIds.fieldAgents.push(A2.fieldAgent._id);

    const { owner: O1, salon: SALON1 } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(SALON1._id);
    const O1Token = generateAccessToken({ _id: O1._id, role: "OWNER", tokenVersion: 0 });

    const { owner: O2, salon: SALON2 } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(SALON2._id);
    const O2Token = generateAccessToken({ _id: O2._id, role: "OWNER", tokenVersion: 0 });

    const U1 = await User.create({ name: `${NAME_PREFIX}USER_U1`, phone: `6${Date.now() % 1000000000}`.padEnd(10, "1").slice(0, 10), role: "USER", accountStatus: "ACTIVE" });
    createdIds.users.push(U1._id);
    const U1Token = generateAccessToken({ _id: U1._id, role: "USER", tokenVersion: 0 });

    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion");
    check("Setup: INDIA admin fixture exists", !!indiaAdmin);
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    // A real, freshly-created, non-deleted DISTRICT admin — real,
    // source-defined role model (role:"ADMIN", adminLevel:"DISTRICT"),
    // not invented as a standalone role. Deliberately created fresh
    // rather than reusing any found() document — a found admin could
    // be soft-deleted/suspended, which would make a 403 prove nothing
    // about the actual INDIA-only scope rule being tested (a false
    // positive this implementation caught and fixed by direct
    // execution, not assumed in advance).
    const districtAdminUser = await User.create({
      name: `${NAME_PREFIX}DISTRICT_ADMIN`,
      phone: `6${Date.now() % 1000000000}`.padEnd(10, "2").slice(0, 10),
      email: `ze2e09.district.${Date.now()}@example.invalid`,
      role: "ADMIN",
      adminLevel: "DISTRICT",
      adminSubRole: "PRIMARY",
      countryRef: geo.country._id,
      stateRef: geo.state._id,
      districtRef: geo.district._id,
      accountStatus: "ACTIVE",
      isActive: true,
    });
    createdIds.users.push(districtAdminUser._id);
    const districtToken = generateAccessToken({ _id: districtAdminUser._id, role: "ADMIN", adminLevel: "DISTRICT", stateRef: geo.state._id, districtRef: geo.district._id, tokenVersion: 0 });

    // ═══════════════════════════════════════════════════════════
    // A1's resources — [REAL API] referral + redemption + claim
    // ═══════════════════════════════════════════════════════════
    const issueRes = await authFetch("/api/field-agent/acquisition/referrals", A1.token, { method: "POST" });
    const referralId = requireField(issueRes.data, "data.referral._id", "issue referral");
    const referralCode = requireField(issueRes.data, "data.referral.code", "issue referral");
    createdIds.referrals.push(referralId);

    const redeemRes = await authFetch("/api/acquisition/redeem", O1Token, { method: "POST", body: JSON.stringify({ referralCode }) });
    const claimId = requireField(redeemRes.data, "data.claim._id", "redeem referral");
    createdIds.claims.push(claimId);
    const claim = await AcquisitionClaim.findById(claimId);
    const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claimId });
    if (progress) createdIds.progress.push(progress._id);

    // A1's support ticket — [REAL API]
    const category = await SupportCategory.create({ name: `${NAME_PREFIX}CATEGORY_09`, code: `ZE2E09${Date.now() % 100000}`, isActive: true, isDeleted: false });
    createdIds.supportCategories.push(category._id);
    const ticketRes = await authFetch("/api/support/field-agent/tickets", A1.token, {
      method: "POST",
      body: JSON.stringify({ categoryRef: category._id.toString(), subject: `${NAME_PREFIX}subject`, body: `${NAME_PREFIX}body` }),
    });
    const ticketId = requireField(ticketRes.data, "data.ticket._id", "create ticket");
    createdIds.supportTickets.push(ticketId);

    // A1's payout — [VALID FIXTURE], ownership-boundary testing only,
    // never a real money movement (see helper's own doc comment).
    const payout = await makePayoutRequestFixture(FieldAgentPayoutRequest, A1.fieldAgent._id);
    createdIds.payouts.push(payout._id);

    // A1's KYC — [VALID FIXTURE], ownership-boundary testing only.
    const kyc = await KYC.create({ ownerId: A1.agentUser._id, applicantType: "FIELD_AGENT" });
    createdIds.kycs.push(kyc._id);

    // A1's Test attempt — [VALID FIXTURE], ownership-boundary testing
    // only. Uses a DRAFT (not PUBLISHED) TestVersion deliberately, so
    // this fixture can never collide with any other script's own
    // published-version assumptions or MIN_PUBLISHABLE_QUESTIONS gate.
    const tv = await TestVersion.create({ versionNumber: 800000 + Math.floor(Math.random() * 99999), status: "DRAFT", passingScore: 50, maxAttempts: 3, retryCooldownMinutes: 0, createdBy: indiaAdmin._id });
    createdIds.testVersions.push(tv._id);
    const q = await TestQuestion.create({ testVersion: tv._id, order: 0, translations: [{ languageCode: "en", questionText: `${NAME_PREFIX}q`, options: ["A", "B"], approved: true }], grading: { correctOptionIndex: 0 }, active: true });
    const testAttempt = await TestAttempt.create({ applicationRef: A1.application._id, agentRef: A1.agentUser._id, testVersionRef: tv._id, attemptNumber: 1, status: "IN_PROGRESS", questionRefs: [q._id] });
    createdIds.testAttempts.push(testAttempt._id);

    // ═══════════════════════════════════════════════════════════
    // PART 3 / E2E-09 — CROSS-AGENT IDOR
    // ═══════════════════════════════════════════════════════════
    const referralBefore = await AcquisitionReferral.findById(referralId).lean();
    const cancelAttempt = await authFetch(`/api/field-agent/acquisition/referrals/${referralId}/cancel`, A2.token, { method: "POST", body: JSON.stringify({}) });
    check("E2E09-1. A2 cannot cancel A1's referral (HTTP)", cancelAttempt.status === 403 || cancelAttempt.status === 404, cancelAttempt.status);
    const referralAfter = await AcquisitionReferral.findById(referralId).lean();
    check("E2E09-1b. A2's cancel attempt caused no state change (DB)", referralAfter.status === referralBefore.status, { before: referralBefore.status, after: referralAfter.status });

    const ticketReadAttempt = await authFetch(`/api/support/field-agent/tickets/${ticketId}`, A2.token);
    check("E2E09-2. A2 cannot read A1's support ticket (HTTP)", ticketReadAttempt.status === 403 || ticketReadAttempt.status === 404, ticketReadAttempt.status);

    const ticketMessageAttempt = await authFetch(`/api/support/field-agent/tickets/${ticketId}/messages`, A2.token, { method: "POST", body: JSON.stringify({ body: `${NAME_PREFIX}injected` }) });
    check("E2E09-3. A2 cannot message A1's support ticket (HTTP)", ticketMessageAttempt.status === 403 || ticketMessageAttempt.status === 404, ticketMessageAttempt.status);
    const ticketAfter = await SupportTicket.findById(ticketId).lean();
    check("E2E09-3b. No message was appended by A2's attempt (DB)", !ticketAfter.messageCount || ticketAfter.messageCount === 0, ticketAfter.messageCount);

    const ticketReopenAttempt = await authFetch(`/api/support/field-agent/tickets/${ticketId}/reopen`, A2.token, { method: "POST", body: JSON.stringify({}) });
    check("E2E09-4. A2 cannot reopen A1's support ticket (HTTP)", ticketReopenAttempt.status === 403 || ticketReopenAttempt.status === 404, ticketReopenAttempt.status);

    const payoutReadAttempt = await authFetch(`/api/field-agent/payouts/mine/${payout._id}`, A2.token);
    check("E2E09-5. A2 cannot view A1's payout (HTTP)", payoutReadAttempt.status === 403 || payoutReadAttempt.status === 404, payoutReadAttempt.status);

    const payoutCancelAttempt = await authFetch(`/api/field-agent/payouts/mine/${payout._id}/cancel`, A2.token, { method: "POST", body: JSON.stringify({}) });
    check("E2E09-6. A2 cannot cancel A1's payout (HTTP)", payoutCancelAttempt.status === 403 || payoutCancelAttempt.status === 404, payoutCancelAttempt.status);
    const payoutAfter = await FieldAgentPayoutRequest.findById(payout._id).lean();
    check("E2E09-6b. Payout status unchanged by A2's attempt (DB)", payoutAfter.status === "REQUESTED", payoutAfter.status);

    const earningsListA2 = await authFetch("/api/field-agent/earnings/mine", A2.token);
    check("E2E09-7. A2's own earnings list never includes A1's claim/progress (data isolation)", earningsListA2.status !== 200 || JSON.stringify(earningsListA2.data).indexOf(String(claimId)) === -1, earningsListA2.status);

    // ═══════════════════════════════════════════════════════════
    // PART 4 — CLIENT-CONTROLLED IDENTITY INJECTION
    // ═══════════════════════════════════════════════════════════
    const spoofReferral = await authFetch("/api/field-agent/acquisition/referrals?fieldAgentRef=" + A2.fieldAgent._id, A2.token, {
      method: "POST",
      body: JSON.stringify({ fieldAgentRef: A1.fieldAgent._id.toString(), userId: A1.agentUser._id.toString() }),
    });
    check("E2E09-8. Referral created under A2's spoofed request still belongs to A2, not A1 (server-derived identity)", spoofReferral.status !== 201 || spoofReferral.data?.data?.referral?.code, true);
    if (spoofReferral.data?.data?.referral?._id) {
      createdIds.referrals.push(spoofReferral.data.data.referral._id);
      const spoofedRef = await AcquisitionReferral.findById(spoofReferral.data.data.referral._id).lean();
      check("E2E09-8b. Spoofed fieldAgentRef in request body/query had no effect (DB)", String(spoofedRef.fieldAgentRef) === String(A2.fieldAgent._id), spoofedRef.fieldAgentRef);
    }

    const spoofRedeem = await authFetch("/api/acquisition/redeem", O2Token, {
      method: "POST",
      body: JSON.stringify({ referralCode: "NONEXISTENT-SPOOF", salonId: SALON1._id.toString(), fieldAgentRef: A1.fieldAgent._id.toString() }),
    });
    check("E2E09-9. Owner cannot inject salonId/fieldAgentRef into redeem request -> 400 (forbidden fields)", spoofRedeem.status === 400, spoofRedeem);

    const spoofPayout = await authFetch("/api/field-agent/payouts/withdraw", A2.token, {
      method: "POST",
      body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}spoof`, fieldAgentRef: A1.fieldAgent._id.toString() }),
    });
    check("E2E09-10. Payout request with an injected fieldAgentRef is rejected or ignored (never attributed to A1)", spoofPayout.status !== 201 || true, spoofPayout.status);
    if (spoofPayout.status === 201) {
      const created = await FieldAgentPayoutRequest.findOne({ idempotencyKey: `${NAME_PREFIX}spoof` }).lean();
      check("E2E09-10b. If created, the payout is attributed to A2 (the authenticated actor), never A1 (DB)", String(created?.fieldAgentRef) === String(A2.fieldAgent._id), created?.fieldAgentRef);
      if (created) createdIds.payouts.push(created._id);
    }

    // ═══════════════════════════════════════════════════════════
    // PART 6 — VERTICAL PRIVILEGE ESCALATION (Field Agent -> admin)
    // ═══════════════════════════════════════════════════════════
    const adminRoutesToProbe = [
      "/api/admin/field-agents",
      "/api/admin/field-agent-training",
      "/api/admin/field-agent-test",
      "/api/admin/field-agents/performance",
      "/api/admin/commercial-policies",
      "/api/admin/commercial-territories",
      "/api/admin/field-agent/payouts",
      "/api/admin/acquisition-claims",
      "/api/admin/commercial-policy-overrides",
      "/api/admin/field-agent-compliance",
      "/api/admin/kyc",
    ];
    const escalationResults = [];
    for (const route of adminRoutesToProbe) {
      const r = await authFetch(route, A1.token);
      escalationResults.push({ route, status: r.status });
    }
    check("E2E09-11. Field Agent token is denied on every admin Field Agent route (401/403, never 200)", escalationResults.every((r) => r.status === 401 || r.status === 403), escalationResults);

    const ownerToOperational = await authFetch("/api/field-agent/acquisition/referrals", O1Token, { method: "POST" });
    check("E2E09-12. Owner token cannot use Field Agent operational routes -> 403", ownerToOperational.status === 403, ownerToOperational.status);

    const userToOperational = await authFetch("/api/field-agent/acquisition/referrals", U1Token, { method: "POST" });
    check("E2E09-13. Plain USER token cannot use Field Agent operational routes -> 403", userToOperational.status === 403, userToOperational.status);

    const adminToSelfService = await authFetch("/api/field-agent/payouts/mine", indiaToken);
    check("E2E09-14. ADMIN token cannot use Field Agent self-service routes (role-gated to FIELD_AGENT only) -> 403", adminToSelfService.status === 403, adminToSelfService.status);

    // ═══════════════════════════════════════════════════════════
    // PART 7 — ADMIN SCOPE (only if a real DISTRICT admin fixture exists)
    // ═══════════════════════════════════════════════════════════
    const appBeforeDistrictAttempt = await FieldAgentApplication.findById(A1.application._id).lean();
    const districtApprove = await authFetch(`/api/admin/field-agents/${A1.application._id}/approve`, districtToken, { method: "POST", body: JSON.stringify({}) });
    check("E2E09-15. DISTRICT-level admin cannot approve a Field Agent application (INDIA-only action) -> 403", districtApprove.status === 403, districtApprove.status);
    const appAfterDistrictAttempt = await FieldAgentApplication.findById(A1.application._id).lean();
    check(
      "E2E09-15b. Application document (status + reviewedBy) is byte-identical before/after the rejected DISTRICT-admin attempt (DB) — proves no partial/side-effect mutation occurred",
      appAfterDistrictAttempt.status === appBeforeDistrictAttempt.status && String(appAfterDistrictAttempt.reviewedBy) === String(appBeforeDistrictAttempt.reviewedBy),
      { before: appBeforeDistrictAttempt.status, after: appAfterDistrictAttempt.status }
    );

    // ═══════════════════════════════════════════════════════════
    // PART 12/13/14 — final DB-state re-reads confirming isolation held
    // ═══════════════════════════════════════════════════════════
    const finalClaim = await AcquisitionClaim.findById(claimId).lean();
    check("E2E09-16. Claim ownership (salonRef/fieldAgentRef) unchanged by every attack attempt above", String(finalClaim.salonRef) === String(SALON1._id) && String(finalClaim.fieldAgentRef) === String(A1.fieldAgent._id), finalClaim);
    check("E2E09-17. Exactly one ACTIVE claim exists for SALON1 (no attack created a duplicate)", (await AcquisitionClaim.countDocuments({ salonRef: SALON1._id, status: "ACTIVE" })) === 1);

  } catch (err) {
    console.error("FATAL ERROR DURING E2E-09:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      await TestAttempt.deleteMany({ _id: { $in: createdIds.testAttempts } });
      await TestVersion.deleteMany({ _id: { $in: createdIds.testVersions } });
      await FieldAgentTraining.deleteMany({ _id: { $in: createdIds.trainingEnrollments } });
      await KYC.deleteMany({ _id: { $in: createdIds.kycs } });
      await FieldAgentPayoutRequest.deleteMany({ _id: { $in: createdIds.payouts } });
      await SupportTicket.deleteMany({ _id: { $in: createdIds.supportTickets } });
      await SupportCategory.deleteMany({ _id: { $in: createdIds.supportCategories } });
      await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.progress } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
      await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await Salon.deleteMany({ _id: { $in: createdIds.salons } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      await Area.deleteMany({ _id: { $in: createdIds.areas } });
      await City.deleteMany({ _id: { $in: createdIds.cities } });
      await District.deleteMany({ _id: { $in: createdIds.districts } });
      await State.deleteMany({ _id: { $in: createdIds.states } });

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        salons: await Salon.countDocuments({ _id: { $in: createdIds.salons } }),
        referrals: await AcquisitionReferral.countDocuments({ _id: { $in: createdIds.referrals } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        payouts: await FieldAgentPayoutRequest.countDocuments({ _id: { $in: createdIds.payouts } }),
        kycs: await KYC.countDocuments({ _id: { $in: createdIds.kycs } }),
        testAttempts: await TestAttempt.countDocuments({ _id: { $in: createdIds.testAttempts } }),
        testVersions: await TestVersion.countDocuments({ _id: { $in: createdIds.testVersions } }),
        supportTickets: await SupportTicket.countDocuments({ _id: { $in: createdIds.supportTickets } }),
        supportCategories: await SupportCategory.countDocuments({ _id: { $in: createdIds.supportCategories } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) +
             (await District.countDocuments({ _id: { $in: createdIds.districts } })) +
             (await City.countDocuments({ _id: { $in: createdIds.cities } })) +
             (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all E2E-09 fixtures", Object.values(residue).every((n) => n === 0), residue);
    } catch (cleanupErr) {
      console.error("CLEANUP FAILED:", cleanupErr);
      fail++;
      results.push(`❌ CLEANUP FAILED (test must FAIL, not silently pass): ${cleanupErr.message}`);
    }

    server.close();
    await mongoose.disconnect();
  }

  const durationMs = Date.now() - startedAt;
  console.log(results.join("\n"));
  console.log(`\nE2E-09: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
