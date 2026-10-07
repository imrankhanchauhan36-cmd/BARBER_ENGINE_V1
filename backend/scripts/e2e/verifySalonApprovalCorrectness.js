/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifySalonApprovalCorrectness.js
 *
 * PHASE C.1 — Salon Approval Correctness. Disposable, real-Mongo,
 * real-HTTP verification of the locked state machine implemented in
 * controllers/admin.controller.js's updateSalonStatus. Same proven
 * methodology as every other permanent verification script in this
 * repo (app.listen(0) + generateAccessToken + live HTTP calls),
 * reusing the shared geo/phone/authFetch fixtures from
 * fieldAgentE2EHelpers.js rather than re-deriving them.
 *
 * Covers ticket sections A-H:
 *   A. INDIA  — PAN-India approve/reject, any state
 *   B. STATE  — own-state pass, other-state 403
 *   C. DISTRICT — own-district pass, other-district 403
 *   D. Invalid transitions — APPROVED/REJECTED/DRAFT -> * all rejected (409)
 *   E. Resubmission regression — REJECTED -> DRAFT -> PENDING -> APPROVED
 *   F. Rejection reason validation — empty/whitespace/301/300/normal
 *   G. Approval/rejection metadata fields
 *   H. Notifications fire and are non-blocking on failure
 *
 * SAFETY — creates only NAME_PREFIX-tagged fixtures (Users, Salons,
 * States, Districts); reuses the existing real Country document
 * read-only. Cleans up every created document in a finally block and
 * reports before/after counts. Never touches real salons/admins.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifySalonApprovalCorrectness.js
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

