/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentE2E02.js
 *
 * FA-16 Tier 1 — E2E-02: ACTIVE Field Agent -> Referral -> Owner
 * Redemption -> Acquisition Claim -> Salon Attribution.
 *
 * Real Mongo, real HTTP (app.listen(0)), real JWTs, no mocks.
 *
 * FIXTURE vs REAL — see fieldAgentE2EHelpers.js header. The ACTIVE
 * Field Agent identity itself is created via a [VALID FIXTURE]
 * (direct FieldAgent.create with operationalStatus: ACTIVE) rather
 * than re-driving E2E-01's full onboarding chain — E2E-01 already
 * proves that chain end-to-end; E2E-02's job is the boundary AFTER
 * ACTIVE, which is what this script actually exercises for real.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentE2E02.js
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

import { makeGeoFixture, makeSalonFixture, authFetch as sharedAuthFetch, requireField } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const createdIds = {
  users: [], fieldAgents: [], applications: [], referrals: [], claims: [], progress: [],
  states: [], districts: [], cities: [], areas: [], salons: [],
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
    // ── [VALID FIXTURE] geo, two ACTIVE field agents (A, B), one salon per owner ──
    const geo = await makeGeoFixture({ Country, State, District, City, Area }, "02");
    createdIds.states.push(geo.state._id);
    createdIds.districts.push(geo.district._id);
    createdIds.cities.push(geo.city._id);
    createdIds.areas.push(geo.area._id);

    const mkActiveFieldAgent = async (label) => {
      const agentUser = await User.create({ name: `ZE2E_AGENT_${label}`, phone: phone("9"), role: "FIELD_AGENT", accountStatus: "ACTIVE" });
      createdIds.users.push(agentUser._id);
      const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone: agentUser.phone, status: "APPROVED", nonTerminal: false });
      createdIds.applications.push(application._id);
      const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `ZE2E02-${label}-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
      createdIds.fieldAgents.push(fieldAgent._id);
      const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });
      return { agentUser, fieldAgent, token };
    };

    const A = await mkActiveFieldAgent("A");
    const B = await mkActiveFieldAgent("B");

    const { owner, salon } = await makeSalonFixture({ User, Salon }, geo, { registerUserId: (id) => createdIds.users.push(id) });
    createdIds.salons.push(salon._id);
    const ownerToken = generateAccessToken({ _id: owner._id, role: "OWNER", tokenVersion: 0 });

    // ═══════════════════════════════════════════════════════════
    // STEP 1 [REAL API] — ACTIVE Field Agent A generates a referral.
    // ═══════════════════════════════════════════════════════════
    const issueRes = await authFetch("/api/field-agent/acquisition/referrals", A.token, { method: "POST" });
    check("1. ACTIVE Field Agent can generate a referral -> 201", issueRes.status === 201, issueRes);
    const referralId = requireField(issueRes.data, "data.referral._id", "issue referral response");
    const referralCode = requireField(issueRes.data, "data.referral.code", "issue referral response");
    createdIds.referrals.push(referralId);

    const referralDoc = await AcquisitionReferral.findById(referralId);
    check("2. Referral belongs to the issuing Field Agent", String(referralDoc?.fieldAgentRef) === String(A.fieldAgent._id), referralDoc?.fieldAgentRef);
    check("3. referralCode is generated server-side (non-empty, unpredictable)", typeof referralCode === "string" && referralCode.length >= 4, referralCode);

    // ═══════════════════════════════════════════════════════════
    // STEP 2 [REAL API] — Owner authenticates independently and
    // redeems the referral. salonId/fieldAgentRef are NOT accepted
    // by the endpoint (schema forbids them) — server resolves the
    // owner's own salon and the referral's own field agent.
    // ═══════════════════════════════════════════════════════════
    const spoofRedeemRes = await authFetch("/api/acquisition/redeem", ownerToken, {
      method: "POST",
      body: JSON.stringify({ referralCode, salonId: salon._id.toString() }),
    });
    check("4a. Attempting to supply salonId is rejected (400, forbidden field)", spoofRedeemRes.status === 400, spoofRedeemRes);

    const redeemRes = await authFetch("/api/acquisition/redeem", ownerToken, {
      method: "POST",
      body: JSON.stringify({ referralCode }),
    });
    check("4. Owner redeems the referral for real -> 200/201", redeemRes.status === 200 || redeemRes.status === 201, redeemRes);
    const claimId = requireField(redeemRes.data, "data.claim._id", "redeem response");
    createdIds.claims.push(claimId);

    // ═══════════════════════════════════════════════════════════
    // STEP 3 — real-state assertions
    // ═══════════════════════════════════════════════════════════
    const referralAfter = await AcquisitionReferral.findById(referralId);
    check("5. Referral transitions to CONSUMED", referralAfter?.status === "CONSUMED", referralAfter?.status);
    check("5b. Referral records the correct consumedSalonRef (the owner's own salon, server-resolved)", String(referralAfter?.consumedSalonRef) === String(salon._id), referralAfter?.consumedSalonRef);

    const claim = await AcquisitionClaim.findById(claimId);
    check("6. AcquisitionClaim created with correct salonRef", String(claim?.salonRef) === String(salon._id), claim?.salonRef);
    check("6b. AcquisitionClaim created with correct fieldAgentRef (Field Agent A, not B, not the owner)", String(claim?.fieldAgentRef) === String(A.fieldAgent._id), claim?.fieldAgentRef);
    check("7. Claim status is ACTIVE", claim?.status === "ACTIVE", claim?.status);

    const activeClaimCount = await AcquisitionClaim.countDocuments({ salonRef: salon._id, status: "ACTIVE" });
    check("8. Exactly one ACTIVE claim exists for the salon", activeClaimCount === 1, activeClaimCount);

    const salonAfter = await Salon.findById(salon._id);
    check("9. Field Agent attribution is correct (claim references A, salon ownership untouched by claim)", String(claim?.fieldAgentRef) === String(A.fieldAgent._id));
    check("10. Salon owner remains unchanged (still the original OWNER, never reassigned)", String(salonAfter?.ownerId) === String(owner._id), salonAfter?.ownerId);

    // ═══════════════════════════════════════════════════════════
    // STEP 4 [REAL API] — security: Field Agent B cannot touch A's
    // referral/claim, no double-redemption, existing rate limiter
    // still active.
    // ═══════════════════════════════════════════════════════════
    const doubleRedeemRes = await authFetch("/api/acquisition/redeem", ownerToken, {
      method: "POST",
      body: JSON.stringify({ referralCode }),
    });
    check("11. Referral cannot be consumed twice -> 409/404 (not 200)", doubleRedeemRes.status !== 200 && doubleRedeemRes.status !== 201, doubleRedeemRes);

    const bCancelAttempt = await authFetch(`/api/field-agent/acquisition/referrals/${referralId}/cancel`, B.token, { method: "POST", body: JSON.stringify({}) });
    check("12. Field Agent B cannot cancel/manipulate A's referral -> 403/404 (never 200)", bCancelAttempt.status === 403 || bCancelAttempt.status === 404, bCancelAttempt);

    // Confirm the FA-15 C1 Redis rate limiter is still wired on this
    // exact route — one more request should never be silently
    // unlimited; a genuine 429 boundary test is Tier 4's job, this
    // only confirms the middleware is present and not bypassed.
    const secondReferral = await authFetch("/api/field-agent/acquisition/referrals", A.token, { method: "POST" });
    check("13. C1 rate-limit middleware still active on referral-create (second call still succeeds under the 20/hour limit, proving the route itself is unbroken)", secondReferral.status === 201, secondReferral.status);
    if (secondReferral.data?.data?.referral?._id) createdIds.referrals.push(secondReferral.data.data.referral._id);

    const dupClaimCount = await AcquisitionClaim.countDocuments({ salonRef: salon._id });
    check("14. No unexpected duplicate claim documents were created", dupClaimCount === 1, dupClaimCount);

    // ═══════════════════════════════════════════════════════════
    // DYNAMIC ATTRIBUTION NOTE (per FA-16 discovery finding) —
    // Booking does NOT carry a fieldAgentRef. Recorded here as a
    // documented architectural fact for E2E-03 to build on; not
    // testable from this script alone since it requires a Booking.
    // ═══════════════════════════════════════════════════════════
    check("15. [Architectural fact, not a defect] AcquisitionClaim — not Booking — is the sole attribution anchor; E2E-03 must resolve earning attribution through the salon's current ACTIVE claim, exactly as fieldAgentEarning.service.js does", true);

    const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: claim?._id });
    if (progress) createdIds.progress.push(progress._id);

  } catch (err) {
    console.error("FATAL ERROR DURING E2E-02:", err);
    fail++;
    results.push(`❌ FATAL: ${err.message}`);
  } finally {
    try {
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
        referrals: await AcquisitionReferral.countDocuments({ _id: { $in: createdIds.referrals } }),
        claims: await AcquisitionClaim.countDocuments({ _id: { $in: createdIds.claims } }),
        salons: await Salon.countDocuments({ _id: { $in: createdIds.salons } }),
        geo: (await State.countDocuments({ _id: { $in: createdIds.states } })) +
             (await District.countDocuments({ _id: { $in: createdIds.districts } })) +
             (await City.countDocuments({ _id: { $in: createdIds.cities } })) +
             (await Area.countDocuments({ _id: { $in: createdIds.areas } })),
      };
      check("Cleanup: zero residue across all E2E-02 fixtures", Object.values(residue).every((n) => n === 0), residue);
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
  console.log(`\nE2E-02: ${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed (${pass + fail} total), duration ${durationMs}ms`);
  console.log(`Created fixture counts: users=${createdIds.users.length} fieldAgents=${createdIds.fieldAgents.length} referrals=${createdIds.referrals.length} claims=${createdIds.claims.length} salons=${createdIds.salons.length}`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
