/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyAssistedOnboardingPhase1.js
 *
 * PHASE 1 — PAN-India Field Agent Assisted Onboarding. Live, real-Mongo
 * (Atlas), real-Redis, real-HTTP (app.listen(0)), real-JWT verification
 * of the 20-item test matrix from the Phase 1 ticket. No mocks. Reuses
 * the proven fieldAgentE2EHelpers.js fixture/auth-fetch pattern.
 *
 * Every document this script creates is tracked by exact _id and
 * purged in the `finally` block — never an unscoped delete filter.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyAssistedOnboardingPhase1.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import Salon from "../../models/Salon.js";
import AcquisitionReferral from "../../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../../modules/fieldAgent/models/AcquisitionClaim.js";
import AcquisitionEarningProgress from "../../modules/fieldAgent/models/AcquisitionEarningProgress.js";
import FieldAgentAuditEvent from "../../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import CommercialPolicyVersion from "../../modules/fieldAgent/models/CommercialPolicyVersion.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";
import { adminApproveClaim } from "../../modules/fieldAgent/services/acquisitionClaim.service.js";

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch, requireField } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], earningProgress: [], auditEvents: [], policies: [], ledger: [] };

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  try {
    // ═══════════════════════════════════════════════════════════
    // FIXTURE — one ACTIVE, ACQUISITION_AGENT Field Agent. Chosen
    // commercial path deliberately avoids the AREA_SET territory
    // check (an honest, disclosed Phase-1 limitation for
    // TERRITORY_PARTNER on a location-less draft salon — see
    // assistedOnboarding.service.js's own header) so this matrix
    // exercises the real, intended-for-Phase-1 happy path.
    // ═══════════════════════════════════════════════════════════
    const fa = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "P1");
    createdIds.users.push(fa.agentUser._id);
    createdIds.applications.push(fa.application._id);
    createdIds.fieldAgents.push(fa.fieldAgent._id);
    const faToken = fa.token;

    // A second, non-FIELD_AGENT (OWNER) user+token, for the role-gate test.
    const otherOwner = await User.create({ name: "ZE2E_ASSISTED_OTHER_OWNER", phone: nextPhone("8"), role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(otherOwner._id);
    const ownerToken = generateAccessToken({ _id: otherOwner._id, role: "OWNER", tokenVersion: 0 });

    // ───────────────────────────────────────────────────────────
    // TEST 1 — no token at all -> 401
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", null, {
        method: "POST", body: JSON.stringify({ phone: nextPhone("7") }),
      });
      check("T1 no token -> 401", res.status === 401, res);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 2 — non-FIELD_AGENT (OWNER) token -> 403
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", ownerToken, {
        method: "POST", body: JSON.stringify({ phone: nextPhone("7") }),
      });
      check("T2 OWNER token -> 403", res.status === 403, res);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 3 — FIELD_AGENT send-otp success, devOtp echoed (ALLOW_FIXED_OTP=true)
    // ───────────────────────────────────────────────────────────
    const ownerPhoneA = nextPhone("7");
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneA }),
      });
      check("T3 send-otp success", res.status === 200 && res.data?.success === true, res);
      check("T3 devOtp echoed as 123456 (dev flag)", res.data?.data?.devOtp === "123456", res);
      check("T3 response never contains an owner/agent token", !JSON.stringify(res.data).toLowerCase().includes("accesstoken"), res);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 4 — wrong OTP -> 401, no owner/salon/claim created
    // ───────────────────────────────────────────────────────────
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneA, otp: "000000" }),
      });
      check("T4 wrong OTP -> 401", res.status === 401, res);
      const ghost = await User.findOne({ phone: ownerPhoneA, role: "OWNER" }).lean();
      check("T4 no owner created on wrong OTP", !ghost, ghost);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 5 — correct OTP -> owner created, DRAFT salon created,
    // claim created PENDING_APPROVAL, FA session/role unaffected.
    // ───────────────────────────────────────────────────────────
    let firstResult;
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneA, otp: "123456" }),
      });
      check("T5 correct OTP -> 201", res.status === 201, res);
      firstResult = res.data?.data;
      check("T5 response has ownerId/salonId/claim", !!firstResult?.ownerId && !!firstResult?.salonId && !!firstResult?.acquisitionClaim?.id, res);
      check("T5 ownerCreated === true (first time)", firstResult?.ownerCreated === true, firstResult);
      check("T5 claim status PENDING_APPROVAL", firstResult?.acquisitionClaim?.status === "PENDING_APPROVAL", firstResult);
      check("T5 response never contains an owner/agent token", !JSON.stringify(res.data).toLowerCase().includes("accesstoken"), res);

      if (firstResult?.ownerId) createdIds.users.push(firstResult.ownerId);
      if (firstResult?.salonId) createdIds.salons.push(firstResult.salonId);
      if (firstResult?.acquisitionClaim?.id) createdIds.claims.push(firstResult.acquisitionClaim.id);
    }

    // TEST 6 — direct DB verification: Salon.ownerId is the real owner,
    // NOT the Field Agent; no fieldAgentId field exists on the doc.
    {
      const salonDoc = await Salon.findById(firstResult.salonId).lean();
      check("T6 salon exists", !!salonDoc, salonDoc);
      check("T6 salon.ownerId === owner (not FA)", String(salonDoc?.ownerId) === String(firstResult.ownerId), salonDoc?.ownerId);
      check("T6 salon.ownerId !== fieldAgent.userRef", String(salonDoc?.ownerId) !== String(fa.agentUser._id), salonDoc?.ownerId);
      check("T6 salon has NO fieldAgentId field", !("fieldAgentId" in (salonDoc || {})), Object.keys(salonDoc || {}));
      check("T6 salon approval.status === DRAFT", salonDoc?.approval?.status === "DRAFT", salonDoc?.approval);
    }

    // TEST 7 — direct DB verification: AcquisitionClaim correctly links
    // salon + the ACTUAL field agent, referral consumed exactly once.
    {
      const claimDoc = await AcquisitionClaim.findById(firstResult.acquisitionClaim.id).lean();
      check("T7 claim.salonRef === salon", String(claimDoc?.salonRef) === String(firstResult.salonId), claimDoc);
      check("T7 claim.fieldAgentRef === this FA", String(claimDoc?.fieldAgentRef) === String(fa.fieldAgent._id), claimDoc);
      const referralDoc = await AcquisitionReferral.findById(claimDoc?.referralRef).lean();
      createdIds.referrals.push(referralDoc?._id);
      check("T7 referral status CONSUMED", referralDoc?.status === "CONSUMED", referralDoc);
      check("T7 referral.fieldAgentRef === this FA", String(referralDoc?.fieldAgentRef) === String(fa.fieldAgent._id), referralDoc);
    }

    // TEST 8 — FieldAgentAuditEvent rows written (reused model, no new one).
    {
      const events = await FieldAgentAuditEvent.find({ entityId: firstResult.acquisitionClaim.id }).lean();
      events.forEach((e) => createdIds.auditEvents.push(e._id));
      check("T8 ASSISTED_ONBOARDING_STARTED audit row exists", events.some((e) => e.action === "ASSISTED_ONBOARDING_STARTED"), events.map((e) => e.action));
      check("T8 ACQUISITION_CLAIM_CREATED audit row exists", events.some((e) => e.action === "ACQUISITION_CLAIM_CREATED"), events.map((e) => e.action));
    }

    // TEST 9 — FA's own session/user doc completely unchanged (no
    // tokenVersion bump, no new RefreshToken, original JWT still works).
    {
      const faUserAfter = await User.findById(fa.agentUser._id).select("tokenVersion role").lean();
      check("T9 FA tokenVersion unchanged (still 0)", Number(faUserAfter?.tokenVersion ?? 0) === 0, faUserAfter);
      check("T9 FA role still FIELD_AGENT", faUserAfter?.role === "FIELD_AGENT", faUserAfter);
      const probe = await authFetch("/api/field-agent/acquisition/referrals/mine", faToken, { method: "GET" });
      check("T9 original FA JWT still authenticates (reused for an unrelated existing route)", probe.status === 200, probe);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 10 — SAME owner phone again: owner reused (NOT duplicated),
    // existing salon surfaced, requiresSalonSelection:true, no 2nd
    // salon/claim created yet.
    //
    // The real OTP engine's own send-otp idempotency LOCK
    // (otp_lock:{role}:{purpose}:{phone}, 30s TTL — see
    // otp.service.js's own header) is still active from T3's send,
    // independent of the hash already being consumed by T5's verify.
    // That cooldown is correct, reused, unmodified product behavior —
    // this test waits it out rather than weakening/bypassing it.
    // ───────────────────────────────────────────────────────────
    await new Promise((r) => setTimeout(r, 31000));
    let secondOtpRes, ambiguousResult;
    {
      secondOtpRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneA }),
      });
      check("T10 resend-otp for same phone succeeds", secondOtpRes.status === 200, secondOtpRes);

      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneA, otp: "123456" }),
      });
      ambiguousResult = res.data?.data;
      check("T10 same phone -> 200 (not 201 — nothing new created)", res.status === 200, res);
      check("T10 requiresSalonSelection === true", ambiguousResult?.requiresSalonSelection === true, ambiguousResult);
      check("T10 ownerCreated === false (reused, not duplicated)", ambiguousResult?.ownerCreated === false, ambiguousResult);
      check("T10 ownerId identical to first call", String(ambiguousResult?.ownerId) === String(firstResult.ownerId), ambiguousResult);
      check("T10 existingSalons includes the earlier DRAFT salon", (ambiguousResult?.existingSalons || []).some((s) => String(s.id) === String(firstResult.salonId)), ambiguousResult?.existingSalons);
      check("T10 assistedOnboardingToken issued", typeof ambiguousResult?.assistedOnboardingToken === "string" && ambiguousResult.assistedOnboardingToken.length > 0, ambiguousResult);

      const ownerCount = await User.countDocuments({ phone: ownerPhoneA, role: "OWNER" });
      check("T10 exactly ONE owner document for this phone (no duplicate)", ownerCount === 1, ownerCount);
      const salonCount = await Salon.countDocuments({ ownerId: firstResult.ownerId });
      check("T10 still exactly ONE salon for this owner (no 2nd salon created)", salonCount === 1, salonCount);
    }

    // TEST 11 — resume with the assistedOnboardingToken + createNewBranch:true
    // -> creates a genuinely NEW second Salon (real branch creation support).
    {
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ assistedOnboardingToken: ambiguousResult.assistedOnboardingToken, createNewBranch: true }),
      });
      const branchResult = res.data?.data;
      check("T11 token-resume + createNewBranch -> 201", res.status === 201, res);
      check("T11 new salonId differs from the first salon", branchResult?.salonId && String(branchResult.salonId) !== String(firstResult.salonId), branchResult);
      check("T11 branch owner === same owner (not a new owner)", String(branchResult?.ownerId) === String(firstResult.ownerId), branchResult);
      if (branchResult?.salonId) createdIds.salons.push(branchResult.salonId);
      if (branchResult?.acquisitionClaim?.id) createdIds.claims.push(branchResult.acquisitionClaim.id);

      const branchClaim = await AcquisitionClaim.findById(branchResult.acquisitionClaim.id).lean();
      if (branchClaim?.referralRef) createdIds.referrals.push(branchClaim.referralRef);

      // Token must now be single-use — resuming again must fail.
      const replay = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ assistedOnboardingToken: ambiguousResult.assistedOnboardingToken, createNewBranch: true }),
      });
      check("T11b assistedOnboardingToken is single-use (replay rejected)", replay.status === 409, replay);
      const salonCountAfter = await Salon.countDocuments({ ownerId: firstResult.ownerId });
      check("T11c exactly TWO salons total for this owner after the real branch creation", salonCountAfter === 2, salonCountAfter);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 12 — SELF-CLAIM PROTECTION: Field Agent tries to assist-
    // onboard using their OWN phone number as the "owner" phone.
    // ───────────────────────────────────────────────────────────
    {
      const otpRes = await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: fa.agentUser.phone }),
      });
      check("T12 send-otp for own phone still succeeds (no leak at send-otp stage)", otpRes.status === 200, otpRes);

      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: fa.agentUser.phone, otp: "123456" }),
      });
      check("T12 self-claim rejected -> 409", res.status === 409, res);
      check("T12 self-claim error message", (res.data?.message || "").toLowerCase().includes("cannot acquire their own salon"), res.data);

      // The OWNER-role identity for the FA's own phone may now exist
      // (createOrFindUser runs before the self-claim guard — same
      // ordering real redeemReferral has no equivalent for, since
      // there the owner already exists by definition). Track for
      // cleanup only if it was actually created.
      const selfOwner = await User.findOne({ phone: fa.agentUser.phone, role: "OWNER" }).lean();
      if (selfOwner) createdIds.users.push(selfOwner._id);
      const selfSalonCount = await Salon.countDocuments({ ownerId: selfOwner?._id });
      check("T12 no Salon created for the rejected self-claim", selfSalonCount === 0, selfSalonCount);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 13 — IDEMPOTENCY: identical Idempotency-Key on /start for a
    // brand-new phone, fired twice sequentially -> second call must
    // return the cached response, not create a second owner/salon/claim.
    // ───────────────────────────────────────────────────────────
    {
      const ownerPhoneB = nextPhone("7");
      await authFetch("/api/field-agent/acquisition/assisted-onboarding/send-otp", faToken, {
        method: "POST", body: JSON.stringify({ phone: ownerPhoneB }),
      });
      const idemKey = `ZE2E_ASSISTED_IDEM_${Date.now()}`;
      const call1 = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", headers: { "Idempotency-Key": idemKey }, body: JSON.stringify({ phone: ownerPhoneB, otp: "123456" }),
      });
      check("T13 first call -> 201", call1.status === 201, call1);
      const d1 = call1.data?.data;
      if (d1?.ownerId) createdIds.users.push(d1.ownerId);
      if (d1?.salonId) createdIds.salons.push(d1.salonId);
      if (d1?.acquisitionClaim?.id) createdIds.claims.push(d1.acquisitionClaim.id);
      const c1 = await AcquisitionClaim.findById(d1?.acquisitionClaim?.id).lean();
      if (c1?.referralRef) createdIds.referrals.push(c1.referralRef);

      const call2 = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", headers: { "Idempotency-Key": idemKey }, body: JSON.stringify({ phone: ownerPhoneB, otp: "123456" }),
      });
      // idempotency.middleware.js's own documented envelope for a
      // replayed hit is {success:true, cached:true, data:<original
      // body>}, always HTTP 200 (even though the original was 201) —
      // see that file's own header. Comparing against THAT shape, not
      // a byte-identical replay of call1's own response.
      check(
        "T13 retried call returns the SAME cached result (idempotency.middleware.js's cached envelope)",
        call2.status === 200 && call2.data?.cached === true && JSON.stringify(call2.data?.data) === JSON.stringify(call1.data),
        { call1: call1.data, call2: call2.data }
      );

      const salonCountB = await Salon.countDocuments({ ownerId: d1?.ownerId });
      check("T13 exactly ONE salon created despite the duplicate retry", salonCountB === 1, salonCountB);
      const claimCountB = await AcquisitionClaim.countDocuments({ salonRef: d1?.salonId });
      check("T13 exactly ONE claim created despite the duplicate retry", claimCountB === 1, claimCountB);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 14 — admin approval path is completely untouched: the very
    // first claim (T5/T7) can still be approved via the EXISTING
    // adminApproveClaim.
    //
    // FA-9 PHASE A UPDATE: adminApproveClaim's own business rule
    // changed — it now takes a claim straight from PENDING_APPROVAL to
    // COMPLETED in one transaction, paying a one-time Acquisition
    // Reward. This test's own stated purpose ("admin approval path...
    // can still be approved") is literally "successful admin
    // acquisition approval", so per that classification it now expects
    // COMPLETED, not the old ACTIVE_RECOVERY. This environment has
    // ZERO CommercialPolicyVersion documents by default (a real,
    // pre-existing, unrelated data-config gap) — under Phase A that
    // means approval would ABORT entirely (no reward to resolve),
    // which is correct but would prevent this test from exercising the
    // real happy path at all. A disposable, safety-checked PUBLISHED
    // policy is created here (exactly once, with a hard guard against
    // ever touching a real published policy), used for this one
    // approval, and removed again in the `finally` cleanup below.
    // ───────────────────────────────────────────────────────────
    {
      const preExistingPublished = await CommercialPolicyVersion.countDocuments({ status: "PUBLISHED" });
      if (preExistingPublished !== 0) {
        throw new Error(`SAFETY ABORT: ${preExistingPublished} PUBLISHED CommercialPolicyVersion document(s) already exist — refusing to publish a disposable T14 test policy (would conflict with/retire a real one).`);
      }
      const t14Policy = await CommercialPolicyVersion.create({
        versionNumber: 970001 + Math.floor(Math.random() * 10000),
        status: "PUBLISHED",
        acquisitionAgentCommissionPercent: 10,
        acquisitionEarningTargetInPaise: 20000,
        acquisitionRewardAmountInPaise: 20000, // ₹200 — disposable test value, matches the T14 fixture convention
        territoryPartnerCommissionPercent: 8,
        licenseTermMonths: 12,
        claimExpiryDays: 30,
        createdBy: new mongoose.Types.ObjectId(),
        publishedBy: new mongoose.Types.ObjectId(),
        publishedAt: new Date(Date.now() - 60000),
      });
      createdIds.policies.push(t14Policy._id);

      const approved = await adminApproveClaim({ adminId: new mongoose.Types.ObjectId(), claimId: firstResult.acquisitionClaim.id });
      check("T14 adminApproveClaim -> COMPLETED (Phase A: one-time reward paid, relationship ends)", approved.status === "COMPLETED", approved);

      const rewardLedger = await FieldAgentEarningLedger.findOne({ acquisitionClaimRef: firstResult.acquisitionClaim.id, entitlementType: "ACQUISITION_REWARD" }).lean();
      if (rewardLedger?._id) createdIds.ledger.push(rewardLedger._id);
      check("T14 exactly one ACQUISITION_REWARD ledger row created, crediting ₹200", rewardLedger?.creditedAmountInPaise === 20000, rewardLedger);

      const progress = await AcquisitionEarningProgress.findOne({ acquisitionClaimRef: firstResult.acquisitionClaim.id }).lean();
      if (progress?._id) createdIds.earningProgress.push(progress._id);
      check("T14 AcquisitionEarningProgress also snapshotted (unchanged step, now resolvable with a real policy present)", progress?.targetInPaise === 20000, progress);
    }

    // ───────────────────────────────────────────────────────────
    // TEST 15 — regression: the REAL, pre-existing Owner OTP login
    // (SALON_LOGIN purpose, /api/auth/partner/*) is completely
    // unaffected by the new ASSISTED_ONBOARDING_OWNER_VERIFY purpose's
    // separate Redis key namespace.
    // ───────────────────────────────────────────────────────────
    {
      const realOwnerPhone = nextPhone("7");
      const sendRes = await authFetch("/api/auth/partner/send-otp", null, {
        method: "POST", body: JSON.stringify({ phone: realOwnerPhone }),
      });
      check("T15 real Owner send-otp (SALON_LOGIN) still 200", sendRes.status === 200, sendRes);
      const verifyRes = await authFetch("/api/auth/partner/verify-otp", null, {
        method: "POST", body: JSON.stringify({ phone: realOwnerPhone, otp: "123456" }),
      });
      // This legacy controller returns {success,accessToken,refreshToken,...}
      // at the TOP level (not wrapped under .data like successResponse()
      // wraps every other endpoint in this codebase) — a real, pre-
      // existing response-shape discovery, not a Phase 1 change.
      check("T15 real Owner verify-otp still issues a real session (unaffected)", verifyRes.status === 200 && !!verifyRes.data?.accessToken, verifyRes);
      const realOwner = await User.findOne({ phone: realOwnerPhone, role: "OWNER" }).lean();
      if (realOwner) createdIds.users.push(realOwner._id);
    }

    // TEST 16 — cross-purpose isolation: an OTP sent under the real
    // SALON_LOGIN purpose must NOT verify against the new assisted-
    // onboarding purpose (distinct Redis key namespace, by design).
    {
      const crossPhone = nextPhone("7");
      await authFetch("/api/auth/partner/send-otp", null, { method: "POST", body: JSON.stringify({ phone: crossPhone }) });
      // No assisted-onboarding send-otp was called for crossPhone — only SALON_LOGIN.
      const res = await authFetch("/api/field-agent/acquisition/assisted-onboarding/start", faToken, {
        method: "POST", body: JSON.stringify({ phone: crossPhone, otp: "123456" }),
      });
      check("T16 SALON_LOGIN-purpose OTP does not satisfy ASSISTED_ONBOARDING_OWNER_VERIFY", res.status === 401, res);
      const ghost = await User.findOne({ phone: crossPhone, role: "OWNER" }).lean();
      check("T16 no owner created from the rejected cross-purpose attempt", !ghost, ghost);
    }

  } finally {
    // ═══════════════════════════════════════════════════════════
    // CLEANUP — exact _id only, every document this script created.
    // ═══════════════════════════════════════════════════════════
    await FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.ledger } }); // immutable at the ORM level — raw driver bypass, same established idiom as every other script in this suite
    await CommercialPolicyVersion.deleteMany({ _id: { $in: createdIds.policies } });
    await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.earningProgress } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await FieldAgentAuditEvent.deleteMany({ _id: { $in: createdIds.auditEvents } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total\n`);

    server.close();
    await mongoose.connection.close();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
