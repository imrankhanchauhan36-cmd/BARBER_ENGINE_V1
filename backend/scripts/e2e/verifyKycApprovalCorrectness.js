/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyKycApprovalCorrectness.js
 *
 * PHASE C.2 — KYC Approval Correctness. Disposable, real-Mongo,
 * real-HTTP verification of the state-machine guard, concurrency fix,
 * and reject-side timeline cleanup added to
 * modules/kyc/services/kyc.service.js. Same proven methodology as
 * verifySalonApprovalCorrectness.js (Phase C.1) and the shared
 * fieldAgentE2EHelpers.js fixtures.
 *
 * Covers ticket sections A-K:
 *   A. Approve from each valid source status
 *   B. Reject from each valid source status
 *   C. Invalid approve (VERIFIED/REJECTED/DRAFT/EXPIRED) -> 409
 *   D. Invalid reject (VERIFIED/REJECTED/DRAFT/EXPIRED) -> 409
 *   E. Reject clears approvedAt/expiresAt (via a controlled fixture,
 *      never by bypassing the state guard)
 *   F. Concurrency — two near-simultaneous decisions, exactly one wins
 *   G. VerificationLog — exactly one event per successful decision
 *   H. Notifications fire
 *   I. Resubmission regression (REJECTED -> submitKYC -> PENDING -> APPROVE -> VERIFIED)
 *   J. RBAC regression (DISTRICT 403, STATE/INDIA allowed)
 *   K. Frontend checks are static (see report) — not re-run here
 *
 * SAFETY — creates only NAME_PREFIX-tagged fixtures. Cleans up every
 * created document in a finally block and reports before/after counts.
 * Never touches real KYC/Salon/User data.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyKycApprovalCorrectness.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import Salon from "../../models/Salon.js";
import State from "../../models/State.js";
import District from "../../models/District.js";
import City from "../../models/City.js";
import Area from "../../models/Area.js";
import Country from "../../models/Country.js";
import Notification from "../../models/Notification.js";
import KYC from "../../modules/kyc/models/KYC.js";
import KYCDocument from "../../modules/kyc/models/KYCDocument.js";
import VerificationLog from "../../modules/kyc/models/VerificationLog.js";
import { KYC_STATUS, APPLICANT_TYPE, DOCUMENT_TYPE } from "../../modules/kyc/constants/kyc.constants.js";
import { submitKYC } from "../../modules/kyc/services/ownerKyc.service.js";

import { makeGeoFixture, nextPhone } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const NAME_PREFIX = "ZTEST_KYCAPPROVAL_";

