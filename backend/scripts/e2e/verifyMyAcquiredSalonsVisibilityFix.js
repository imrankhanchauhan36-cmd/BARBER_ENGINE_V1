/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyMyAcquiredSalonsVisibilityFix.js
 *
 * PHASE 11G — "Fix My Acquired Salons Visibility" live verification.
 *
 * Proves, against the real backend (no mocks), that
 * listMyAcquisitionRecovery() now NEVER returns a PENDING_APPROVAL or
 * ENDED claim, regardless of the underlying Salon's approval.status —
 * reproducing, with disposable fixtures, the exact live scenario the
 * approved audit found (owner phone 9548415653's two abandoned
 * DRAFT-salon branches) — while every other existing guarantee
 * (fieldAgentRef isolation, pagination, owner-grouping data,
 * recovery progress) remains intact, and abandoned claims are
 * confirmed UNCHANGED in the database (never deleted/mutated by this
 * read).
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyMyAcquiredSalonsVisibilityFix.js
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

import { nextPhone, makeActiveFieldAgent, authFetch as sharedAuthFetch, oid } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const createdIds = { users: [], applications: [], fieldAgents: [], salons: [], referrals: [], claims: [], progress: [] };

const makeClaimedSalon = async ({ ownerId, ownerPhone, fieldAgentId, label, approvalStatus = "DRAFT", claimStatus = "PENDING_APPROVAL", onboardingStep = 0 }) => {
  let realOwnerId = ownerId;
  if (!realOwnerId) {
    const owner = await User.create({ name: "ZE2E_VIS_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(owner._id);
    realOwnerId = owner._id;
  }
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: realOwnerId, "onboarding.step": onboardingStep, "approval.status": approvalStatus, "basicInfo.shopName": `ZE2E_VIS_${label}` } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  createdIds.salons.push(salon._id);
  const referral = await AcquisitionReferral.create({
    code: `ZE2EVIS-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  createdIds.referrals.push(referral._id);
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: claimStatus });
  createdIds.claims.push(claim._id);
  return { ownerId: realOwnerId, salon, claim };
};

const makeProgress = async ({ claimId, salonId, status, targetInPaise = 20000, earnedInPaise = 0 }) => {
  const progress = await AcquisitionEarningProgress.create({
    acquisitionClaimRef: claimId, salonRef: salonId, targetInPaise, earnedInPaise, status,
  });
  createdIds.progress.push(progress._id);
  return progress;
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);
  const recoveryPath = (status) => `/api/field-agent/acquisition/recovery?status=${status}&page=1&limit=20`;

  try {
    const faA = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "VIS_A");
    createdIds.users.push(faA.agentUser._id); createdIds.applications.push(faA.application._id); createdIds.fieldAgents.push(faA.fieldAgent._id);
    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "VIS_B");
    createdIds.users.push(faB.agentUser._id); createdIds.applications.push(faB.application._id); createdIds.fieldAgents.push(faB.fieldAgent._id);

    // ═══════════════════════════════════════════════════════════
    // 1. PENDING_APPROVAL claim + DRAFT salon -> absent
    //    (the exact live bug: a salon abandoned at onboarding step 0)
    // ═══════════════════════════════════════════════════════════
    const s1 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S1_DRAFT", approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL", onboardingStep: 0 });

    // ═══════════════════════════════════════════════════════════
    // 2. PENDING_APPROVAL claim + PENDING salon -> absent
    //    (salon WAS submitted — admin hasn't approved the CLAIM yet;
    //    the two admin timelines are independent — confirmed by the
    //    architecture itself, not assumed)
    // ═══════════════════════════════════════════════════════════
    const s2 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S2_PENDING", approvalStatus: "PENDING", claimStatus: "PENDING_APPROVAL", onboardingStep: 7 });

    // ═══════════════════════════════════════════════════════════
    // 3. ACTIVE_RECOVERY + APPROVED salon -> present (Active tab)
    // ═══════════════════════════════════════════════════════════
    const s3 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S3_ACTIVE", approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: s3.claim._id, salonId: s3.salon._id, status: "IN_PROGRESS", earnedInPaise: 5000 });

    // ═══════════════════════════════════════════════════════════
    // 4. COMPLETED (TARGET_REACHED) + APPROVED salon -> present
    //    (Completed tab/history)
    // ═══════════════════════════════════════════════════════════
    const s4 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S4_COMPLETED", approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: s4.claim._id, salonId: s4.salon._id, status: "TARGET_REACHED", earnedInPaise: 20000 });

    // An ENDED claim too, for completeness (withdrawn/rejected) — must
    // also be absent from every tab.
    const s5 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S5_ENDED", approvalStatus: "REJECTED", claimStatus: "ENDED", onboardingStep: 7 });

    // ═══════════════════════════════════════════════════════════
    // 5. Another Field Agent's ACTIVE_RECOVERY claim -> absent from A
    // ═══════════════════════════════════════════════════════════
    const sB = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faB.fieldAgent._id, label: "SB_OTHER_AGENT_ACTIVE", approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: sB.claim._id, salonId: sB.salon._id, status: "IN_PROGRESS", earnedInPaise: 1000 });

    // ═══════════════════════════════════════════════════════════
    // 6. Same owner, multiple salons (mirrors the real reported case:
    //    one real approved+active salon, one abandoned draft branch,
    //    same owner) -> only the qualifying one appears
    // ═══════════════════════════════════════════════════════════
    const sharedOwnerPhone = nextPhone("7");
    const s6a = await makeClaimedSalon({ ownerPhone: sharedOwnerPhone, fieldAgentId: faA.fieldAgent._id, label: "S6A_REAL_APPROVED", approvalStatus: "APPROVED", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: s6a.claim._id, salonId: s6a.salon._id, status: "IN_PROGRESS", earnedInPaise: 2000 });
    const s6b = await makeClaimedSalon({ ownerId: s6a.ownerId, fieldAgentId: faA.fieldAgent._id, label: "S6B_ABANDONED_DRAFT", approvalStatus: "DRAFT", claimStatus: "PENDING_APPROVAL", onboardingStep: 0 });

    // ═══════════════════════════════════════════════════════════
    // PHASE 11G-FINAL — "Approved Salon Gate". The exact proven edge
    // case from the Phase 11G-Followup audit: an ACTIVE_RECOVERY
    // claim (admin approved the CLAIM) whose SALON never passed its
    // own, separate approval workflow. Each one gets a real
    // IN_PROGRESS AcquisitionEarningProgress row too, so these would
    // have INCORRECTLY qualified under the OLD Phase-11G-only rule
    // ("ACTIVE_RECOVERY is enough") — proving the NEW gate is what
    // excludes them, not merely an accident of missing progress data.
    // ═══════════════════════════════════════════════════════════
    const s7 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S7_DRAFT_BUT_ACTIVE", approvalStatus: "DRAFT", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 0 });
    await makeProgress({ claimId: s7.claim._id, salonId: s7.salon._id, status: "IN_PROGRESS", earnedInPaise: 1000 });

    const s8 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S8_PENDING_BUT_ACTIVE", approvalStatus: "PENDING", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: s8.claim._id, salonId: s8.salon._id, status: "IN_PROGRESS", earnedInPaise: 1000 });

    const s9 = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "S9_REJECTED_BUT_ACTIVE", approvalStatus: "REJECTED", claimStatus: "ACTIVE_RECOVERY", onboardingStep: 7 });
    await makeProgress({ claimId: s9.claim._id, salonId: s9.salon._id, status: "IN_PROGRESS", earnedInPaise: 1000 });

    // ═══════════════════════════════════════════════════════════
    // Fetch: Active tab, Completed tab, for Agent A.
    // ═══════════════════════════════════════════════════════════
    const activeRes = await authFetch(recoveryPath("ACTIVE_RECOVERY"), faA.token, { method: "GET" });
    const activeIds = (activeRes.data?.data?.salons || []).map((i) => String(i.claimId));

    check("1. PENDING_APPROVAL + DRAFT salon (abandoned onboarding) is ABSENT from Active tab", !activeIds.includes(String(s1.claim._id)), { s1ClaimId: s1.claim._id, activeIds });
    check("2. PENDING_APPROVAL + PENDING salon (submitted, claim not yet admin-approved) is ABSENT", !activeIds.includes(String(s2.claim._id)), { s2ClaimId: s2.claim._id, activeIds });
    check("3. ACTIVE_RECOVERY + APPROVED salon IS present in Active tab", activeIds.includes(String(s3.claim._id)), { s3ClaimId: s3.claim._id, activeIds });
    check("3b. TARGET_REACHED claim is correctly excluded from the Active tab (belongs under Completed instead)", !activeIds.includes(String(s4.claim._id)), { s4ClaimId: s4.claim._id, activeIds });
    check("ENDED claim (rejected/withdrawn) is ABSENT from Active tab", !activeIds.includes(String(s5.claim._id)), { s5ClaimId: s5.claim._id, activeIds });
    check("5. Another Field Agent's ACTIVE_RECOVERY claim is ABSENT from Agent A's list (cross-agent isolation)", !activeIds.includes(String(sB.claim._id)), { sBClaimId: sB.claim._id, activeIds });
    check("6. Same-owner: the real APPROVED+ACTIVE salon IS present", activeIds.includes(String(s6a.claim._id)), { s6aClaimId: s6a.claim._id, activeIds });
    check("6b. Same-owner: the abandoned DRAFT branch is ABSENT (only the qualifying claim appears)", !activeIds.includes(String(s6b.claim._id)), { s6bClaimId: s6b.claim._id, activeIds });

    // PHASE 11G-FINAL — the Approved Salon Gate itself. Each of these
    // has a real ACTIVE_RECOVERY claim AND a real IN_PROGRESS progress
    // row (i.e. would have appeared under the OLD Phase-11G rule) —
    // only the new salon.approval.status === APPROVED requirement
    // excludes them.
    check("DRAFT + ACTIVE_RECOVERY is ABSENT (new Approved Salon Gate)", !activeIds.includes(String(s7.claim._id)), { s7ClaimId: s7.claim._id, activeIds });
    check("PENDING + ACTIVE_RECOVERY is ABSENT (new Approved Salon Gate)", !activeIds.includes(String(s8.claim._id)), { s8ClaimId: s8.claim._id, activeIds });
    check("REJECTED + ACTIVE_RECOVERY is ABSENT (new Approved Salon Gate)", !activeIds.includes(String(s9.claim._id)), { s9ClaimId: s9.claim._id, activeIds });

    // Confirm none of these three are deleted/mutated by being
    // excluded from the read — same "excluded, never ended" guarantee
    // as the original abandoned-claim scenarios.
    const s7Reread = await AcquisitionClaim.findById(s7.claim._id).lean();
    const s8Reread = await AcquisitionClaim.findById(s8.claim._id).lean();
    const s9Reread = await AcquisitionClaim.findById(s9.claim._id).lean();
    check("DRAFT/PENDING/REJECTED-gated claims remain ACTIVE_RECOVERY in the DB — excluded from the read, never ended/mutated", s7Reread?.status === "ACTIVE_RECOVERY" && s8Reread?.status === "ACTIVE_RECOVERY" && s9Reread?.status === "ACTIVE_RECOVERY", { s7: s7Reread?.status, s8: s8Reread?.status, s9: s9Reread?.status });

    const completedRes = await authFetch(recoveryPath("COMPLETED"), faA.token, { method: "GET" });
    const completedIds = (completedRes.data?.data?.salons || []).map((i) => String(i.claimId));
    check("4. TARGET_REACHED (COMPLETED) claim IS present in Completed tab/history", completedIds.includes(String(s4.claim._id)), { s4ClaimId: s4.claim._id, completedIds });
    check("ENDED claim is ABSENT from Completed tab too", !completedIds.includes(String(s5.claim._id)), { s5ClaimId: s5.claim._id, completedIds });

    // Also confirm a stale/disallowed client-sent status value
    // (the literal old tab key) resolves to the SAME safe "active,
    // not-reached" result set, never to the disallowed PENDING_APPROVAL
    // data, never an error — server-side enforcement regardless of
    // client input, per the audit's own explicit requirement.
    const staleStatusRes = await authFetch(recoveryPath("PENDING_APPROVAL"), faA.token, { method: "GET" });
    const staleIds = (staleStatusRes.data?.data?.salons || []).map((i) => String(i.claimId));
    check("Requesting the disallowed old 'PENDING_APPROVAL' status value still returns 200 and the safe Active result set (never the disallowed data, never an error)", staleStatusRes.status === 200 && staleIds.includes(String(s3.claim._id)) && !staleIds.includes(String(s1.claim._id)), { staleIds });

    // ═══════════════════════════════════════════════════════════
    // 7. Existing abandoned claims remain in the DB, untouched —
    //    no deletion, no mutation, by this read.
    // ═══════════════════════════════════════════════════════════
    const s1Reread = await AcquisitionClaim.findById(s1.claim._id).lean();
    check("7. Abandoned PENDING_APPROVAL claim (scenario 1) is UNCHANGED in the DB after being excluded from the list read", s1Reread && s1Reread.status === "PENDING_APPROVAL", s1Reread);
    const s1SalonReread = await Salon.findById(s1.salon._id).select("approval.status onboarding.step").lean();
    check("7b. Abandoned DRAFT salon (scenario 1) is UNCHANGED in the DB — still DRAFT, still step 0", s1SalonReread?.approval?.status === "DRAFT" && s1SalonReread?.onboarding?.step === 0, s1SalonReread);

    // ═══════════════════════════════════════════════════════════
    // 8. Pagination remains correct after filtering.
    // ═══════════════════════════════════════════════════════════
    const page1 = await authFetch(`/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=1&limit=1`, faA.token, { method: "GET" });
    const page2 = await authFetch(`/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=2&limit=1`, faA.token, { method: "GET" });
    // Agent A's qualifying ACTIVE_RECOVERY (not-reached) claims at this point: s3, s6a — exactly 2.
    check("8. Pagination total reflects ONLY the 2 qualifying claims (s3, s6a) — abandoned/ended/other-agent/gated-by-salon-approval claims (s1,s2,s5,sB,s6b,s7,s8,s9) never inflate the count", page1.data?.pagination?.total === 2, page1.data?.pagination);
    check("8b. page=1&limit=1 returns exactly 1 item, page=2&limit=1 returns the other — no duplicate, no gap", (page1.data?.data?.salons || []).length === 1 && (page2.data?.data?.salons || []).length === 1 && page1.data.data.salons[0].claimId !== page2.data.data.salons[0].claimId, { page1: page1.data?.data?.salons, page2: page2.data?.data?.salons });

    // ═══════════════════════════════════════════════════════════
    // Spot-check: existing recovery-progress/owner-grouping data is
    // still intact on a returned item (₹200 target, owner phone).
    // ═══════════════════════════════════════════════════════════
    const activeItemS3 = (activeRes.data?.data?.salons || []).find((i) => String(i.claimId) === String(s3.claim._id));
    check("Recovery progress fields (target/recovered/remaining/progressPercent) are intact on a returned item", activeItemS3?.targetAmount === 20000 && activeItemS3?.recoveredAmount === 5000 && activeItemS3?.remainingAmount === 15000, activeItemS3);
    check("Owner-grouping data (salon.ownerId.phone) is intact on a returned item", !!activeItemS3?.salon?.ownerId?.phone, activeItemS3?.salon);

  } finally {
    await AcquisitionEarningProgress.deleteMany({ _id: { $in: createdIds.progress } });
    await AcquisitionClaim.deleteMany({ _id: { $in: createdIds.claims.filter(Boolean) } });
    await AcquisitionReferral.deleteMany({ _id: { $in: createdIds.referrals.filter(Boolean) } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons.filter(Boolean) } });
    await FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } });
    await FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } });
    await User.deleteMany({ _id: { $in: createdIds.users.filter(Boolean) } });

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
