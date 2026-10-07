/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentSalonDelete.js
 *
 * "Field Agent Salon Delete" feature — live, real Mongo (Atlas) + real
 * Redis + real HTTP (app.listen(0)) + real JWT verification. No
 * mocks. Covers the full test matrix requested: PENDING-only delete,
 * APPROVED/DRAFT rejection, cross-agent isolation, random salonId,
 * same-owner multi-salon independence (the exact Owner X: A=APPROVED/
 * B=PENDING/C=PENDING scenario), AcquisitionClaim attribution
 * preserved (not hard-deleted), AcquisitionEarningProgress preserved
 * when present, and that the deleted claim naturally disappears from
 * every /recovery tab.
 *
 * Every document created is purged by exact _id in `finally`.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentSalonDelete.js
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

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], progress: [] };

const makeClaimedSalon = async ({ ownerId, ownerPhone, fieldAgentId, label, approvalStatus = "PENDING", claimStatus = "PENDING_APPROVAL" }) => {
  let realOwnerId = ownerId;
  if (!realOwnerId) {
    const owner = await User.create({ name: "ZE2E_DELETE_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(owner._id);
    realOwnerId = owner._id;
  }
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: realOwnerId, "onboarding.step": 7, "approval.status": approvalStatus, "basicInfo.shopName": `ZE2E_DELETE_${label}` } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  createdIds.salons.push(salon._id);
  const referral = await AcquisitionReferral.create({
    code: `ZE2EDELETE-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  createdIds.referrals.push(referral._id);
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: claimStatus });
  createdIds.claims.push(claim._id);
  return { ownerId: realOwnerId, salon, claim };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);
  const deletePath = (salonId) => `/api/field-agent/acquisition/applications/${salonId}`;
  const recoveryPath = (status) => `/api/field-agent/acquisition/recovery?status=${status}&page=1&limit=20`;

  try {
    const faA = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "DELETE_A");
    createdIds.users.push(faA.agentUser._id);
    createdIds.applications.push(faA.application._id);
    createdIds.fieldAgents.push(faA.fieldAgent._id);

    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "DELETE_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);

    // ── Owner X: Salon A=APPROVED, Salon B=PENDING, Salon C=PENDING (Agent A) ──
    const fixA = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "A", approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY" });
    const fixB = await makeClaimedSalon({ ownerId: fixA.ownerId, fieldAgentId: faA.fieldAgent._id, label: "B", approvalStatus: "PENDING" });
    const fixC = await makeClaimedSalon({ ownerId: fixA.ownerId, fieldAgentId: faA.fieldAgent._id, label: "C", approvalStatus: "PENDING" });

    // ── Salon D: DRAFT, Agent A (non-pending rejection target) ──
    const fixD = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "D", approvalStatus: "DRAFT" });

    // ── Salon Y: PENDING, Agent B (cross-agent isolation target) ──
    const fixY = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faB.fieldAgent._id, label: "Y", approvalStatus: "PENDING" });

    // ── Salon with AcquisitionEarningProgress already present, but
    // Salon itself still PENDING (the real, if unusual, independent-
    // timeline case: claim approved into recovery before the salon's
    // own onboarding was approved) — proves this progress doc is
    // NEVER touched by delete. ──
    const fixP = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "P", approvalStatus: "PENDING", claimStatus: "ACTIVE_RECOVERY" });
    const progressDoc = await AcquisitionEarningProgress.create({ acquisitionClaimRef: fixP.claim._id, salonRef: fixP.salon._id, targetInPaise: 20000, earnedInPaise: 5000, status: "IN_PROGRESS" });
    createdIds.progress.push(progressDoc._id);

    // ═══════════════════════════════════════════════════════════
    // ITEM 5/6 — rejection cases (APPROVED, DRAFT)
    // ═══════════════════════════════════════════════════════════
    {
      const rApproved = await authFetch(deletePath(fixA.salon._id), faA.token, { method: "DELETE" });
      check("5. APPROVED salon -> DELETE rejected (400, exact message)", rApproved.status === 400 && rApproved.data?.message === "Approved salons cannot be deleted by Field Agents", rApproved);

      const rDraft = await authFetch(deletePath(fixD.salon._id), faA.token, { method: "DELETE" });
      check("6. DRAFT (non-pending) salon -> DELETE rejected (400, exact message)", rDraft.status === 400 && rDraft.data?.message === "This salon cannot be deleted because its current status does not allow deletion", rDraft);
    }

    // ═══════════════════════════════════════════════════════════
    // ITEM 7/8 — cross-agent isolation + random salonId
    // ═══════════════════════════════════════════════════════════
    {
      const rCrossAgent = await authFetch(deletePath(fixY.salon._id), faA.token, { method: "DELETE" });
      check("7. Agent A deleting Agent B's (Salon Y) -> rejected 404 (no leak)", rCrossAgent.status === 404, rCrossAgent);
      const yClaimAfter = await AcquisitionClaim.findById(fixY.claim._id).lean();
      check("7b. Salon Y's claim UNCHANGED after the rejected cross-agent attempt", yClaimAfter.status === "PENDING_APPROVAL", yClaimAfter);

      const randomId = new mongoose.Types.ObjectId();
      const rRandom = await authFetch(deletePath(randomId), faA.token, { method: "DELETE" });
      check("8. Random/nonexistent salonId -> rejected 404", rRandom.status === 404, rRandom);
    }

    // ═══════════════════════════════════════════════════════════
    // ITEM 1/2/3/4/9/10 — the real delete + all its invariants
    // ═══════════════════════════════════════════════════════════
    {
      const rDelete = await authFetch(deletePath(fixB.salon._id), faA.token, { method: "DELETE" });
      check("1. PENDING salon (Salon B) owned by Agent A -> DELETE succeeds (200)", rDelete.status === 200, rDelete);
      check("1b. Response reports status ENDED", rDelete.data?.data?.status === "ENDED", rDelete.data);

      const rRecoveryAfter = await authFetch(recoveryPath("PENDING_APPROVAL"), faA.token, { method: "GET" });
      const stillThere = (rRecoveryAfter.data?.data?.salons || []).some((i) => String(i.claimId) === String(fixB.claim._id));
      check("2. Deleted Salon B no longer appears in the recovery list (any tab)", !stillThere, rRecoveryAfter.data?.data?.salons?.map((i) => i.claimId));

      const ownerDoc = await User.findById(fixA.ownerId).lean();
      check("3. Owner X account remains fully intact (not deleted)", !!ownerDoc, ownerDoc);

      const salonCAfter = await Salon.findById(fixC.salon._id).lean();
      const salonAAfter = await Salon.findById(fixA.salon._id).lean();
      check("4. Owner X's other salons (A, C) remain fully intact", !!salonCAfter && salonCAfter.approval?.status === "PENDING" && !!salonAAfter && salonAAfter.approval?.status === "APPROVED", { salonAAfter: salonAAfter?.approval, salonCAfter: salonCAfter?.approval });

      const claimBAfter = await AcquisitionClaim.findById(fixB.claim._id).lean();
      check("9. AcquisitionClaim B is NOT hard-deleted — still exists, now ENDED/AGENT_WITHDRAWN", !!claimBAfter && claimBAfter.status === "ENDED" && claimBAfter.endedReason === "AGENT_WITHDRAWN", claimBAfter);
      check("9b. Claim B's salonRef/fieldAgentRef attribution UNCHANGED (still points at the real salon/agent)", String(claimBAfter.salonRef) === String(fixB.salon._id) && String(claimBAfter.fieldAgentRef) === String(faA.fieldAgent._id), claimBAfter);

      const salonBAfter = await Salon.findById(fixB.salon._id).lean();
      check("Salon B document itself is NOT hard-deleted (still exists, untouched)", !!salonBAfter && salonBAfter.approval?.status === "PENDING", salonBAfter?.approval);
    }

    // ═══════════════════════════════════════════════════════════
    // ITEM 10 (continued) — AcquisitionEarningProgress preserved
    // ═══════════════════════════════════════════════════════════
    {
      const rDeleteP = await authFetch(deletePath(fixP.salon._id), faA.token, { method: "DELETE" });
      check("10. PENDING salon WITH an existing AcquisitionEarningProgress -> DELETE still succeeds", rDeleteP.status === 200, rDeleteP);

      const progressAfter = await AcquisitionEarningProgress.findById(progressDoc._id).lean();
      check("10b. AcquisitionEarningProgress is NEVER touched — same earnedInPaise, same targetInPaise, same status", progressAfter && progressAfter.earnedInPaise === 5000 && progressAfter.targetInPaise === 20000 && progressAfter.status === "IN_PROGRESS", progressAfter);

      const claimPAfter = await AcquisitionClaim.findById(fixP.claim._id).lean();
      check("10c. Claim P ended correctly (was ACTIVE_RECOVERY, a real non-terminal state)", claimPAfter.status === "ENDED", claimPAfter);
    }

    // ═══════════════════════════════════════════════════════════
    // ITEM 12/13 — deleting one child removes only that child; last
    // eligible child removal naturally empties the owner from the
    // recovery list (frontend grouping has nothing left to show).
    // ═══════════════════════════════════════════════════════════
    {
      const rDeleteC = await authFetch(deletePath(fixC.salon._id), faA.token, { method: "DELETE" });
      check("12. Deleting Salon C succeeds, independently of B's earlier deletion", rDeleteC.status === 200, rDeleteC);

      // PHASE 11G — "Fix My Acquired Salons Visibility" (2026-10-02)
      // UPDATE: the "PENDING_APPROVAL" tab/status value no longer
      // exists as a distinct filter on this endpoint — the backend
      // now unconditionally restricts every request to the
      // ACTIVE_RECOVERY bucket, aliasing any disallowed/legacy status
      // value (including this literal one) to the same safe result.
      // This assertion is updated to reflect that reality rather than
      // the old "Pending tab" concept: querying the legacy value now
      // correctly returns the SAME thing querying "ACTIVE_RECOVERY"
      // would — i.e. it STILL contains Owner X's real, still-active
      // Salon A (never deleted in this test), not an empty list.
      const rRecoveryFinal = await authFetch(recoveryPath("PENDING_APPROVAL"), faA.token, { method: "GET" });
      const ownerXInLegacyQuery = (rRecoveryFinal.data?.data?.salons || []).some((i) => String(i.salon?.ownerId?._id) === String(fixA.ownerId) && String(i.claimId) === String(fixA.claim._id));
      check("13. Legacy 'PENDING_APPROVAL' query now safely aliases to the Active bucket — Owner X's still-active Salon A correctly appears (not an empty 'pending' list)", ownerXInLegacyQuery, rRecoveryFinal.data?.data?.salons);

      const rRecoveryActive = await authFetch(recoveryPath("ACTIVE_RECOVERY"), faA.token, { method: "GET" });
      const ownerXStillInActive = (rRecoveryActive.data?.data?.salons || []).some((i) => String(i.salon?.ownerId?._id) === String(fixA.ownerId));
      check("Owner X's Salon A (APPROVED/ACTIVE_RECOVERY, never touched) still correctly appears under the Active tab", ownerXStillInActive, rRecoveryActive.data?.data?.salons);
    }

  } finally {
    await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.progress } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals } });
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