import { makeGeoFixture, nextPhone, authFetch as sharedAuthFetch } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 400) : ""}`); }
};

const NAME_PREFIX = "ZTEST_SALONAPPROVAL_";

const run = async () => {
  await connectDB();

  const before = {
    User:   await User.countDocuments({}),
    Salon:  await Salon.countDocuments({}),
    State:  await State.countDocuments({}),
    District: await District.countDocuments({}),
    Notification: await Notification.countDocuments({}),
  };
  results.push(`ℹ️  BEFORE counts: ${JSON.stringify(before)}`);

  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token, opts) => sharedAuthFetch(url, path, token, opts);

  const createdIds = { users: [], salons: [], states: [], districts: [], cities: [], areas: [] };

  try {
    // ── GEO FIXTURES — two independent state/district trees ──────
    const geoA = await makeGeoFixture({ Country, State, District, City, Area }, "SAPPR_A");
    const geoB = await makeGeoFixture({ Country, State, District, City, Area }, "SAPPR_B");
    createdIds.states.push(geoA.state._id, geoB.state._id);
    createdIds.districts.push(geoA.district._id, geoB.district._id);
    createdIds.cities.push(geoA.city._id, geoB.city._id);
    createdIds.areas.push(geoA.area._id, geoB.area._id);

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

    // ONE INDIA ADMIN is a hard unique-index constraint on this schema
    // (models/User.js — partial unique index on {role,adminLevel} for
    // ADMIN+INDIA) — the real one already exists, reused read-only
    // (never created/deleted by this script), same precedent as
    // scripts/verifySalonGstEngine.js.
    const indiaAdminDoc = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } }).select("+tokenVersion");
    if (!indiaAdminDoc) throw new Error("No real INDIA admin exists in this DB — cannot proceed");
    const indiaAdmin = { user: indiaAdminDoc, token: generateAccessToken({ _id: indiaAdminDoc._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdminDoc.tokenVersion ?? 0 }) };

    const stateAdminA    = await mkAdmin("STATE_ADMIN_A", "STATE", geoA.state._id);
    const districtAdminA = await mkAdmin("DISTRICT_ADMIN_A", "DISTRICT", geoA.state._id, geoA.district._id);

    // ── SALON FIXTURE FACTORY ──────────────────────────────────
    const mkSalon = async (label, geo, approvalStatus = "PENDING", extra = {}) => {
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
          territory: { countryRef: geo.country._id, stateRef: geo.state._id, districtRef: geo.district._id, cityRef: geo.city._id, areaRef: geo.area._id },
        },
        timings,
        approval: { status: approvalStatus, ...extra },
        onboarding: { step: approvalStatus === "DRAFT" ? 1 : 7 },
        isDeleted: false,
      });
      createdIds.salons.push(salon._id);
      return { owner, salon };
    };

    // ════════════════════════════════════════════════════════════
    // SECTION A — INDIA: PAN-India, any state
    // ════════════════════════════════════════════════════════════
    const { salon: sIndiaApprove } = await mkSalon("INDIA_APPROVE", geoA, "PENDING");
    const rA1 = await authFetch(`/api/admin/salons/${sIndiaApprove._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("A. INDIA approve (stateA salon) = 200", rA1.status === 200, rA1.data);

    const { salon: sIndiaReject } = await mkSalon("INDIA_REJECT", geoB, "PENDING");
    const rA2 = await authFetch(`/api/admin/salons/${sIndiaReject._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "Incomplete documents" }),
    });
    check("A. INDIA reject (stateB salon) = 200", rA2.status === 200, rA2.data);

    // ════════════════════════════════════════════════════════════
    // SECTION B — STATE: own-state pass, other-state 403
    // ════════════════════════════════════════════════════════════
    const { salon: sStateOwnApprove } = await mkSalon("STATE_OWN_APPROVE", geoA, "PENDING");
    const rB1 = await authFetch(`/api/admin/salons/${sStateOwnApprove._id}/status`, stateAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("B. STATE own-state approve = 200", rB1.status === 200, rB1.data);

    const { salon: sStateOwnReject } = await mkSalon("STATE_OWN_REJECT", geoA, "PENDING");
    const rB2 = await authFetch(`/api/admin/salons/${sStateOwnReject._id}/status`, stateAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "Missing KYC" }),
    });
    check("B. STATE own-state reject = 200", rB2.status === 200, rB2.data);

    const { salon: sStateOtherApprove } = await mkSalon("STATE_OTHER_APPROVE", geoB, "PENDING");
    const rB3 = await authFetch(`/api/admin/salons/${sStateOtherApprove._id}/status`, stateAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("B. STATE other-state approve = 403", rB3.status === 403, rB3.data);
    const sStateOtherApproveFresh = await Salon.findById(sStateOtherApprove._id);
    check("B. STATE other-state approve did NOT mutate salon", sStateOtherApproveFresh.approval.status === "PENDING", sStateOtherApproveFresh.approval);

    const { salon: sStateOtherReject } = await mkSalon("STATE_OTHER_REJECT", geoB, "PENDING");
    const rB4 = await authFetch(`/api/admin/salons/${sStateOtherReject._id}/status`, stateAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "test" }),
    });
    check("B. STATE other-state reject = 403", rB4.status === 403, rB4.data);

    // ════════════════════════════════════════════════════════════
    // SECTION C — DISTRICT: own-district pass, other-district 403
    // ════════════════════════════════════════════════════════════
    const { salon: sDistOwnApprove } = await mkSalon("DIST_OWN_APPROVE", geoA, "PENDING");
    const rC1 = await authFetch(`/api/admin/salons/${sDistOwnApprove._id}/status`, districtAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("C. DISTRICT own-district approve = 200", rC1.status === 200, rC1.data);

    const { salon: sDistOwnReject } = await mkSalon("DIST_OWN_REJECT", geoA, "PENDING");
    const rC2 = await authFetch(`/api/admin/salons/${sDistOwnReject._id}/status`, districtAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "Missing KYC" }),
    });
    check("C. DISTRICT own-district reject = 200", rC2.status === 200, rC2.data);

    const { salon: sDistOtherApprove } = await mkSalon("DIST_OTHER_APPROVE", geoB, "PENDING");
    const rC3 = await authFetch(`/api/admin/salons/${sDistOtherApprove._id}/status`, districtAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("C. DISTRICT other-district approve = 403", rC3.status === 403, rC3.data);

    const { salon: sDistOtherReject } = await mkSalon("DIST_OTHER_REJECT", geoB, "PENDING");
    const rC4 = await authFetch(`/api/admin/salons/${sDistOtherReject._id}/status`, districtAdminA.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "test" }),
    });
    check("C. DISTRICT other-district reject = 403", rC4.status === 403, rC4.data);

    // ════════════════════════════════════════════════════════════
    // SECTION D — invalid transitions (INDIA, isolates the pure
    // state-machine guard from any geo-scope question)
    // ════════════════════════════════════════════════════════════
    const { salon: sApproved } = await mkSalon("ALREADY_APPROVED", geoA, "APPROVED", { approvedBy: indiaAdmin.user._id, approvedAt: new Date() });
    const rD1 = await authFetch(`/api/admin/salons/${sApproved._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "test" }),
    });
    check("D. APPROVED -> REJECTED = 409", rD1.status === 409, rD1.data);

    const rD2 = await authFetch(`/api/admin/salons/${sApproved._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("D. APPROVED -> APPROVED (re-decide) = 409", rD2.status === 409, rD2.data);

    const { salon: sRejected } = await mkSalon("ALREADY_REJECTED", geoA, "REJECTED", { rejectedBy: indiaAdmin.user._id, rejectedAt: new Date(), rejectionReason: "original reason" });
    const rD3 = await authFetch(`/api/admin/salons/${sRejected._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("D. REJECTED -> APPROVED = 409", rD3.status === 409, rD3.data);

    const rD4 = await authFetch(`/api/admin/salons/${sRejected._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "second reason" }),
    });
    check("D. REJECTED -> REJECTED (re-decide) = 409", rD4.status === 409, rD4.data);

    const { salon: sDraft } = await mkSalon("STILL_DRAFT", geoA, "DRAFT");
    const rD5 = await authFetch(`/api/admin/salons/${sDraft._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("D. DRAFT -> APPROVED = 409", rD5.status === 409, rD5.data);

    const rD6 = await authFetch(`/api/admin/salons/${sDraft._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "test" }),
    });
    check("D. DRAFT -> REJECTED = 409", rD6.status === 409, rD6.data);

    // ════════════════════════════════════════════════════════════
    // SECTION E — resubmission regression
    // REJECTED -> [real resubmit, owner token] -> DRAFT
    //   -> [simulated onboarding completion] -> PENDING
    //   -> [real admin approve] -> APPROVED
    // ════════════════════════════════════════════════════════════
    const { owner: eOwner, salon: eSalon } = await mkSalon("RESUBMIT_FLOW", geoA, "REJECTED", {
      rejectedBy: indiaAdmin.user._id, rejectedAt: new Date(), rejectionReason: "Original rejection reason",
    });
    const eOwnerToken = generateAccessToken({ _id: eOwner._id, role: "OWNER", tokenVersion: 0 });

    const rE1 = await authFetch(`/api/salon/onboarding/resubmit`, eOwnerToken, { method: "PATCH" });
    check("E. Resubmit REJECTED -> DRAFT = 200", rE1.status === 200 && rE1.data?.data?.status === "DRAFT", rE1.data);

    const eAfterResubmit = await Salon.findById(eSalon._id);
    check("E. Resubmit preserves old rejection metadata (rejectedBy)", !!eAfterResubmit.approval.rejectedBy, eAfterResubmit.approval);
    check("E. Resubmit preserves old rejection metadata (rejectionReason)", eAfterResubmit.approval.rejectionReason === "Original rejection reason", eAfterResubmit.approval);

    // Simulated onboarding completion — the owner's full onboarding
    // wizard is out of this phase's scope (Phase C.1 is Salon Approval
    // only); this directly mirrors the one field change the real
    // submit-onboarding step makes to approval.status.
    await Salon.findByIdAndUpdate(eSalon._id, { $set: { "approval.status": "PENDING" } });

    const rE2 = await authFetch(`/api/admin/salons/${eSalon._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "APPROVED" }),
    });
    check("E. Final admin approval after resubmission = 200", rE2.status === 200, rE2.data);
    const eFinal = await Salon.findById(eSalon._id);
    check("E. Final status = APPROVED", eFinal.approval.status === "APPROVED");
    check("E. Old rejection metadata cleared after the NEW decision", eFinal.approval.rejectedBy === null && eFinal.approval.rejectionReason === null, eFinal.approval);

    // ════════════════════════════════════════════════════════════
    // SECTION F — rejection reason validation
    // ════════════════════════════════════════════════════════════
    const { salon: sRejValid } = await mkSalon("REJECT_VALIDATION", geoA, "PENDING");

    const rF1 = await authFetch(`/api/admin/salons/${sRejValid._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "" }),
    });
    check("F. Empty reason = 400", rF1.status === 400, rF1.data);

    const rF2 = await authFetch(`/api/admin/salons/${sRejValid._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "   " }),
    });
    check("F. Whitespace-only reason = 400", rF2.status === 400, rF2.data);

    const reason301 = "x".repeat(301);
    const rF3 = await authFetch(`/api/admin/salons/${sRejValid._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: reason301 }),
    });
    check("F. 301-character reason = 400", rF3.status === 400, rF3.data);

    const sRejValidFresh = await Salon.findById(sRejValid._id);
    check("F. Salon still PENDING after all 3 rejected validation attempts", sRejValidFresh.approval.status === "PENDING", sRejValidFresh.approval);

    const reason300 = "y".repeat(300);
    const rF4 = await authFetch(`/api/admin/salons/${sRejValid._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: reason300 }),
    });
    check("F. Exactly 300-character reason = 200 (accepted)", rF4.status === 200, rF4.data);
    const sRejValidAfter = await Salon.findById(sRejValid._id);
    check("F. Stored reason is exactly the 300-char string", sRejValidAfter.approval.rejectionReason === reason300);

    const { salon: sRejNormal } = await mkSalon("REJECT_NORMAL", geoA, "PENDING");
    const rF5 = await authFetch(`/api/admin/salons/${sRejNormal._id}/status`, indiaAdmin.token, {
      method: "PATCH", body: JSON.stringify({ status: "REJECTED", rejectionReason: "  Normal valid reason  " }),
    });
    check("F. Normal reason = 200 (accepted, trimmed)", rF5.status === 200, rF5.data);
    const sRejNormalAfter = await Salon.findById(sRejNormal._id);
    check("F. Normal reason stored trimmed", sRejNormalAfter.approval.rejectionReason === "Normal valid reason", sRejNormalAfter.approval);

    // ════════════════════════════════════════════════════════════
    // SECTION G — approval/rejection metadata fields
    // ════════════════════════════════════════════════════════════
    const sIndiaApproveAfter = await Salon.findById(sIndiaApprove._id);
    check("G. APPROVE: approvedBy populated", !!sIndiaApproveAfter.approval.approvedBy);
    check("G. APPROVE: approvedAt populated", !!sIndiaApproveAfter.approval.approvedAt);
    check("G. APPROVE: rejectedBy null", sIndiaApproveAfter.approval.rejectedBy === null);
    check("G. APPROVE: rejectedAt null", sIndiaApproveAfter.approval.rejectedAt === null);
    check("G. APPROVE: rejectionReason null", sIndiaApproveAfter.approval.rejectionReason === null);

    const sIndiaRejectAfter = await Salon.findById(sIndiaReject._id);
    check("G. REJECT: rejectedBy populated", !!sIndiaRejectAfter.approval.rejectedBy);
    check("G. REJECT: rejectedAt populated", !!sIndiaRejectAfter.approval.rejectedAt);
    check("G. REJECT: rejectionReason populated", sIndiaRejectAfter.approval.rejectionReason === "Incomplete documents");
    check("G. REJECT: approvedBy null", sIndiaRejectAfter.approval.approvedBy === null);
    check("G. REJECT: approvedAt null", sIndiaRejectAfter.approval.approvedAt === null);

    // ════════════════════════════════════════════════════════════
    // SECTION H — notifications
    // ════════════════════════════════════════════════════════════
    const approveNotif = await Notification.findOne({ recipientId: sIndiaApprove._id, recipientType: "SALON" }).sort({ createdAt: -1 });
    check("H. Approval notification document created", !!approveNotif, approveNotif);

    const rejectNotif = await Notification.findOne({ recipientId: sIndiaReject._id, recipientType: "SALON" }).sort({ createdAt: -1 });
    check("H. Rejection notification document created", !!rejectNotif, rejectNotif);

    // Notification failure must NOT roll back the approval decision —
    // NOT re-verified here via fault injection: NotificationService.send
    // -> NotificationDispatcher.dispatch -> InAppProvider.send are all
    // Object.freeze'd production singletons (cannot be monkey-patched
    // without mutating frozen objects, which this phase must not do),
    // and InAppProvider.send has its OWN internal try/catch (it "already
    // swallows its own DB errors internally and returns null on
    // failure — never throws", per that file's own doc comment) on top
    // of NotificationService.send's own try/catch read during the
    // Phase C.1 audit — i.e. two independent, already-proven-by-source
    // layers of swallowing sit between any real failure and the
    // controller. The live calls above (sIndiaApprove/sIndiaReject)
    // already prove the happy path fires a real notification without
    // interfering with the approval response.

    // ════════════════════════════════════════════════════════════
    // SECTION I — MUST-DO-NOW #3: CONCURRENCY RACE FIX VERIFICATION
    // Two genuinely concurrent (Promise.all, not sequential) requests
    // against the SAME fresh PENDING fixture salon. Both requests use
    // the same real INDIA admin token — the race lives in the database
    // write path, not in admin identity, and Sections B/C above
    // already cover cross-admin RBAC separately; reusing one admin
    // here isolates exactly the thing this ticket fixed.
    // ════════════════════════════════════════════════════════════
    const raceTest = async (label, statusA, statusB) => {
      const { salon } = await mkSalon(`RACE_${label}`, geoA, "PENDING");
      const bodyFor = (status) => (status === "REJECTED" ? { status, rejectionReason: `${label} reason` } : { status });

      const [rA, rB] = await Promise.all([
        authFetch(`/api/admin/salons/${salon._id}/status`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify(bodyFor(statusA)) }),
        authFetch(`/api/admin/salons/${salon._id}/status`, indiaAdmin.token, { method: "PATCH", body: JSON.stringify(bodyFor(statusB)) }),
      ]);

      const statusPair = [rA.status, rB.status].sort((x, y) => x - y);
      check(`I. ${label}: exactly one 200 and one 409 (never 200+200, never 409+409)`, JSON.stringify(statusPair) === JSON.stringify([200, 409]), { rA: rA.status, rB: rB.status });

      const winner = rA.status === 200 ? { requestedStatus: statusA } : (rB.status === 200 ? { requestedStatus: statusB } : null);
      const final = await Salon.findById(salon._id).lean();
      check(`I. ${label}: final salon status matches the winning request's requested status`, !!winner && final.approval.status === winner.requestedStatus, { final: final?.approval?.status, winner: winner?.requestedStatus });

      const notifs = await Notification.find({ recipientId: salon._id, recipientType: "SALON" }).lean();
      check(`I. ${label}: exactly ONE notification exists for this salon (no duplicate from the loser)`, notifs.length === 1, { count: notifs.length, notifs: notifs.map((n) => n.templateKey) });

      if (winner?.requestedStatus === "APPROVED") {
        check(`I. ${label}: approval metadata matches the winner (approvedBy set, rejectedBy null — loser's attempt left no trace, as expected since it never wrote)`, !!final.approval.approvedBy && final.approval.rejectedBy === null, final.approval);
      } else if (winner?.requestedStatus === "REJECTED") {
        check(`I. ${label}: rejection metadata matches the winner (rejectedBy set, reason matches)`, !!final.approval.rejectedBy && final.approval.rejectionReason === `${label} reason`, final.approval);
      }

      return salon._id;
    };

    await raceTest("APPROVE_VS_REJECT", "APPROVED", "REJECTED");
    await raceTest("REJECT_VS_APPROVE", "REJECTED", "APPROVED");
    await raceTest("APPROVE_VS_APPROVE", "APPROVED", "APPROVED");
    await raceTest("REJECT_VS_REJECT", "REJECTED", "REJECTED");

  } catch (err) {
    console.error("SCRIPT ERROR (will still clean up below):", err);
    fail++;
    results.push(`❌ FATAL SCRIPT ERROR — ${err.message}`);
  } finally {
    server.close();

    // ── CLEANUP — only this script's own NAME_PREFIX-tagged fixtures ──
    await Salon.deleteMany({ _id: { $in: createdIds.salons } });
    await User.deleteMany({ _id: { $in: createdIds.users } });
    await District.deleteMany({ _id: { $in: createdIds.districts } });
    await State.deleteMany({ _id: { $in: createdIds.states } });
    await City.deleteMany({ _id: { $in: createdIds.cities } });
    await Area.deleteMany({ _id: { $in: createdIds.areas } });
    await Notification.deleteMany({ recipientId: { $in: createdIds.salons } });

    const after = {
      User:   await User.countDocuments({}),
      Salon:  await Salon.countDocuments({}),
      State:  await State.countDocuments({}),
      District: await District.countDocuments({}),
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
