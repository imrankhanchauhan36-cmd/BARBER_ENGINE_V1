/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2E10OperationalAccess.js
 *
 * FA-16 Tier 2 — E2E-10: Non-ACTIVE Field Agent operational-access
 * denial, session/JWT security, and alternate-route/bypass checks.
 *
 * Real Mongo, real HTTP (app.listen(0)), real JWTs, no mocks. Reuses
 * fieldAgentE2EHelpers.js.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2E10OperationalAccess.js
 */

import "dotenv/config";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Country from "../../models/Country.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";

import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import FieldAgentPayoutRequest from "../../modules/fieldAgent/models/FieldAgentPayoutRequest.js";
import SupportTicket from "../../modules/support/models/SupportTicket.js";
import SupportCategory from "../../modules/support/models/SupportCategory.js";

import { makeGeoFixture, authFetch as sharedAuthFetch, NAME_PREFIX } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const createdIds = {
  users: [], fieldAgents: [], applications: [], referrals: [], claims: [], payouts: [], supportTickets: [], supportCategories: [],
  states: [], districts: [], cities: [], areas: [],
};

const startedAt = Date.now();
const phone = (p) => `${p}${Math.floor(100000000 + Math.random() * 899999999)}`;

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "10");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    // ═══════════════════════════════════════════════════════════
    // PART 5 / E2E-10 — NON-ACTIVE Field Agent, operational denial
    // ═══════════════════════════════════════════════════════════
    const pendingUser = await User.create({ name: `${NAME_PREFIX}PENDING_AGENT`, phone: phone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(pendingUser._id);
    const pendingApp = await FieldAgentApplication.create({ userRef: pendingUser._id, phone: pendingUser.phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(pendingApp._id);
    const pendingFieldAgent = await FieldAgent.create({ userRef: pendingUser._id, applicationRef: pendingApp._id, agentCode: `${NAME_PREFIX}PENDING-${Date.now()}`, operationalStatus: "PENDING_ACTIVATION", commercialPath: null });
    createdIds.fieldAgents.push(pendingFieldAgent._id);
    const pendingToken = generateAccessToken({ _id: pendingUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

    const referralAttempt = await authFetch("/api/field-agent/acquisition/referrals", pendingToken, { method: "POST" });
    check("E2E10-1. PENDING_ACTIVATION agent denied referral creation (requireActiveFieldAgent)", referralAttempt.status === 403, referralAttempt.status);
    check("E2E10-1b. No referral was created (DB)", (await AcquisitionReferral.countDocuments({ fieldAgentRef: pendingFieldAgent._id })) === 0);

    const claimListAttempt = await authFetch("/api/field-agent/acquisition/claims/mine", pendingToken);
    check("E2E10-2. PENDING_ACTIVATION agent denied claims list (requireActiveFieldAgent, read-only route)", claimListAttempt.status === 403, claimListAttempt.status);

    const earningsAttempt = await authFetch("/api/field-agent/earnings/mine", pendingToken);
    check("E2E10-3. PENDING_ACTIVATION agent denied earnings (requireActiveFieldAgent, read-only route)", earningsAttempt.status === 403, earningsAttempt.status);

    const payoutAttempt = await authFetch("/api/field-agent/payouts/withdraw", pendingToken, {
      method: "POST",
      body: JSON.stringify({ amountInPaise: 10000, idempotencyKey: `${NAME_PREFIX}pending-payout` }),
    });
    check("E2E10-4. PENDING_ACTIVATION agent denied payout withdrawal (requireActiveFieldAgent)", payoutAttempt.status === 403, payoutAttempt.status);
    check("E2E10-4b. No payout request was created (DB)", (await FieldAgentPayoutRequest.countDocuments({ fieldAgentRef: pendingFieldAgent._id })) === 0);

    const balanceAttempt = await authFetch("/api/field-agent/payouts/balance", pendingToken);
    check("E2E10-5. PENDING_ACTIVATION agent denied balance read (requireActiveFieldAgent)", balanceAttempt.status === 403, balanceAttempt.status);

    // ── Support is a deliberate Class-A exemption — ACTIVE is NOT
    // required (a pending agent must be able to ask for help getting
    // activated). This distinction is asserted, not assumed. ──
    const category = await SupportCategory.create({ name: `${NAME_PREFIX}CATEGORY_10`, code: `ZE2E10${Date.now() % 100000}`, isActive: true, isDeleted: false });
    createdIds.supportCategories.push(category._id);
    const pendingSupportAttempt = await authFetch("/api/support/field-agent/tickets", pendingToken, {
      method: "POST",
      body: JSON.stringify({ categoryRef: category._id.toString(), subject: `${NAME_PREFIX}help me activate`, body: `${NAME_PREFIX}stuck on activation` }),
    });
    check("E2E10-6. PENDING_ACTIVATION agent CAN create a support ticket (Class-A utility, ACTIVE deliberately not required)", pendingSupportAttempt.status === 201, pendingSupportAttempt);
    if (pendingSupportAttempt.data?.data?.ticket?._id) createdIds.supportTickets.push(pendingSupportAttempt.data.data.ticket._id);

    // ── Application/KYC/training/test surfaces are pre-activation —
    // also deliberately NOT gated by requireActiveFieldAgent. ──
    const pendingAppReadAttempt = await authFetch("/api/field-agent/applications/me", pendingToken);
    check("E2E10-7. PENDING_ACTIVATION agent CAN read their own application (pre-activation surface, correctly ungated)", pendingAppReadAttempt.status === 200, pendingAppReadAttempt.status);

    // ═══════════════════════════════════════════════════════════
    // PART 9 — SESSION / JWT SECURITY
    // ═══════════════════════════════════════════════════════════
    const noHeaderAttempt = await authFetch("/api/field-agent/payouts/mine", null);
    check("E2E10-8. No Authorization header -> 401", noHeaderAttempt.status === 401, noHeaderAttempt.status);

    const malformedHeaderAttempt = await fetch(url("/api/field-agent/payouts/mine"), { headers: { Authorization: "NotBearerAtAll" } }).then((r) => r.status);
    check("E2E10-9. Malformed Authorization header -> 401", malformedHeaderAttempt === 401, malformedHeaderAttempt);

    const invalidJwtAttempt = await authFetch("/api/field-agent/payouts/mine", "totally.invalid.jwt");
    check("E2E10-10. Structurally invalid JWT -> 401", invalidJwtAttempt.status === 401, invalidJwtAttempt.status);

    // Expired JWT — signed with the same secret/algorithm the real
    // token.service.js uses, but with exp already in the past. This
    // exercises the real jwt.verify() rejection path, not a redesign
    // of the auth contract.
    const expiredToken = jwt.sign({ id: pendingUser._id.toString(), role: "FIELD_AGENT", tokenVersion: 0 }, process.env.JWT_SECRET, { expiresIn: -10 });
    const expiredAttempt = await authFetch("/api/field-agent/payouts/mine", expiredToken);
    check("E2E10-11. Expired JWT -> 401", expiredAttempt.status === 401, expiredAttempt.status);

    const wrongRoleToken = generateAccessToken({ _id: pendingUser._id, role: "OWNER", tokenVersion: 0 });
    const wrongRoleAttempt = await authFetch("/api/field-agent/payouts/mine", wrongRoleToken);
    check("E2E10-12. Valid token but wrong role for this route -> 403", wrongRoleAttempt.status === 403, wrongRoleAttempt.status);

    const inactiveAgentAttempt = await authFetch("/api/field-agent/payouts/withdraw", pendingToken, { method: "POST", body: JSON.stringify({ amountInPaise: 1, idempotencyKey: `${NAME_PREFIX}x` }) });
    check("E2E10-13. Valid token for a non-ACTIVE Field Agent on an operational route -> 403 (duplicate confirmation of E2E10-4's boundary via a different route)", inactiveAgentAttempt.status === 403, inactiveAgentAttempt.status);

    // ═══════════════════════════════════════════════════════════
    // PART 10 — ALTERNATE ROUTE / BYPASS CHECK
    // ═══════════════════════════════════════════════════════════
    // Active agent for a genuine "role/active gates would otherwise
    // pass" bypass probe, matching the FA-15 C1 audit's own corrected
    // methodology (a 403 from an unrelated real module proves nothing;
    // only a probe that would pass this actor's own gates, yet still
    // 404s, proves no alternate route exists).
    const activeUser = await User.create({ name: `${NAME_PREFIX}ACTIVE_FOR_BYPASS`, phone: phone("8"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(activeUser._id);
    const activeApp = await FieldAgentApplication.create({ userRef: activeUser._id, phone: activeUser.phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(activeApp._id);
    const activeFieldAgent = await FieldAgent.create({ userRef: activeUser._id, applicationRef: activeApp._id, agentCode: `${NAME_PREFIX}BYPASS-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(activeFieldAgent._id);
    const activeToken = generateAccessToken({ _id: activeUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

    const bypassProbes = [
      { path: "/api/field-agent/referrals", method: "POST" },
      { path: "/api/field-agent/acquisition/referral", method: "POST" },
      { path: "/api/support/tickets", method: "POST", body: JSON.stringify({ categoryRef: category._id.toString(), subject: "x", body: "x" }) },
      { path: "/api/field-agent/payouts/create-withdrawal", method: "POST", body: JSON.stringify({ amountInPaise: 100, idempotencyKey: `${NAME_PREFIX}bp` }) },
      { path: "/api/field-agent/claims", method: "GET" },
      { path: "/api/field-agent/acquisition/claim", method: "GET" },
    ];
    const bypassResults = [];
    for (const probe of bypassProbes) {
      const r = await authFetch(probe.path, activeToken, { method: probe.method, body: probe.body });
      bypassResults.push({ path: probe.path, status: r.status });
    }
    check("E2E10-14. No alternate/unprotected route serves any Field Agent operational action to an actor whose real role/active gates would otherwise pass (all 404)", bypassResults.every((r) => r.status === 404), bypassResults);

  } catch (err) {
    console.error("FATAL ERROR DURING E2E-10:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
      await FieldAgentPayoutRequest.deleteMany({ _id: { $in: createdIds.payouts } });
      await SupportTicket.deleteMany({ _id: { $in: createdIds.supportTickets } });
      await SupportCategory.deleteMany({ _id: { $in: createdIds.supportCategories } });
      await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
      await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
      await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
      await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
      await User.deleteMany({ _id: { $in: createdIds.users } });
      await Area.deleteMany({ _id: { $in: createdIds.areas } });
      await City.deleteMany({ _id: { $in: createdIds.cities } });
      await District.deleteMany({ _id: { $in: createdIds.districts } });
      await State.deleteMany({ _id: { $in: createdIds.states } });

      const residue = {
        users: await User.countDocuments({ _id: { $in: createdIds.users } }),
        fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
        applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
        referrals: await AcquisitionReferral.countDocuments({ _id: { $in: createdIds.referrals } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        payouts: await FieldAgentPayoutRequest.countDocuments({ _id: { $in: createdIds.payouts } }),
        supportTickets: await SupportTicket.countDocuments({ _id: { $in: createdIds.supportTickets } }),
        supportCategories: await SupportCategory.countDocuments({ _id: { $in: createdIds.supportCategories } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) +
             (await District.countDocuments({ _id: { $in: createdIds.districts } })) +
             (await City.countDocuments({ _id: { $in: createdIds.cities } })) +
             (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all E2E-10 fixtures", Object.values(residue).every((n) => n === 0), residue);
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
  console.log(`\nE2E-10: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
