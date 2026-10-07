/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyMyAcquiredSalonsOwnerGrouping.js
 *
 * "My Acquired Salons Owner Grouping" — focused live verification of
 * the ONE backend change (acquisitionRecovery.service.js's
 * SALON_POPULATE_OPTIONS now nested-populates ownerId -> phone/name)
 * that the new frontend owner-grouping depends on. Confirms:
 *   - ownerId/phone/name are present and correct on every item
 *   - same owner's claims all carry the SAME ownerId
 *   - different owners carry different ownerId
 *   - every other existing field (claimId, status, basicInfo, amounts,
 *     progress) is unchanged
 *   - cross-agent isolation still holds (query filter untouched)
 *   - pagination (page/limit/total) still behaves identically
 *
 * Disposable fixtures, fully cleaned up in `finally`.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyMyAcquiredSalonsOwnerGrouping.js
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

// PHASE 11G — "Fix My Acquired Salons Visibility" (2026-10-02) UPDATE.
// This script's own fixtures previously hardcoded every claim to
// `status: "PENDING_APPROVAL"` — correct for the OLD "Pending tab"
// this screen used to have, but the endpoint this script exercises
// (listMyAcquisitionRecovery) can structurally never return a
// PENDING_APPROVAL claim anymore. Fixtures now default to
// `claimStatus: "ACTIVE_RECOVERY"` (with a matching
// AcquisitionEarningProgress row, since that is now the one thing the
// endpoint actually filters on) so this script keeps testing the real
// feature (owner grouping of ACTIVE_RECOVERY claims) under the new,
// correct rule — not the removed one. Deliberately keeps Owner X's 3
// salons at 3 DIFFERENT Salon.approval.status values (DRAFT/PENDING/
// APPROVED) specifically BECAUSE Phase 11G's own backend change never
// filters on Salon.approval.status at all (confirmed by reading
// listMyAcquisitionRecovery directly) — only on claim.status. This
// keeps proving that independence, now against the corrected
// endpoint, rather than silently dropping that coverage.
const makeClaimedSalon = async ({ ownerId, ownerPhone, fieldAgentId, label, approvalStatus = "DRAFT", claimStatus = "ACTIVE_RECOVERY" }) => {
  let realOwnerId = ownerId;
  if (!realOwnerId) {
    const owner = await User.create({ name: "ZE2E_GROUPING_OWNER", phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
    createdIds.users.push(owner._id);
    realOwnerId = owner._id;
  }
  const salon = await Salon.findOneAndUpdate(
    { _id: new mongoose.Types.ObjectId() },
    { $set: { ownerId: realOwnerId, "onboarding.step": 0, "approval.status": approvalStatus, "basicInfo.shopName": `ZE2E_GROUPING_${label}` } },
    { new: true, upsert: true, runValidators: false, setDefaultsOnInsert: false }
  );
  createdIds.salons.push(salon._id);
  const referral = await AcquisitionReferral.create({
    code: `ZE2EGROUPING-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    fieldAgentRef: fieldAgentId, status: "CONSUMED",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), consumedSalonRef: salon._id, consumedAt: new Date(),
  });
  createdIds.referrals.push(referral._id);
  const claim = await AcquisitionClaim.create({ salonRef: salon._id, fieldAgentRef: fieldAgentId, referralRef: referral._id, status: claimStatus });
  createdIds.claims.push(claim._id);
  if (claimStatus === "ACTIVE_RECOVERY") {
    const progress = await AcquisitionEarningProgress.create({
      acquisitionClaimRef: claim._id, salonRef: salon._id, targetInPaise: 20000, earnedInPaise: 0, status: "IN_PROGRESS",
    });
    createdIds.progress.push(progress._id);
  }
  return { ownerId: realOwnerId, salon, claim };
};

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);

  try {
    // ── Agent A: Owner X (3 salons), Owner Y (1 salon) ──
    const faA = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "GROUPING_A");
    createdIds.users.push(faA.agentUser._id);
    createdIds.applications.push(faA.application._id);
    createdIds.fieldAgents.push(faA.fieldAgent._id);

    // PHASE 11G-FINAL — "Approved Salon Gate" (2026-10-02) UPDATE. All
    // fixtures below now explicitly pass `approvalStatus: "APPROVED"`
    // — the new production rule requires it, and the ticket's own
    // instruction is explicit: "Do not weaken the production rule to
    // satisfy old fixtures." Owner X's 3 salons were previously DRAFT/
    // PENDING/APPROVED specifically to prove salon status didn't gate
    // visibility (the OLD rule) — that is now the opposite of correct,
    // so all 3 are APPROVED here instead; the owner-grouping feature
    // this script actually exists to test (claims correctly grouped
    // by owner, never collapsed into one) is identical either way.
    const ownerXPhone = nextPhone("7");
    const fixX1 = await makeClaimedSalon({ ownerPhone: ownerXPhone, fieldAgentId: faA.fieldAgent._id, label: "X1", approvalStatus: "APPROVED" });
    const fixX2 = await makeClaimedSalon({ ownerId: fixX1.ownerId, fieldAgentId: faA.fieldAgent._id, label: "X2", approvalStatus: "APPROVED" });
    const fixX3 = await makeClaimedSalon({ ownerId: fixX1.ownerId, fieldAgentId: faA.fieldAgent._id, label: "X3", approvalStatus: "APPROVED" });
    const fixY = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faA.fieldAgent._id, label: "Y1", approvalStatus: "APPROVED" });

    // ── Agent B: Owner Z (own salon, own agent — cross-agent isolation target) ──
    const faB = await makeActiveFieldAgent({ User, FieldAgentApplication, FieldAgent }, generateAccessToken, "GROUPING_B");
    createdIds.users.push(faB.agentUser._id);
    createdIds.applications.push(faB.application._id);
    createdIds.fieldAgents.push(faB.fieldAgent._id);
    const fixZ = await makeClaimedSalon({ ownerPhone: nextPhone("7"), fieldAgentId: faB.fieldAgent._id, label: "Z1", approvalStatus: "APPROVED" });

    // ── TEST 1: Agent A's full recovery list (page 1, large limit) ──
    const rA = await authFetch("/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=1&limit=20", faA.token, { method: "GET" });
    check("Agent A: recovery list -> 200", rA.status === 200, rA);
    const itemsA = rA.data?.data?.salons || [];
    check("Agent A: exactly 4 claims returned (3 for Owner X + 1 for Owner Y)", itemsA.length === 4, itemsA.map((i) => i.claimId));

    const ownerXItems = itemsA.filter((i) => String(i.salon?.ownerId?._id) === String(fixX1.ownerId));
    check("Owner X: exactly 3 claims, all carrying the SAME ownerId", ownerXItems.length === 3, ownerXItems.map((i) => i.salon?.ownerId));
    check("Owner X: ownerId._id matches the real owner across all 3", ownerXItems.every((i) => String(i.salon.ownerId._id) === String(fixX1.ownerId)), ownerXItems);
    check("Owner X: phone populated and correct on every item", ownerXItems.every((i) => i.salon.ownerId.phone === ownerXPhone), ownerXItems.map((i) => i.salon?.ownerId?.phone));

    // approval.status isn't in the populate select by default (only
    // basicInfo.shopName/location.address/ownerId) — verify via a
    // direct DB read instead, confirming each of Owner X's 3 salon
    // DOCUMENTS remains its own independent record (no "latest wins"
    // collapsing anywhere server-side) — all 3 are APPROVED under the
    // new Phase 11G-Final rule (see this script's own header update),
    // so this now checks document independence/count, not status
    // diversity (which would be the OLD, now-incorrect, assumption).
    const salonXDocs = await Salon.find({ _id: { $in: [fixX1.salon._id, fixX2.salon._id, fixX3.salon._id] } }).select("approval.status").lean();
    check("Owner X's 3 salons are 3 INDEPENDENT documents, all correctly APPROVED, nothing collapsed into one", salonXDocs.length === 3 && salonXDocs.every((s) => s.approval?.status === "APPROVED"), salonXDocs);

    const ownerYItems = itemsA.filter((i) => String(i.salon?.ownerId?._id) === String(fixY.ownerId));
    check("Owner Y: exactly 1 claim (single-salon owner, no grouping artifact)", ownerYItems.length === 1, ownerYItems);
    check("Owner X and Owner Y have DIFFERENT ownerId", String(ownerXItems[0]?.salon?.ownerId?._id) !== String(ownerYItems[0]?.salon?.ownerId?._id), { x: ownerXItems[0]?.salon?.ownerId, y: ownerYItems[0]?.salon?.ownerId });

    // ── TEST 2: cross-agent isolation — Agent A must never see Agent B's (Owner Z's) claim ──
    const leaked = itemsA.some((i) => String(i.claimId) === String(fixZ.claim._id));
    check("Cross-agent isolation: Agent A's list does NOT include Agent B's claim (Owner Z)", !leaked, itemsA.map((i) => i.claimId));

    // ── TEST 3: Agent B sees only their own (Owner Z) ──
    const rB = await authFetch("/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=1&limit=20", faB.token, { method: "GET" });
    const itemsB = rB.data?.data?.salons || [];
    check("Agent B: recovery list -> 200, exactly 1 claim (their own Owner Z)", rB.status === 200 && itemsB.length === 1, itemsB);
    check("Agent B's claim ownerId matches Owner Z, not Owner X/Y", itemsB[0] && String(itemsB[0].salon?.ownerId?._id) === String(fixZ.ownerId), itemsB[0]?.salon?.ownerId);

    // ── TEST 4: pagination — limit=2 still returns correct page/total, same as before ──
    const rPage1 = await authFetch("/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=1&limit=2", faA.token, { method: "GET" });
    const rPage2 = await authFetch("/api/field-agent/acquisition/recovery?status=ACTIVE_RECOVERY&page=2&limit=2", faA.token, { method: "GET" });
    check("Pagination page 1 (limit=2): 2 items, total=4", rPage1.data?.data?.salons?.length === 2 && rPage1.data?.pagination?.total === 4, rPage1.data?.pagination);
    check("Pagination page 2 (limit=2): remaining 2 items, total=4", rPage2.data?.data?.salons?.length === 2 && rPage2.data?.pagination?.total === 4, rPage2.data?.pagination);
    const combinedIds = new Set([...(rPage1.data?.data?.salons || []), ...(rPage2.data?.data?.salons || [])].map((i) => i.claimId));
    check("Pagination: combining both pages yields all 4 distinct claims (no dupes, no gaps)", combinedIds.size === 4, [...combinedIds]);
    // Confirms the documented pagination caveat directly: page 1 alone
    // does NOT necessarily contain all of Owner X's 3 salons.
    const ownerXInPage1 = (rPage1.data?.data?.salons || []).filter((i) => String(i.salon?.ownerId?._id) === String(fixX1.ownerId)).length;
    console.log(`\n(info, not a failure) Owner X claims visible on page 1 alone (limit=2): ${ownerXInPage1} of 3 — confirms grouping never implies "all loaded" before pagination catches up.`);

    // ── TEST 5: existing fields unchanged (basicInfo.shopName, location.address, amounts) ──
    const sampleX1 = itemsA.find((i) => String(i.claimId) === String(fixX1.claim._id));
    check("Existing field preserved: basicInfo.shopName", sampleX1?.salon?.basicInfo?.shopName === "ZE2E_GROUPING_X1", sampleX1?.salon?.basicInfo);
    check("Existing fields preserved: targetAmount/recoveredAmount/remainingAmount/progressPercent all present", sampleX1 && "targetAmount" in sampleX1 && "recoveredAmount" in sampleX1 && "remainingAmount" in sampleX1 && "progressPercent" in sampleX1, sampleX1);
    check("Existing field preserved: claimId matches the real claim", String(sampleX1?.claimId) === String(fixX1.claim._id), sampleX1?.claimId);

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