const run = async () => {
  await connectDB();

  const before = {
    User: await User.countDocuments({}),
    Salon: await Salon.countDocuments({}),
    State: await State.countDocuments({}),
    KYC: await KYC.countDocuments({}),
    KYCDocument: await KYCDocument.countDocuments({}),
    VerificationLog: await VerificationLog.countDocuments({}),
    Notification: await Notification.countDocuments({}),
  };
  results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

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

  const createdIds = { users: [], salons: [], states: [], districts: [], cities: [], areas: [], kycs: [], documents: [] };

  try {
    // ── GEO FIXTURES ───────────────────────────────────────────
    const geoA = await makeGeoFixture({ Country, State, District, City, Area }, "KYCAPPR_A");
    createdIds.states.push(geoA.state._id);
    createdIds.districts.push(geoA.district._id);
    createdIds.cities.push(geoA.city._id);
    createdIds.areas.push(geoA.area._id);

    // ── ADMIN FIXTURES ─────────────────────────────────────────
    const mkAdmin = async (label, adminLevel, stateRef, districtRef) => {
      const u = await User.create({
        name: `${NAME_PREFIX}${label}`,
        phone: nextPhone("8"),
        email: `${NAME_PREFIX.toLowerCase()}${label.toLowerCase()}_${Date.now()}@example.test`,
        role: "ADMIN",
        adminLevel,
        countryRef: geoA.country._id,
        stateRef: stateRef || null,
        districtRef: districtRef || null,
        adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
        accountStatus: "ACTIVE",
        tokenVersion: 0,
      });
      createdIds.users.push(u._id);
      const token = generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 });
      return { user: u, token };
    };

    // ONE INDIA ADMIN is a hard unique-index constraint — reuse the
    // real one read-only, same precedent as verifySalonApprovalCorrectness.js.
    const indiaAdminDoc = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } }).select("+tokenVersion");
    if (!indiaAdminDoc) throw new Error("No real INDIA admin exists in this DB — cannot proceed");
    const indiaAdmin = { user: indiaAdminDoc, token: generateAccessToken({ _id: indiaAdminDoc._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdminDoc.tokenVersion ?? 0 }) };

    const stateAdminA    = await mkAdmin("STATE_ADMIN_A", "STATE", geoA.state._id);
    const districtAdminA = await mkAdmin("DISTRICT_ADMIN_A", "DISTRICT", geoA.state._id, geoA.district._id);

    // ── OWNER + SALON (so KYC scope resolution has a real territory) ──
    const mkOwnerWithSalon = async (label) => {
      const ownerPhone = nextPhone("7");
      const owner = await User.create({ name: `${NAME_PREFIX}OWNER_${label}`, phone: ownerPhone, role: "OWNER", accountStatus: "ACTIVE" });
      createdIds.users.push(owner._id);
      const dayTiming = { open: "09:00", close: "20:00" };
      const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
      const salon = await Salon.create({
        ownerId: owner._id,
        basicInfo: { shopName: `${NAME_PREFIX}SALON_${label}_${Date.now()}`, category: "UNISEX" },
        location: {
          address: `${NAME_PREFIX} addr`,
          geo: { type: "Point", coordinates: [77, 28] },
          territory: { countryRef: geoA.country._id, stateRef: geoA.state._id, districtRef: geoA.district._id, cityRef: geoA.city._id, areaRef: geoA.area._id },
        },
        timings, approval: { status: "APPROVED" }, onboarding: { step: 7 }, isDeleted: false,
      });
      createdIds.salons.push(salon._id);
      return { owner, salon };
    };

    const mkKYC = async (owner, status, extra = {}) => {
      const kyc = await KYC.create({
        ownerId: owner._id,
        applicantType: APPLICANT_TYPE.OWNER,
        status,
        ...extra,
      });
      createdIds.kycs.push(kyc._id);
      return kyc;
    };

    const countLogs = (kycId, action) => VerificationLog.countDocuments({ kycId, action });

    // ════════════════════════════════════════════════════════════
    // SECTION A — approve from each valid source status
    // ════════════════════════════════════════════════════════════
    for (const srcStatus of [KYC_STATUS.PENDING, KYC_STATUS.UNDER_REVIEW, KYC_STATUS.PARTIALLY_VERIFIED]) {
      const { owner } = await mkOwnerWithSalon(`A_${srcStatus}`);
      const kyc = await mkKYC(owner, srcStatus);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) });
      check(`A. ${srcStatus} -> VERIFIED = 200`, r.status === 200, r.data);
      const after = await KYC.findById(kyc._id);
      check(`A. ${srcStatus} -> VERIFIED: status correct`, after.status === KYC_STATUS.VERIFIED);
      check(`A. ${srcStatus} -> VERIFIED: exactly 1 ADMIN_APPROVED log`, (await countLogs(kyc._id, "ADMIN_APPROVED")) === 1);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION B — reject from each valid source status
    // ════════════════════════════════════════════════════════════
    for (const srcStatus of [KYC_STATUS.PENDING, KYC_STATUS.UNDER_REVIEW, KYC_STATUS.PARTIALLY_VERIFIED]) {
      const { owner } = await mkOwnerWithSalon(`B_${srcStatus}`);
      const kyc = await mkKYC(owner, srcStatus);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Document quality insufficient" }) });
      check(`B. ${srcStatus} -> REJECTED = 200`, r.status === 200, r.data);
      const after = await KYC.findById(kyc._id);
      check(`B. ${srcStatus} -> REJECTED: status correct`, after.status === KYC_STATUS.REJECTED);
      check(`B. ${srcStatus} -> REJECTED: exactly 1 ADMIN_REJECTED log`, (await countLogs(kyc._id, "ADMIN_REJECTED")) === 1);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION C — invalid approve
    // ════════════════════════════════════════════════════════════
    for (const srcStatus of [KYC_STATUS.VERIFIED, KYC_STATUS.REJECTED, KYC_STATUS.DRAFT, KYC_STATUS.EXPIRED]) {
      const { owner } = await mkOwnerWithSalon(`C_${srcStatus}`);
      const kyc = await mkKYC(owner, srcStatus);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) });
      check(`C. ${srcStatus} -> APPROVE = 409`, r.status === 409, r.data);
      const after = await KYC.findById(kyc._id);
      check(`C. ${srcStatus} -> APPROVE: status unchanged`, after.status === srcStatus, after.status);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION D — invalid reject
    // ════════════════════════════════════════════════════════════
    for (const srcStatus of [KYC_STATUS.VERIFIED, KYC_STATUS.REJECTED, KYC_STATUS.DRAFT, KYC_STATUS.EXPIRED]) {
      const { owner } = await mkOwnerWithSalon(`D_${srcStatus}`);
      const kyc = await mkKYC(owner, srcStatus);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Testing invalid reject transition" }) });
      check(`D. ${srcStatus} -> REJECT = 409`, r.status === 409, r.data);
      const after = await KYC.findById(kyc._id);
      check(`D. ${srcStatus} -> REJECT: status unchanged`, after.status === srcStatus, after.status);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION E — reject clears approvedAt/expiresAt
    // Tested via a controlled fixture (status=PENDING, a fully valid
    // source state, with approvedAt/expiresAt pre-seeded to simulate
    // stale leftover data) rather than by bypassing the new guard —
    // the transition exercised below (PENDING -> REJECTED) is itself
    // fully valid and goes through the normal guarded path.
    // ════════════════════════════════════════════════════════════
    {
      const { owner } = await mkOwnerWithSalon("E_CLEAR");
      const staleExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING, { approvedAt: new Date(), expiresAt: staleExpiry });
      check("E. Fixture pre-condition: approvedAt/expiresAt seeded", !!kyc.approvedAt && !!kyc.expiresAt);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Clearing stale approval fields on reject" }) });
      check("E. Valid PENDING -> REJECTED = 200", r.status === 200, r.data);
      const after = await KYC.findById(kyc._id);
      check("E. approvedAt cleared on reject", after.approvedAt === null, after.approvedAt);
      check("E. expiresAt cleared on reject", after.expiresAt === null, after.expiresAt);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION F — concurrency: two near-simultaneous decisions
    // ════════════════════════════════════════════════════════════
    {
      const { owner } = await mkOwnerWithSalon("F_RACE1");
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING);
      const [rApprove, rReject] = await Promise.all([
        authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) }),
        authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Racing rejection attempt" }) }),
      ]);
      const codes = [rApprove.status, rReject.status].sort();
      check("F1. Exactly one of {approve,reject} succeeded (200) and the other conflicted (409)", JSON.stringify(codes) === JSON.stringify([200, 409]), { approve: rApprove.status, reject: rReject.status });
      const after = await KYC.findById(kyc._id);
      const winnerStatus = rApprove.status === 200 ? KYC_STATUS.VERIFIED : KYC_STATUS.REJECTED;
      check("F1. Final status matches the winning request", after.status === winnerStatus, after.status);
      const totalDecisionLogs = (await countLogs(kyc._id, "ADMIN_APPROVED")) + (await countLogs(kyc._id, "ADMIN_REJECTED"));
      check("F1. Exactly one new decision event recorded for this race", totalDecisionLogs === 1, totalDecisionLogs);
    }
    {
      const { owner } = await mkOwnerWithSalon("F_RACE2");
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING);
      const [rReject, rApprove] = await Promise.all([
        authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Racing rejection attempt, reversed order" }) }),
        authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) }),
      ]);
      const codes = [rApprove.status, rReject.status].sort();
      check("F2. (reversed order) Exactly one succeeded, one conflicted", JSON.stringify(codes) === JSON.stringify([200, 409]), { approve: rApprove.status, reject: rReject.status });
      const after = await KYC.findById(kyc._id);
      const winnerStatus = rApprove.status === 200 ? KYC_STATUS.VERIFIED : KYC_STATUS.REJECTED;
      check("F2. Final status matches the winning request", after.status === winnerStatus, after.status);
      const totalDecisionLogs = (await countLogs(kyc._id, "ADMIN_APPROVED")) + (await countLogs(kyc._id, "ADMIN_REJECTED"));
      check("F2. Exactly one new decision event recorded for this race", totalDecisionLogs === 1, totalDecisionLogs);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION G — VerificationLog immutability spot-check
    // ════════════════════════════════════════════════════════════
    {
      const anyLog = await VerificationLog.findOne({ kycId: { $in: createdIds.kycs } });
      if (anyLog) {
        let threw = false;
        try { await VerificationLog.updateOne({ _id: anyLog._id }, { $set: { success: false } }); }
        catch { threw = true; }
        check("G. VerificationLog update is blocked (immutable)", threw);
      } else {
        check("G. VerificationLog update is blocked (immutable)", false, "no log found to test");
      }
    }

    // ════════════════════════════════════════════════════════════
    // SECTION H — notifications
    // ════════════════════════════════════════════════════════════
    {
      const { owner, salon } = await mkOwnerWithSalon("H_NOTIF");
      const kycApprove = await mkKYC(owner, KYC_STATUS.PENDING);
      await authFetch(`/api/admin/kyc/${kycApprove._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) });
      const approveNotif = await Notification.findOne({ recipientId: salon._id, recipientType: "SALON" }).sort({ createdAt: -1 });
      check("H. Approval notification document created", !!approveNotif, approveNotif);
    }
    {
      const { owner, salon } = await mkOwnerWithSalon("H_NOTIF_REJ");
      const kycReject = await mkKYC(owner, KYC_STATUS.PENDING);
      await authFetch(`/api/admin/kyc/${kycReject._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Testing rejection notification" }) });
      const rejectNotif = await Notification.findOne({ recipientId: salon._id, recipientType: "SALON" }).sort({ createdAt: -1 });
      check("H. Rejection notification document created", !!rejectNotif, rejectNotif);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION I — resubmission regression
    // REJECTED -> (real, unmodified submitKYC service) -> PENDING
    //   -> (real HTTP admin approve) -> VERIFIED
    // ════════════════════════════════════════════════════════════
    {
      const { owner } = await mkOwnerWithSalon("I_RESUBMIT");
      const mkDoc = async (documentType) => {
        const doc = await KYCDocument.create({ ownerId: owner._id, kycId: new mongoose.Types.ObjectId(), documentType, originalUrl: "https://example.test/doc.jpg", status: "UPLOADED" });
        createdIds.documents.push(doc._id);
        return doc._id;
      };
      const docs = {
        panCard: await mkDoc(DOCUMENT_TYPE.PAN_CARD),
        aadhaarFront: await mkDoc(DOCUMENT_TYPE.AADHAAR_FRONT),
        aadhaarBack: await mkDoc(DOCUMENT_TYPE.AADHAAR_BACK),
        cancelledCheque: await mkDoc(DOCUMENT_TYPE.CANCELLED_CHEQUE),
        selfie: await mkDoc(DOCUMENT_TYPE.SELFIE),
      };
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING, {
        documents: docs,
        identity: { pan: { maskedNumber: "ABCDE****F" }, aadhaar: { maskedNumber: "XXXX XXXX 1234" } },
        bank: { accountHolder: `${NAME_PREFIX}OWNER`, maskedAccount: "XXXX1234", ifsc: "HDFC0001234" },
      });

      // Fix up the documents' kycId refs to point at the real kyc now
      // that it exists (created before the KYC doc did, since KYC.create
      // needs the document ids and KYCDocument.create needs a kycId).
      await KYCDocument.updateMany({ _id: { $in: Object.values(docs) } }, { $set: { kycId: kyc._id } });

      // Real reject via the live HTTP endpoint first — produces a
      // genuine ADMIN_REJECTED VerificationLog entry, so the
      // "history survives resubmission" assertion below is testing a
      // real event, not a fabricated fixture field.
      const rReject = await authFetch(`/api/admin/kyc/${kyc._id}/reject`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({ reason: "Original rejection — illegible PAN" }) });
      check("I. Initial real rejection = 200", rReject.status === 200, rReject.data);

      const kycAfterReject = await KYC.findById(kyc._id);
      const resubmitted = await submitKYC({ kyc: kycAfterReject, requestId: null });
      check("I. Resubmission (submitKYC): REJECTED -> PENDING", resubmitted.status === KYC_STATUS.PENDING, resubmitted.status);
      check("I. Resubmission clears review.rejectReason", resubmitted.review.rejectReason === null, resubmitted.review.rejectReason);

      const rApprove = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify({}) });
      check("I. Final admin approval after resubmission = 200", rApprove.status === 200, rApprove.data);
      const final = await KYC.findById(kyc._id);
      check("I. Final status = VERIFIED", final.status === KYC_STATUS.VERIFIED);

      const originalRejectionLogStillExists = await VerificationLog.findOne({ kycId: kyc._id, action: "ADMIN_REJECTED" });
      check("I. Original rejection history still present in VerificationLog after resubmission+approval", !!originalRejectionLogStillExists);
    }

    // ════════════════════════════════════════════════════════════
    // SECTION J — RBAC regression
    // ════════════════════════════════════════════════════════════
    {
      const { owner } = await mkOwnerWithSalon("J_DISTRICT_APPROVE");
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, districtAdminA.token, { method: "PATCH", body: JSON.stringify({}) });
      check("J. DISTRICT approve = 403", r.status === 403, r.data);
    }
    {
      const { owner } = await mkOwnerWithSalon("J_DISTRICT_REJECT");
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/reject`, districtAdminA.token, { method: "PATCH", body: JSON.stringify({ reason: "District attempting reject" }) });
      check("J. DISTRICT reject = 403", r.status === 403, r.data);
    }
    {
      const { owner } = await mkOwnerWithSalon("J_STATE_OWN_APPROVE");
      const kyc = await mkKYC(owner, KYC_STATUS.PENDING);
      const r = await authFetch(`/api/admin/kyc/${kyc._id}/approve`, stateAdminA.token, { method: "PATCH", body: JSON.stringify({}) });
      check("J. STATE approve within own scope = 200", r.status === 200, r.data);
    }

  } catch (err) {
    console.error("SCRIPT ERROR (will still clean up below):", err);
    fail++;
    results.push(`❌ FATAL SCRIPT ERROR — ${err.message}`);
  } finally {
    server.close();

    // ── CLEANUP — only this script's own NAME_PREFIX-tagged fixtures ──
    // deleteMany is not in VerificationLog's own BLOCKED_OPS list (only
    // findOneAndUpdate/updateOne/updateMany/findByIdAndUpdate/update
    // are — see that model's own immutability hooks), so the ordinary
    // Mongoose model method works here without a raw collection bypass.
    await VerificationLog.deleteMany({ kycId: { $in: createdIds.kycs } });
    await KYC.deleteMany({ _id: { $in: createdIds.kycs } });
    await KYCDocument.deleteMany({ _id: { $in: createdIds.documents } });
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    await District.deleteMany({ _id: { $in: createdIds.districts } });
    await State.deleteMany({ _id: { $in: createdIds.states } });
    await City.deleteMany({ _id: { $in: createdIds.cities } });
    await Area.deleteMany({ _id: { $in: createdIds.areas } });
    await Notification.deleteMany({ recipientId: { $in: createdIds.salons } });

    const after = {
      User: await User.countDocuments({}),
      Salon: await Salon.countDocuments({}),
      State: await State.countDocuments({}),
      KYC: await KYC.countDocuments({}),
      KYCDocument: await KYCDocument.countDocuments({}),
      VerificationLog: await VerificationLog.countDocuments({}),
      Notification: await Notification.countDocuments({}),
    };
    results.push(`ℹ️  AFTER counts (post-cleanup): ${JSON.stringify(after)}`);
    results.push(`ℹ️  Net change: ${JSON.stringify(Object.fromEntries(Object.keys(before).map(k => [k, after[k] - before[k]])))}`);

    console.log(results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);

    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
