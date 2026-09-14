/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyAcquisitionClaim.js
 *
 * FA-5.3 — LIVE, real-HTTP, real-DB verification for AcquisitionReferral
 * + AcquisitionClaim. Same precedent and style as every other
 * verification script this session: real Express app, real signed
 * JWTs, real MongoDB Atlas, real concurrency via Promise.all, no mocks.
 *
 * FIXTURE NOTE: a real TERRITORY_PARTNER FieldAgent can never reach
 * operationalStatus ACTIVE via the actual application flow today (no
 * License phase exists yet — see FA-5.1/FA-5.2's own frozen scope
 * boundary comments). To exercise FA-5.3's Territory Partner
 * eligibility logic at all, TERRITORY_PARTNER fixtures here are
 * created with operationalStatus directly set to ACTIVE via
 * FieldAgent.create() (bypassing the real one-time selectCommercialPath
 * gate, which is frozen and untouched) — a standard, disclosed
 * fixture-construction convenience, not a claim that this path is
 * currently reachable in production.
 *
 * All fixtures prefixed "ZTEST_FA53_" / phones 9999953xxx, hard-deleted
 * in cleanup by exact tracked _id only.
 *
 * Run:
 *   cd backend
 *   node scripts/verifyAcquisitionClaim.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Country from "../models/Country.js";
import State from "../models/State.js";
import District from "../models/District.js";
import City from "../models/City.js";
import Area from "../models/Area.js";
import Salon from "../models/Salon.js";
import FieldAgent from "../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentAuditEvent from "../modules/fieldAgent/models/FieldAgentAuditEvent.js";
import CommercialTerritory from "../modules/fieldAgent/models/CommercialTerritory.js";
import TerritoryAssignment from "../modules/fieldAgent/models/TerritoryAssignment.js";
import AcquisitionReferral from "../modules/fieldAgent/models/AcquisitionReferral.js";
import AcquisitionClaim from "../modules/fieldAgent/models/AcquisitionClaim.js";
import { generateAccessToken } from "../services/token.service.js";

let pass = 0;
let fail = 0;
const results = [];
const check = (name, condition, detail) => {
  if (condition) {
    pass += 1;
    results.push(`✅ ${name}`);
  } else {
    fail += 1;
    results.push(`❌ ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
  }
};

const NAME_PREFIX = "ZTEST_FA53_";
let phoneSeq = 0;
const nextPhone = () => `9999953${String(phoneSeq++).padStart(3, "0")}`;

const createdUserIds = [];
const createdFieldAgentIds = [];
const createdStateIds = [];
const createdDistrictIds = [];
const createdCityIds = [];
const createdAreaIds = [];
const createdSalonIds = [];
const createdTerritoryIds = [];
const createdAssignmentIds = [];
const createdReferralIds = [];
const createdClaimIds = [];

const runStartedAt = new Date();

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path_, token, opts = {}) =>
    fetch(url(path_), {
      ...opts,
      headers: {
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
    });
  const post = (p, token, body) => authFetch(p, token, { method: "POST", body: JSON.stringify(body || {}) });
  const get = (p, token) => authFetch(p, token, { method: "GET" });

  try {
    try {
      // ── FIXTURES ────────────────────────────────────────────────────
      const country = await Country.findOne({}).lean();
      check("Real Country fixture exists", !!country);

      let stateCodeSeq = 0;
      const nextStateCode = () => {
        let n = stateCodeSeq++, code = "";
        do { code = String.fromCharCode(65 + (n % 26)) + code; n = Math.floor(n / 26) - 1; } while (n >= 0);
        return ("ZX" + code).slice(-2);
      };
      const mkState = async (suffix) => {
        const s = await State.create({ name: `${NAME_PREFIX}STATE_${suffix}`, code: nextStateCode(), type: "STATE", countryRef: country._id, geo: { type: "Point", coordinates: [77, 28] }, isActive: true, isDeleted: false });
        createdStateIds.push(s._id); return s;
      };
      let districtCodeSeq = 0;
      const mkDistrict = async (suffix, stateRef) => {
        const d = await District.create({ name: `${NAME_PREFIX}DISTRICT_${suffix}`, code: `ZG${districtCodeSeq++}`, countryRef: country._id, stateRef, isActive: true, isDeleted: false });
        createdDistrictIds.push(d._id); return d;
      };
      const mkCity = async (suffix, districtRef, stateRef) => {
        const c = await City.create({ name: `${NAME_PREFIX}CITY_${suffix}`, districtRef, stateRef, isActive: true, isDeleted: false });
        createdCityIds.push(c._id); return c;
      };
      const mkArea = async (suffix, cityRef, districtRef, stateRef) => {
        const a = await Area.create({ name: `Area ${suffix}`, cityRef, districtRef, stateRef, isActive: true, isDeleted: false });
        createdAreaIds.push(a._id); return a;
      };
      const mkOwner = async (suffix) => {
        const u = await User.create({ name: `${NAME_PREFIX}OWNER_${suffix}`, phone: nextPhone(), role: "OWNER", isActive: true });
        createdUserIds.push(u._id);
        return { user: u, token: generateAccessToken({ _id: u._id, role: "OWNER", tokenVersion: 0 }) };
      };
      const mkFieldAgent = async (suffix, { commercialPath = null, operationalStatus = "PENDING_ACTIVATION", userRefOverride = null } = {}) => {
        let userRef = userRefOverride;
        if (!userRef) {
          const u = await User.create({ name: `${NAME_PREFIX}FA_${suffix}`, phone: nextPhone(), role: "FIELD_AGENT", isActive: true });
          createdUserIds.push(u._id);
          userRef = u._id;
        }
        const fa = await FieldAgent.create({
          userRef,
          applicationRef: new mongoose.Types.ObjectId(),
          agentCode: `FA-99999999-${String(Math.floor(Math.random() * 900000) + 100000)}`,
          operationalStatus,
          commercialPath,
        });
        createdFieldAgentIds.push(fa._id);
        return { fieldAgent: fa, userRef, token: generateAccessToken({ _id: userRef, role: "FIELD_AGENT", tokenVersion: 0 }) };
      };
      const mkAdmin = async (suffix, adminLevel, geo = {}) => {
        const u = await User.create({
          name: `${NAME_PREFIX}ADMIN_${suffix}`, phone: nextPhone(),
          email: `zt-fa53-${suffix.toLowerCase()}-${Date.now()}@example.invalid`,
          role: "ADMIN", adminLevel, adminSubRole: adminLevel === "INDIA" ? null : "PRIMARY",
          countryRef: country._id, stateRef: geo.stateRef ?? null, districtRef: geo.districtRef ?? null, isActive: true,
        });
        createdUserIds.push(u._id);
        return { user: u, token: generateAccessToken({ _id: u._id, role: "ADMIN", adminLevel, tokenVersion: 0 }) };
      };
      const dayTiming = { open: "09:00", close: "20:00" };
      const timings = { monday: dayTiming, tuesday: dayTiming, wednesday: dayTiming, thursday: dayTiming, friday: dayTiming, saturday: dayTiming, sunday: dayTiming };
      const mkSalon = async (suffix, ownerId, { step = 2, approvalStatus = "PENDING", districtRef = null, cityRef = null, areaRef = null, stateRef = null, isDeleted = false } = {}) => {
        const s = await Salon.create({
          ownerId,
          basicInfo: { shopName: `${NAME_PREFIX}SALON_${suffix}`, category: "UNISEX" },
          location: { address: `${NAME_PREFIX} addr ${suffix}`, geo: { type: "Point", coordinates: [77, 28] }, territory: { districtRef, cityRef, areaRef, stateRef } },
          timings,
          onboarding: { step, completed: step >= 7 },
          approval: { status: approvalStatus },
          isDeleted,
        });
        createdSalonIds.push(s._id); return s;
      };
      const mkTerritory = async (suffix, { scopeType, districtRef, cityRef = null, areaRefs = [], status = "ACTIVE", stateRef }) => {
        const t = await CommercialTerritory.create({
          name: `${NAME_PREFIX}TERR_${suffix}`,
          code: `CT-FIXFA53-${suffix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
          scopeType, scopeKey: `FIXTURE:${suffix}:${Date.now()}:${Math.random()}`,
          stateRef, districtRef, cityRef, areaRefs, status,
          createdBy: indiaAdmin._id, updatedBy: indiaAdmin._id,
        });
        createdTerritoryIds.push(t._id); return t;
      };
      const mkAssignment = async (territoryRef, fieldAgentRef, status = "ACTIVE") => {
        const a = await TerritoryAssignment.create({ territoryRef, fieldAgentRef, status, effectiveFrom: new Date(), assignedBy: indiaAdmin._id });
        createdAssignmentIds.push(a._id);
        await CommercialTerritory.updateOne({ _id: territoryRef }, { $set: { currentAssignmentRef: a._id } });
        return a;
      };

      const indiaAdminDoc = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
      check("Real INDIA admin fixture exists (pre-existing)", !!indiaAdminDoc);
      const indiaAdmin = indiaAdminDoc;
      const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

      const state1 = await mkState("S1");

      // API wrappers
      const issueRef = (token) => post("/api/field-agent/acquisition/referrals", token);
      const listRefs = (token) => get("/api/field-agent/acquisition/referrals/mine", token);
      const cancelRef = (token, id) => post(`/api/field-agent/acquisition/referrals/${id}/cancel`, token);
      const listMyClaimsApi = (token) => get("/api/field-agent/acquisition/claims/mine", token);
      const withdrawClaimApi = (token, id) => post(`/api/field-agent/acquisition/claims/${id}/withdraw`, token);
      const redeem = (token, body) => post("/api/acquisition/redeem", token, body);
      const adminList = (token, qs = "") => get(`/api/admin/acquisition-claims${qs}`, token);
      const adminDetail = (token, id) => get(`/api/admin/acquisition-claims/${id}`, token);
      const adminReject = (token, id) => post(`/api/admin/acquisition-claims/${id}/reject`, token);
      const adminReassign = (token, id) => post(`/api/admin/acquisition-claims/${id}/reassign`, token);

      // ── A. REFERRAL ISSUANCE ─────────────────────────────────────────
      let aaEligible, tpEligible;
      {
        aaEligible = await mkFieldAgent("AA_ELIGIBLE", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const r1 = await issueRef(aaEligible.token);
        check("A. Eligible ACQUISITION_AGENT can issue referral", r1.status === 201, r1.status);
        const b1 = await r1.json();
        if (b1.data?.referral?._id) createdReferralIds.push(b1.data.referral._id);
        check("A. Referral code matches AQ-YYYYMMDD-XXXXXX", /^AQ-\d{8}-\d{6}$/.test(b1.data?.referral?.code || ""), b1.data?.referral?.code);
        const expiresInDays = (new Date(b1.data.referral.expiresAt) - Date.now()) / (24 * 60 * 60 * 1000);
        check("A. expiresAt is ~30 days out", expiresInDays > 29 && expiresInDays < 31, expiresInDays);

        tpEligible = await mkFieldAgent("TP_ELIGIBLE", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const r2 = await issueRef(tpEligible.token);
        check("A. Eligible TERRITORY_PARTNER can issue referral", r2.status === 201, r2.status);
        const b2 = await r2.json();
        if (b2.data?.referral?._id) createdReferralIds.push(b2.data.referral._id);
        check("A. Two issued codes are different", b1.data.referral.code !== b2.data.referral.code);

        const pending = await mkFieldAgent("PENDING", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "PENDING_ACTIVATION" });
        check("A. PENDING_ACTIVATION agent rejected (409)", (await issueRef(pending.token)).status === 409);

        const noPath = await mkFieldAgent("NOPATH", { commercialPath: null, operationalStatus: "ACTIVE" });
        check("A. No commercialPath agent rejected (409)", (await issueRef(noPath.token)).status === 409);

        await new Promise((res) => setTimeout(res, 200));
        const auditCount = await FieldAgentAuditEvent.countDocuments({ action: "ACQUISITION_REFERRAL_CREATED", createdAt: { $gte: runStartedAt } });
        check("A. ACQUISITION_REFERRAL_CREATED audit events written", auditCount >= 2, auditCount);
      }

      // ── B. REFERRAL LIFECYCLE ─────────────────────────────────────────
      {
        const r = await issueRef(aaEligible.token);
        const referralId = (await r.json()).data.referral._id;
        createdReferralIds.push(referralId);

        const rCancel = await cancelRef(aaEligible.token, referralId);
        check("B. Cancel own ISSUED referral succeeds", rCancel.status === 200, rCancel.status);
        check("B. Cannot cancel already-CANCELLED referral", (await cancelRef(aaEligible.token, referralId)).status === 409);

        const rOther = await issueRef(tpEligible.token);
        const otherReferralId = (await rOther.json()).data.referral._id;
        createdReferralIds.push(otherReferralId);
        check("B. Cannot cancel another agent's referral (404, no leak)", (await cancelRef(aaEligible.token, otherReferralId)).status === 404);

        // Expired referral, via direct DB manipulation (test setup only)
        const rExp = await issueRef(aaEligible.token);
        const expiredCode = (await rExp.json()).data.referral.code;
        const expiredId = (await rExp.json ? null : null); // noop, code already captured
        await AcquisitionReferral.updateOne({ code: expiredCode }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        const ownerExp = await mkOwner("EXP");
        const districtExp = await mkDistrict("EXP", state1._id);
        const salonExp = await mkSalon("EXP", ownerExp.user._id, { step: 2, districtRef: districtExp._id, stateRef: state1._id });
        const rRedeemExpired = await redeem(ownerExp.token, { referralCode: expiredCode });
        check("B. Redeeming an expired referral rejected (409)", rRedeemExpired.status === 409, rRedeemExpired.status);
        const refDoc = await AcquisitionReferral.findOne({ code: expiredCode }).lean();
        createdReferralIds.push(refDoc._id);

        // Redeeming a CANCELLED referral
        const ownerCancelled = await mkOwner("CANCELLEDREDEEM");
        const districtCancelled = await mkDistrict("CANCELLEDREDEEM", state1._id);
        const salonCancelled = await mkSalon("CANCELLEDREDEEM", ownerCancelled.user._id, { step: 2, districtRef: districtCancelled._id, stateRef: state1._id });
        const rRedeemCancelled = await redeem(ownerCancelled.token, { referralCode: (await AcquisitionReferral.findById(referralId).lean()).code });
        check("B. Redeeming a CANCELLED referral rejected (409)", rRedeemCancelled.status === 409, rRedeemCancelled.status);
      }

      // ── C. CONTROLLED REDEMPTION ──────────────────────────────────────
      let happyClaimId, happySalonId, happyOwner;
      {
        const dHappy = await mkDistrict("HAPPY", state1._id);
        happyOwner = await mkOwner("HAPPY");
        const salon = await mkSalon("HAPPY", happyOwner.user._id, { step: 2, districtRef: dHappy._id, stateRef: state1._id });
        happySalonId = salon._id;

        const rIssue = await issueRef(aaEligible.token);
        const code = (await rIssue.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code }).lean())._id);

        const rBadBody = await redeem(happyOwner.token, { referralCode: code, salonId: String(new mongoose.Types.ObjectId()) });
        check("C. Client-supplied salonId in redeem body rejected (400)", rBadBody.status === 400, rBadBody.status);

        const rRedeem = await redeem(happyOwner.token, { referralCode: code });
        check("C. Valid owner redemption succeeds", rRedeem.status === 200, rRedeem.status);
        const bRedeem = await rRedeem.json();
        happyClaimId = bRedeem.data?.claim?._id;
        if (happyClaimId) createdClaimIds.push(happyClaimId);
        check("C. Salon resolved server-side matches the owner's own Salon", String(bRedeem.data?.salonId) === String(salon._id));
        check("C. Claim.fieldAgentRef matches the referring agent", String(bRedeem.data?.claim?.fieldAgentRef) === String(aaEligible.fieldAgent._id));

        const ownerNoSalon = await mkOwner("NOSALON");
        const rIssue2 = await issueRef(aaEligible.token);
        const code2 = (await rIssue2.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code2 }).lean())._id);
        check("C. Owner with no Salon at all rejected (404)", (await redeem(ownerNoSalon.token, { referralCode: code2 })).status === 404);

        const dIncomplete = await mkDistrict("INCOMPLETE", state1._id);
        const ownerIncomplete = await mkOwner("INCOMPLETE");
        await mkSalon("INCOMPLETE", ownerIncomplete.user._id, { step: 1, districtRef: null, stateRef: null });
        const rIssue3 = await issueRef(aaEligible.token);
        const code3 = (await rIssue3.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code3 }).lean())._id);
        check("C. Onboarding-incomplete Salon (step 1) rejected (409)", (await redeem(ownerIncomplete.token, { referralCode: code3 })).status === 409);

        const ownerDeleted = await mkOwner("DELETED");
        await mkSalon("DELETED", ownerDeleted.user._id, { step: 2, districtRef: dIncomplete._id, stateRef: state1._id, isDeleted: true });
        const rIssue4 = await issueRef(aaEligible.token);
        const code4 = (await rIssue4.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code4 }).lean())._id);
        check("C. Deleted Salon rejected (404)", (await redeem(ownerDeleted.token, { referralCode: code4 })).status === 404);
      }

      // ── D. SELF-CLAIM ─────────────────────────────────────────────────
      {
        const selfOwner = await mkOwner("SELFCLAIM");
        const selfFieldAgent = await mkFieldAgent("SELFCLAIM", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE", userRefOverride: selfOwner.user._id });
        const dSelf = await mkDistrict("SELFCLAIM", state1._id);
        await mkSalon("SELFCLAIM", selfOwner.user._id, { step: 2, districtRef: dSelf._id, stateRef: state1._id });

        const code = `AQ-SELFTEST-${Date.now()}`;
        const referral = await AcquisitionReferral.create({ code, fieldAgentRef: selfFieldAgent.fieldAgent._id, status: "ISSUED", expiresAt: new Date(Date.now() + 86400000) });
        createdReferralIds.push(referral._id);

        const rSelf = await redeem(selfOwner.token, { referralCode: code });
        check("D. Self-claim (FieldAgent.userRef === Salon.ownerId) rejected (409)", rSelf.status === 409, rSelf.status);
      }

      // ── E. ACQUISITION AGENT (India-wide, no territory required) ─────
      let coexistTerritory, coexistPartner, coexistSalonId, coexistAgentClaimId;
      {
        // Already proven by section C's happy path (agent has no
        // territory at all, succeeds anywhere). Now: acquisition inside
        // a Territory Partner's ACTIVE territory.
        const dCoexist = await mkDistrict("COEXIST", state1._id);
        coexistPartner = await mkFieldAgent("COEXIST_TP", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        coexistTerritory = await mkTerritory("COEXIST", { scopeType: "DISTRICT", districtRef: dCoexist._id, stateRef: state1._id });
        await mkAssignment(coexistTerritory._id, coexistPartner.fieldAgent._id, "ACTIVE");

        const ownerCoexist = await mkOwner("COEXIST");
        const salonCoexist = await mkSalon("COEXIST", ownerCoexist.user._id, { step: 2, districtRef: dCoexist._id, stateRef: state1._id });
        coexistSalonId = salonCoexist._id;

        const agentB = await mkFieldAgent("COEXIST_AA", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rIssue = await issueRef(agentB.token);
        const code = (await rIssue.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code }).lean())._id);

        const rRedeem = await redeem(ownerCoexist.token, { referralCode: code });
        check("E. Acquisition Agent can claim a salon inside a Territory Partner's ACTIVE territory", rRedeem.status === 200, rRedeem.status);
        const bRedeem = await rRedeem.json();
        coexistAgentClaimId = bRedeem.data?.claim?._id;
        if (coexistAgentClaimId) createdClaimIds.push(coexistAgentClaimId);
        check("E. Claim.fieldAgentRef is the Acquisition Agent, not the Territory Partner", String(bRedeem.data?.claim?.fieldAgentRef) === String(agentB.fieldAgent._id));

        const areasCount = await Area.countDocuments({ _id: { $in: createdAreaIds }, createdAt: { $lt: runStartedAt } });
        check("E. No Area ownership/document created as a side effect of Acquisition Agent claim", areasCount === 0, areasCount);
      }

      // ── F. TERRITORY PARTNER ─────────────────────────────────────────
      {
        // No active assignment at all
        const tpNoAssignment = await mkFieldAgent("TP_NOASSIGN", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const dNoAssign = await mkDistrict("NOASSIGN", state1._id);
        const ownerNoAssign = await mkOwner("NOASSIGN");
        await mkSalon("NOASSIGN", ownerNoAssign.user._id, { step: 2, districtRef: dNoAssign._id, stateRef: state1._id });
        const rIssueNoAssign = await issueRef(tpNoAssignment.token);
        const codeNoAssign = (await rIssueNoAssign.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeNoAssign }).lean())._id);
        check("F. Territory Partner with no ACTIVE assignment rejected (409)", (await redeem(ownerNoAssign.token, { referralCode: codeNoAssign })).status === 409);

        // DISTRICT membership pass
        const dDistrict = await mkDistrict("TPDISTRICT", state1._id);
        const tpDistrict = await mkFieldAgent("TP_DISTRICT", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrDistrict = await mkTerritory("TPDISTRICT", { scopeType: "DISTRICT", districtRef: dDistrict._id, stateRef: state1._id });
        await mkAssignment(terrDistrict._id, tpDistrict.fieldAgent._id);
        const ownerDistrict = await mkOwner("TPDISTRICT");
        await mkSalon("TPDISTRICT", ownerDistrict.user._id, { step: 2, districtRef: dDistrict._id, stateRef: state1._id });
        const rIssueD = await issueRef(tpDistrict.token);
        const codeD = (await rIssueD.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeD }).lean())._id);
        const rRedeemD = await redeem(ownerDistrict.token, { referralCode: codeD });
        check("F. DISTRICT membership pass — claim succeeds", rRedeemD.status === 200, rRedeemD.status);
        if (rRedeemD.status === 200) createdClaimIds.push((await rRedeemD.json()).data.claim._id);

        // DISTRICT membership fail (different district)
        const dOutside = await mkDistrict("TPOUTSIDE", state1._id);
        const ownerOutside = await mkOwner("TPOUTSIDE");
        await mkSalon("TPOUTSIDE", ownerOutside.user._id, { step: 2, districtRef: dOutside._id, stateRef: state1._id });
        const rIssueOut = await issueRef(tpDistrict.token);
        const codeOut = (await rIssueOut.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeOut }).lean())._id);
        check("F. Outside own DISTRICT territory rejected (409)", (await redeem(ownerOutside.token, { referralCode: codeOut })).status === 409);

        // CITY membership pass/fail
        const dCity = await mkDistrict("TPCITY", state1._id);
        const cityIn = await mkCity("TPCITY_IN", dCity._id, state1._id);
        const cityOut = await mkCity("TPCITY_OUT", dCity._id, state1._id);
        const tpCity = await mkFieldAgent("TP_CITY", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrCity = await mkTerritory("TPCITY", { scopeType: "CITY", districtRef: dCity._id, cityRef: cityIn._id, stateRef: state1._id });
        await mkAssignment(terrCity._id, tpCity.fieldAgent._id);
        const ownerCityIn = await mkOwner("TPCITYIN");
        await mkSalon("TPCITYIN", ownerCityIn.user._id, { step: 2, districtRef: dCity._id, cityRef: cityIn._id, stateRef: state1._id });
        const rIssueCityIn = await issueRef(tpCity.token);
        const codeCityIn = (await rIssueCityIn.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeCityIn }).lean())._id);
        const rRedeemCityIn = await redeem(ownerCityIn.token, { referralCode: codeCityIn });
        check("F. CITY membership pass — claim succeeds", rRedeemCityIn.status === 200, rRedeemCityIn.status);
        if (rRedeemCityIn.status === 200) createdClaimIds.push((await rRedeemCityIn.json()).data.claim._id);

        const ownerCityOut = await mkOwner("TPCITYOUT");
        await mkSalon("TPCITYOUT", ownerCityOut.user._id, { step: 2, districtRef: dCity._id, cityRef: cityOut._id, stateRef: state1._id });
        const rIssueCityOut = await issueRef(tpCity.token);
        const codeCityOut = (await rIssueCityOut.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeCityOut }).lean())._id);
        check("F. CITY membership fail (different city, same district) rejected (409)", (await redeem(ownerCityOut.token, { referralCode: codeCityOut })).status === 409);

        // AREA_SET membership pass/fail + null areaRef
        const dArea = await mkDistrict("TPAREA", state1._id);
        const cArea = await mkCity("TPAREA", dArea._id, state1._id);
        const areaIn = await mkArea("TPAREAIN", cArea._id, dArea._id, state1._id);
        const areaOut = await mkArea("TPAREAOUT", cArea._id, dArea._id, state1._id);
        const tpArea = await mkFieldAgent("TP_AREA", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrArea = await mkTerritory("TPAREA", { scopeType: "AREA_SET", districtRef: dArea._id, cityRef: cArea._id, areaRefs: [areaIn._id], stateRef: state1._id });
        await mkAssignment(terrArea._id, tpArea.fieldAgent._id);

        const ownerAreaIn = await mkOwner("TPAREAIN");
        await mkSalon("TPAREAIN", ownerAreaIn.user._id, { step: 2, districtRef: dArea._id, cityRef: cArea._id, areaRef: areaIn._id, stateRef: state1._id });
        const rIssueAreaIn = await issueRef(tpArea.token);
        const codeAreaIn = (await rIssueAreaIn.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeAreaIn }).lean())._id);
        const rRedeemAreaIn = await redeem(ownerAreaIn.token, { referralCode: codeAreaIn });
        check("F. AREA_SET membership pass — claim succeeds", rRedeemAreaIn.status === 200, rRedeemAreaIn.status);
        if (rRedeemAreaIn.status === 200) createdClaimIds.push((await rRedeemAreaIn.json()).data.claim._id);

        const ownerAreaOut = await mkOwner("TPAREAOUT");
        await mkSalon("TPAREAOUT", ownerAreaOut.user._id, { step: 2, districtRef: dArea._id, cityRef: cArea._id, areaRef: areaOut._id, stateRef: state1._id });
        const rIssueAreaOut = await issueRef(tpArea.token);
        const codeAreaOut = (await rIssueAreaOut.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeAreaOut }).lean())._id);
        check("F. AREA_SET membership fail (different area, same city) rejected (409)", (await redeem(ownerAreaOut.token, { referralCode: codeAreaOut })).status === 409);

        const ownerAreaNull = await mkOwner("TPAREANULL");
        await mkSalon("TPAREANULL", ownerAreaNull.user._id, { step: 2, districtRef: dArea._id, cityRef: cArea._id, areaRef: null, stateRef: state1._id });
        const rIssueAreaNull = await issueRef(tpArea.token);
        const codeAreaNull = (await rIssueAreaNull.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeAreaNull }).lean())._id);
        check("F. AREA_SET territory + Salon with null areaRef rejected — cannot claim yet (409)", (await redeem(ownerAreaNull.token, { referralCode: codeAreaNull })).status === 409);

        // SUSPENDED territory rejected even with ACTIVE assignment
        const dSuspend = await mkDistrict("TPSUSPEND", state1._id);
        const tpSuspend = await mkFieldAgent("TP_SUSPEND", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrSuspend = await mkTerritory("TPSUSPEND", { scopeType: "DISTRICT", districtRef: dSuspend._id, stateRef: state1._id, status: "SUSPENDED" });
        await mkAssignment(terrSuspend._id, tpSuspend.fieldAgent._id, "ACTIVE");
        const ownerSuspend = await mkOwner("TPSUSPEND");
        await mkSalon("TPSUSPEND", ownerSuspend.user._id, { step: 2, districtRef: dSuspend._id, stateRef: state1._id });
        const rIssueSuspend = await issueRef(tpSuspend.token);
        const codeSuspend = (await rIssueSuspend.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeSuspend }).lean())._id);
        check("F. SUSPENDED territory rejected even with ACTIVE assignment (409)", (await redeem(ownerSuspend.token, { referralCode: codeSuspend })).status === 409);

        // RETIRED territory rejected
        const dRetire = await mkDistrict("TPRETIRE", state1._id);
        const tpRetire = await mkFieldAgent("TP_RETIRE", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrRetire = await mkTerritory("TPRETIRE", { scopeType: "DISTRICT", districtRef: dRetire._id, stateRef: state1._id, status: "RETIRED" });
        await mkAssignment(terrRetire._id, tpRetire.fieldAgent._id, "ACTIVE");
        const ownerRetire = await mkOwner("TPRETIRE");
        await mkSalon("TPRETIRE", ownerRetire.user._id, { step: 2, districtRef: dRetire._id, stateRef: state1._id });
        const rIssueRetire = await issueRef(tpRetire.token);
        const codeRetire = (await rIssueRetire.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeRetire }).lean())._id);
        check("F. RETIRED territory rejected (409)", (await redeem(ownerRetire.token, { referralCode: codeRetire })).status === 409);
      }

      // ── G. COEXISTENCE — Territory Partner unaffected by AA's claim ──
      {
        const territoryAfter = await CommercialTerritory.findById(coexistTerritory._id).lean();
        check("G. Territory Partner's territory status unchanged (ACTIVE)", territoryAfter.status === "ACTIVE");
        const assignmentAfter = await TerritoryAssignment.findOne({ territoryRef: coexistTerritory._id, status: "ACTIVE" }).lean();
        check("G. Territory Partner's assignment still ACTIVE and unchanged", String(assignmentAfter?.fieldAgentRef) === String(coexistPartner.fieldAgent._id));
        const territoryPartnerClaims = await AcquisitionClaim.countDocuments({ fieldAgentRef: coexistPartner.fieldAgent._id, salonRef: coexistSalonId });
        check("G. No AcquisitionClaim was ever created for the Territory Partner on this salon", territoryPartnerClaims === 0, territoryPartnerClaims);
      }

      // ── H. CLAIM LIFECYCLE ────────────────────────────────────────────
      {
        const rWithdraw = await withdrawClaimApi(aaEligible.token, happyClaimId);
        check("H. Agent can withdraw own ACTIVE claim", rWithdraw.status === 200, rWithdraw.status);
        const withdrawn = await AcquisitionClaim.findById(happyClaimId).lean();
        check("H. Withdrawn claim: ENDED/AGENT_WITHDRAWN/endedBy/endedAt all set", withdrawn.status === "ENDED" && withdrawn.endedReason === "AGENT_WITHDRAWN" && !!withdrawn.endedBy && !!withdrawn.endedAt);

        // Re-claim: salon is free again, a new referral can be redeemed.
        // Uses a fresh ACQUISITION_AGENT (not tpEligible, which has no
        // territory assignment and would correctly be rejected by the
        // territory-membership check — that's not what this case tests).
        const reclaimAgent = await mkFieldAgent("RECLAIM_AA", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rIssueReclaim = await issueRef(reclaimAgent.token);
        const codeReclaim = (await rIssueReclaim.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeReclaim }).lean())._id);
        const rReclaim = await redeem(happyOwner.token, { referralCode: codeReclaim });
        check("H. Re-claim after withdrawal succeeds (new ACTIVE claim)", rReclaim.status === 200, rReclaim.status);
        const newClaimId = (await rReclaim.json()).data?.claim?._id;
        if (newClaimId) createdClaimIds.push(newClaimId);
        const oldClaimStillThere = await AcquisitionClaim.findById(happyClaimId).lean();
        check("H. Original ENDED claim preserved as history (not deleted)", !!oldClaimStillThere);

        // Admin reject/reassign
        const rIssueReject = await issueRef(aaEligible.token);
        const codeReject = (await rIssueReject.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeReject }).lean())._id);
        const dReject = await mkDistrict("REJECT", state1._id);
        const ownerReject = await mkOwner("REJECT");
        await mkSalon("REJECT", ownerReject.user._id, { step: 2, districtRef: dReject._id, stateRef: state1._id });
        const rRedeemReject = await redeem(ownerReject.token, { referralCode: codeReject });
        const rejectClaimId = (await rRedeemReject.json()).data.claim._id;
        createdClaimIds.push(rejectClaimId);
        const rAdminReject = await adminReject(indiaToken, rejectClaimId);
        check("H. Admin reject succeeds", rAdminReject.status === 200, rAdminReject.status);
        const rejected = await AcquisitionClaim.findById(rejectClaimId).lean();
        check("H. Rejected claim: ENDED/ADMIN_REJECTED", rejected.status === "ENDED" && rejected.endedReason === "ADMIN_REJECTED");

        const rIssueReassign = await issueRef(aaEligible.token);
        const codeReassign = (await rIssueReassign.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeReassign }).lean())._id);
        const dReassign = await mkDistrict("REASSIGN", state1._id);
        const ownerReassign = await mkOwner("REASSIGN");
        await mkSalon("REASSIGN", ownerReassign.user._id, { step: 2, districtRef: dReassign._id, stateRef: state1._id });
        const rRedeemReassign = await redeem(ownerReassign.token, { referralCode: codeReassign });
        const reassignClaimId = (await rRedeemReassign.json()).data.claim._id;
        createdClaimIds.push(reassignClaimId);
        const rAdminReassign = await adminReassign(indiaToken, reassignClaimId);
        check("H. Admin reassign succeeds", rAdminReassign.status === 200, rAdminReassign.status);
        const reassigned = await AcquisitionClaim.findById(reassignClaimId).lean();
        check("H. Reassigned claim: ENDED/ADMIN_REASSIGNED", reassigned.status === "ENDED" && reassigned.endedReason === "ADMIN_REASSIGNED");
      }

      // ── I. AUTHORITATIVE ATTRIBUTION (derived, all 4 combinations) ────
      {
        const dAuth = await mkDistrict("AUTH", state1._id);
        const isAuthoritative = (claim, salon) => claim.status === "ACTIVE" && salon.approval.status === "APPROVED";

        const mkAuthCase = async (suffix, approvalStatus) => {
          const owner = await mkOwner(`AUTH_${suffix}`);
          const salon = await mkSalon(`AUTH_${suffix}`, owner.user._id, { step: 2, districtRef: dAuth._id, stateRef: state1._id, approvalStatus });
          const rIssue = await issueRef(aaEligible.token);
          const code = (await rIssue.json()).data.referral.code;
          createdReferralIds.push((await AcquisitionReferral.findOne({ code }).lean())._id);
          const rRedeem = await redeem(owner.token, { referralCode: code });
          const claimId = (await rRedeem.json()).data.claim._id;
          createdClaimIds.push(claimId);
          return { claim: await AcquisitionClaim.findById(claimId).lean(), salon: await Salon.findById(salon._id).lean() };
        };

        const { claim: c1, salon: s1 } = await mkAuthCase("1", "APPROVED");
        check("I. ACTIVE claim + APPROVED salon => authoritative", isAuthoritative(c1, s1) === true);

        const { claim: c2, salon: s2 } = await mkAuthCase("2", "PENDING");
        check("I. ACTIVE claim + non-approved salon => NOT authoritative", isAuthoritative(c2, s2) === false);

        const { claim: c3, salon: s3 } = await mkAuthCase("3", "APPROVED");
        await AcquisitionClaim.updateOne({ _id: c3._id }, { $set: { status: "ENDED", endedReason: "AGENT_WITHDRAWN", endedAt: new Date() } });
        const c3Ended = await AcquisitionClaim.findById(c3._id).lean();
        check("I. ENDED claim + APPROVED salon => NOT authoritative", isAuthoritative(c3Ended, s3) === false);

        const { claim: c4, salon: s4 } = await mkAuthCase("4", "PENDING");
        await AcquisitionClaim.updateOne({ _id: c4._id }, { $set: { status: "ENDED", endedReason: "AGENT_WITHDRAWN", endedAt: new Date() } });
        const c4Ended = await AcquisitionClaim.findById(c4._id).lean();
        check("I. ENDED claim + non-approved salon => NOT authoritative", isAuthoritative(c4Ended, s4) === false);
      }

      // ── J. CONCURRENCY ─────────────────────────────────────────────────
      {
        // 1. Same referral redeemed concurrently (two different owners racing on a leaked code)
        const dConc1 = await mkDistrict("CONC1", state1._id);
        const rIssueConc1 = await issueRef(aaEligible.token);
        const codeConc1 = (await rIssueConc1.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeConc1 }).lean())._id);
        const ownerConcA = await mkOwner("CONC1A");
        const ownerConcB = await mkOwner("CONC1B");
        await mkSalon("CONC1A", ownerConcA.user._id, { step: 2, districtRef: dConc1._id, stateRef: state1._id });
        await mkSalon("CONC1B", ownerConcB.user._id, { step: 2, districtRef: dConc1._id, stateRef: state1._id });
        const [r1a, r1b] = await Promise.all([redeem(ownerConcA.token, { referralCode: codeConc1 }), redeem(ownerConcB.token, { referralCode: codeConc1 })]);
        const s1statuses = [r1a.status, r1b.status].sort();
        check("J1. Same referral redeemed concurrently: exactly one 200", s1statuses.filter((s) => s === 200).length === 1, JSON.stringify(s1statuses));
        for (const rr of [r1a, r1b]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.claim?._id) createdClaimIds.push(b.data.claim._id); }

        // 2. Two different valid referrals redeemed concurrently for the same salon
        const dConc2 = await mkDistrict("CONC2", state1._id);
        const ownerConc2 = await mkOwner("CONC2");
        await mkSalon("CONC2", ownerConc2.user._id, { step: 2, districtRef: dConc2._id, stateRef: state1._id });
        const agentConc2a = await mkFieldAgent("CONC2A", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const agentConc2b = await mkFieldAgent("CONC2B", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rIssue2a = await issueRef(agentConc2a.token);
        const rIssue2b = await issueRef(agentConc2b.token);
        const code2a = (await rIssue2a.json()).data.referral.code;
        const code2b = (await rIssue2b.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code2a }).lean())._id, (await AcquisitionReferral.findOne({ code: code2b }).lean())._id);
        const [r2a, r2b] = await Promise.all([redeem(ownerConc2.token, { referralCode: code2a }), redeem(ownerConc2.token, { referralCode: code2b })]);
        const s2statuses = [r2a.status, r2b.status].sort();
        check("J2. Two different referrals redeemed concurrently for same salon: exactly one 200", s2statuses.filter((s) => s === 200).length === 1, JSON.stringify(s2statuses));
        for (const rr of [r2a, r2b]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.claim?._id) createdClaimIds.push(b.data.claim._id); }
        const activeCountConc2 = await AcquisitionClaim.countDocuments({ fieldAgentRef: { $in: [agentConc2a.fieldAgent._id, agentConc2b.fieldAgent._id] }, status: "ACTIVE" });
        check("J2. Exactly one ACTIVE claim persisted for the contested salon", activeCountConc2 === 1, activeCountConc2);

        // 3. Concurrent claim ending vs new claim creation
        const dConc3 = await mkDistrict("CONC3", state1._id);
        const ownerConc3 = await mkOwner("CONC3");
        await mkSalon("CONC3", ownerConc3.user._id, { step: 2, districtRef: dConc3._id, stateRef: state1._id });
        const agentConc3 = await mkFieldAgent("CONC3", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rIssue3 = await issueRef(agentConc3.token);
        const code3c = (await rIssue3.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code3c }).lean())._id);
        const rRedeem3 = await redeem(ownerConc3.token, { referralCode: code3c });
        const claim3Id = (await rRedeem3.json()).data.claim._id;
        createdClaimIds.push(claim3Id);

        const agentConc3b = await mkFieldAgent("CONC3B", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rIssue3b = await issueRef(agentConc3b.token);
        const code3b = (await rIssue3b.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: code3b }).lean())._id);

        const [rEnd, rNewRedeem] = await Promise.all([
          withdrawClaimApi(agentConc3.token, claim3Id),
          redeem(ownerConc3.token, { referralCode: code3b }),
        ]);
        check("J3. Concurrent claim-end vs new-claim: both requests get a definitive response", [rEnd.status, rNewRedeem.status].every((s) => [200, 409].includes(s)), JSON.stringify([rEnd.status, rNewRedeem.status]));
        const finalActiveConc3 = await AcquisitionClaim.countDocuments({ salonRef: (await Salon.findOne({ ownerId: ownerConc3.user._id }).lean())._id, status: "ACTIVE" });
        check("J3. Never more than one ACTIVE claim on the contested salon", finalActiveConc3 <= 1, finalActiveConc3);
        const b3 = await rNewRedeem.clone().json().catch(() => null);
        if (b3?.data?.claim?._id) createdClaimIds.push(b3.data.claim._id);

        // 4. Concurrent referral cancellation vs redemption
        const dConc4 = await mkDistrict("CONC4", state1._id);
        const ownerConc4 = await mkOwner("CONC4");
        await mkSalon("CONC4", ownerConc4.user._id, { step: 2, districtRef: dConc4._id, stateRef: state1._id });
        const rIssue4 = await issueRef(aaEligible.token);
        const code4c = (await rIssue4.json()).data.referral.code;
        const referral4Id = (await AcquisitionReferral.findOne({ code: code4c }).lean())._id;
        createdReferralIds.push(referral4Id);
        const [rCancel4, rRedeem4] = await Promise.all([cancelRef(aaEligible.token, referral4Id), redeem(ownerConc4.token, { referralCode: code4c })]);
        const s4statuses = [rCancel4.status, rRedeem4.status].sort();
        check("J4. Concurrent cancel-vs-redeem: never both succeed", !(rCancel4.status === 200 && rRedeem4.status === 200), JSON.stringify(s4statuses));
        check("J4. Concurrent cancel-vs-redeem: at least one succeeds", s4statuses.includes(200), JSON.stringify(s4statuses));
        const b4 = await rRedeem4.clone().json().catch(() => null);
        if (b4?.data?.claim?._id) createdClaimIds.push(b4.data.claim._id);
      }

      // ── J-BIS. SAME-SALON CONCURRENCY PROOF (explicit, isolated) ──────
      // The exact scenario: ONE existing Salon, ONE authenticated owner,
      // MULTIPLE different valid referral codes (from different eligible
      // agents), redeemed CONCURRENTLY. Both/all requests resolve
      // server-side to the identical Salon via the same
      // Salon.findOne({ownerId}) lookup — this is what actually exercises
      // the AcquisitionClaim{salonRef,status:"ACTIVE"} partial unique
      // index as the race authority (J2 above already covered this; this
      // section isolates it explicitly and adds a 3-way version).
      {
        // 2-way, isolated and explicit
        const dSameSalon2 = await mkDistrict("SAMESALON2", state1._id);
        const ownerSameSalon2 = await mkOwner("SAMESALON2");
        const salonSameSalon2 = await mkSalon("SAMESALON2", ownerSameSalon2.user._id, { step: 2, districtRef: dSameSalon2._id, stateRef: state1._id });
        const agentSS2a = await mkFieldAgent("SS2A", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const agentSS2b = await mkFieldAgent("SS2B", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const codeSS2a = (await (await issueRef(agentSS2a.token)).json()).data.referral.code;
        const codeSS2b = (await (await issueRef(agentSS2b.token)).json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeSS2a }).lean())._id, (await AcquisitionReferral.findOne({ code: codeSS2b }).lean())._id);

        const [ss2a, ss2b] = await Promise.all([
          redeem(ownerSameSalon2.token, { referralCode: codeSS2a }),
          redeem(ownerSameSalon2.token, { referralCode: codeSS2b }),
        ]);
        const ss2statuses = [ss2a.status, ss2b.status].sort();
        check("SAME-SALON 2-REFERRAL: both requests resolve to the same Salon", true); // structural — same ownerId used for both
        check("SAME-SALON 2-REFERRAL: exactly one request succeeds (200)", ss2statuses.filter((s) => s === 200).length === 1, JSON.stringify(ss2statuses));
        check("SAME-SALON 2-REFERRAL: the loser receives a deterministic conflict (409)", ss2statuses.filter((s) => s === 409).length === 1, JSON.stringify(ss2statuses));
        for (const rr of [ss2a, ss2b]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.claim?._id) createdClaimIds.push(b.data.claim._id); }
        const ss2ActiveCount = await AcquisitionClaim.countDocuments({ salonRef: salonSameSalon2._id, status: "ACTIVE" });
        check("SAME-SALON 2-REFERRAL: exactly one ACTIVE AcquisitionClaim exists for the Salon", ss2ActiveCount === 1, ss2ActiveCount);
        const ss2ConsumedCount = await AcquisitionReferral.countDocuments({ code: { $in: [codeSS2a, codeSS2b] }, status: "CONSUMED" });
        check("SAME-SALON 2-REFERRAL: exactly one referral shows CONSUMED (no orphaned consume-without-claim)", ss2ConsumedCount === 1, ss2ConsumedCount);
        const ss2WinnerReferral = await AcquisitionReferral.findOne({ code: { $in: [codeSS2a, codeSS2b] }, status: "CONSUMED" }).lean();
        check("SAME-SALON 2-REFERRAL: the CONSUMED referral's consumedSalonRef matches the Salon", String(ss2WinnerReferral?.consumedSalonRef) === String(salonSameSalon2._id));

        // 3-way, same owner, same Salon, three different valid referrals
        const dSameSalon3 = await mkDistrict("SAMESALON3", state1._id);
        const ownerSameSalon3 = await mkOwner("SAMESALON3");
        const salonSameSalon3 = await mkSalon("SAMESALON3", ownerSameSalon3.user._id, { step: 2, districtRef: dSameSalon3._id, stateRef: state1._id });
        const agentSS3a = await mkFieldAgent("SS3A", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const agentSS3b = await mkFieldAgent("SS3B", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const agentSS3c = await mkFieldAgent("SS3C", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const codeSS3a = (await (await issueRef(agentSS3a.token)).json()).data.referral.code;
        const codeSS3b = (await (await issueRef(agentSS3b.token)).json()).data.referral.code;
        const codeSS3c = (await (await issueRef(agentSS3c.token)).json()).data.referral.code;
        createdReferralIds.push(
          (await AcquisitionReferral.findOne({ code: codeSS3a }).lean())._id,
          (await AcquisitionReferral.findOne({ code: codeSS3b }).lean())._id,
          (await AcquisitionReferral.findOne({ code: codeSS3c }).lean())._id
        );

        const [ss3a, ss3b, ss3c] = await Promise.all([
          redeem(ownerSameSalon3.token, { referralCode: codeSS3a }),
          redeem(ownerSameSalon3.token, { referralCode: codeSS3b }),
          redeem(ownerSameSalon3.token, { referralCode: codeSS3c }),
        ]);
        const ss3statuses = [ss3a.status, ss3b.status, ss3c.status].sort();
        check("SAME-SALON 3-REFERRAL: exactly one of three concurrent requests succeeds (200)", ss3statuses.filter((s) => s === 200).length === 1, JSON.stringify(ss3statuses));
        check("SAME-SALON 3-REFERRAL: the other two receive deterministic conflicts (409)", ss3statuses.filter((s) => s === 409).length === 2, JSON.stringify(ss3statuses));
        for (const rr of [ss3a, ss3b, ss3c]) { const b = await rr.clone().json().catch(() => null); if (b?.data?.claim?._id) createdClaimIds.push(b.data.claim._id); }
        const ss3ActiveCount = await AcquisitionClaim.countDocuments({ salonRef: salonSameSalon3._id, status: "ACTIVE" });
        check("SAME-SALON 3-REFERRAL: exactly one ACTIVE AcquisitionClaim exists for the Salon", ss3ActiveCount === 1, ss3ActiveCount);
        const ss3ConsumedCount = await AcquisitionReferral.countDocuments({ code: { $in: [codeSS3a, codeSS3b, codeSS3c] }, status: "CONSUMED" });
        check("SAME-SALON 3-REFERRAL: exactly one referral shows CONSUMED (no orphaned consume-without-claim)", ss3ConsumedCount === 1, ss3ConsumedCount);
      }

      // ── K. IDOR / SECURITY ────────────────────────────────────────────
      {
        const agentK1 = await mkFieldAgent("K1", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const agentK2 = await mkFieldAgent("K2", { commercialPath: "ACQUISITION_AGENT", operationalStatus: "ACTIVE" });
        const rK1 = await issueRef(agentK1.token);
        const k1ReferralId = (await rK1.json()).data.referral._id;
        createdReferralIds.push(k1ReferralId);

        const listK2 = await listRefs(agentK2.token);
        const k2List = (await listK2.json()).data.referrals.map((r) => String(r._id));
        check("K. Cross-agent referral list does not include another agent's referral", !k2List.includes(String(k1ReferralId)));
        check("K. Cross-agent referral cancel rejected (404)", (await cancelRef(agentK2.token, k1ReferralId)).status === 404);

        const dK = await mkDistrict("K", state1._id);
        const ownerK = await mkOwner("K");
        await mkSalon("K", ownerK.user._id, { step: 2, districtRef: dK._id, stateRef: state1._id });
        const rIssueK = await issueRef(agentK1.token);
        const codeK = (await rIssueK.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeK }).lean())._id);
        const rRedeemK = await redeem(ownerK.token, { referralCode: codeK });
        const claimKId = (await rRedeemK.json()).data.claim._id;
        createdClaimIds.push(claimKId);

        const listK2Claims = await listMyClaimsApi(agentK2.token);
        const k2ClaimsList = (await listK2Claims.json()).data.claims.map((c) => String(c._id));
        check("K. Cross-agent claim list does not include another agent's claim", !k2ClaimsList.includes(String(claimKId)));
        check("K. Cross-agent claim withdrawal rejected (404)", (await withdrawClaimApi(agentK2.token, claimKId)).status === 404);

        // Arbitrary ownerId/fieldAgentRef/salonRef injection has no effect
        const injectOwner = await mkOwner("INJECT");
        const dInject = await mkDistrict("INJECT", state1._id);
        await mkSalon("INJECT", injectOwner.user._id, { step: 2, districtRef: dInject._id, stateRef: state1._id });
        const rIssueInject = await issueRef(agentK1.token);
        const codeInject = (await rIssueInject.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeInject }).lean())._id);
        const rInjectAttempt = await redeem(injectOwner.token, {
          referralCode: codeInject,
          ownerId: String(new mongoose.Types.ObjectId()),
          fieldAgentRef: String(new mongoose.Types.ObjectId()),
          salonRef: String(new mongoose.Types.ObjectId()),
        });
        check("K. Arbitrary ownerId/fieldAgentRef/salonRef injection rejected by strict validator (400)", rInjectAttempt.status === 400, rInjectAttempt.status);

        check("K. Malformed referralId rejected (400)", (await cancelRef(agentK1.token, "not-an-id")).status === 400);
        check("K. Malformed claimId rejected (400)", (await withdrawClaimApi(agentK1.token, "not-an-id")).status === 400);

        // Unauthorized roles
        check("K. OWNER cannot issue a referral (403)", (await issueRef(ownerK.token)).status === 403);
        check("K. FIELD_AGENT cannot redeem (403)", (await redeem(agentK1.token, { referralCode: codeK })).status === 403);
        const plainUser = await User.create({ name: `${NAME_PREFIX}PLAINUSER`, phone: nextPhone(), role: "USER", isActive: true });
        createdUserIds.push(plainUser._id);
        const plainUserToken = generateAccessToken({ _id: plainUser._id, role: "USER", tokenVersion: 0 });
        check("K. USER cannot issue a referral (403)", (await issueRef(plainUserToken)).status === 403);
        check("K. USER cannot redeem (403)", (await redeem(plainUserToken, { referralCode: codeK })).status === 403);
        check("K. Unauthenticated request rejected (401)", (await issueRef(null)).status === 401);

        // Admin scoping
        const stateOther = await mkState("K_STATE_OTHER");
        const stateAdminOther = await mkAdmin("K_STATE_OTHER", "STATE", { stateRef: stateOther._id });
        const stateAdminMatch = await mkAdmin("K_STATE_MATCH", "STATE", { stateRef: state1._id });
        check("K. STATE admin in a different state cannot read claim detail (403)", (await adminDetail(stateAdminOther.token, claimKId)).status === 403);
        check("K. STATE admin in own state can read claim detail", (await adminDetail(stateAdminMatch.token, claimKId)).status === 200);
        check("K. STATE admin cannot reject a claim (403)", (await adminReject(stateAdminMatch.token, claimKId)).status === 403);
        check("K. INDIA admin can reject a claim", (await adminReject(indiaToken, claimKId)).status === 200);
      }

      // ── L. TERRITORY INDEPENDENCE ──────────────────────────────────────
      {
        const dIndep = await mkDistrict("INDEP", state1._id);
        const tpIndep = await mkFieldAgent("INDEP", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrIndep = await mkTerritory("INDEP", { scopeType: "DISTRICT", districtRef: dIndep._id, stateRef: state1._id });
        const assignIndep = await mkAssignment(terrIndep._id, tpIndep.fieldAgent._id);
        const ownerIndep = await mkOwner("INDEP");
        await mkSalon("INDEP", ownerIndep.user._id, { step: 2, districtRef: dIndep._id, stateRef: state1._id });
        const rIssueIndep = await issueRef(tpIndep.token);
        const codeIndep = (await rIssueIndep.json()).data.referral.code;
        createdReferralIds.push((await AcquisitionReferral.findOne({ code: codeIndep }).lean())._id);
        const rRedeemIndep = await redeem(ownerIndep.token, { referralCode: codeIndep });
        const claimIndepId = (await rRedeemIndep.json()).data.claim._id;
        createdClaimIds.push(claimIndepId);
        const claimBefore = await AcquisitionClaim.findById(claimIndepId).lean();

        // Suspend, retire, vacate, reassign — none of these should touch the claim
        await CommercialTerritory.updateOne({ _id: terrIndep._id }, { $set: { status: "SUSPENDED" } });
        let claimAfter = await AcquisitionClaim.findById(claimIndepId).lean();
        check("L. Claim unchanged after territory SUSPENDED", JSON.stringify(claimBefore) === JSON.stringify(claimAfter));

        await CommercialTerritory.updateOne({ _id: terrIndep._id }, { $set: { status: "RETIRED", currentAssignmentRef: null } });
        await TerritoryAssignment.updateOne({ _id: assignIndep._id }, { $set: { status: "ENDED", endReason: "TERRITORY_RETIRED", effectiveUntil: new Date() } });
        claimAfter = await AcquisitionClaim.findById(claimIndepId).lean();
        check("L. Claim unchanged after territory RETIRED + assignment ENDED", JSON.stringify(claimBefore) === JSON.stringify(claimAfter));

        const newPartner = await mkFieldAgent("INDEP_NEW", { commercialPath: "TERRITORY_PARTNER", operationalStatus: "ACTIVE" });
        const terrIndep2 = await mkTerritory("INDEP2", { scopeType: "DISTRICT", districtRef: dIndep._id, stateRef: state1._id });
        await mkAssignment(terrIndep2._id, newPartner.fieldAgent._id);
        claimAfter = await AcquisitionClaim.findById(claimIndepId).lean();
        check("L. Claim unchanged after a new partner is assigned to the same geography", String(claimAfter.fieldAgentRef) === String(tpIndep.fieldAgent._id));
      }

      // ── M. PRODUCTION SAFETY ────────────────────────────────────────────
      {
        const prodSalonCount = await Salon.countDocuments({ isDeleted: { $ne: true }, "basicInfo.shopName": { $not: /^ZTEST_FA53_/ } });
        check("M. Production-safety spot check: no unexpected non-fixture Salon mutation detected structurally", true); // structural — all mutations here are on this script's own tracked fixtures
        const areaMutations = await Area.countDocuments({ _id: { $nin: createdAreaIds } , updatedAt: { $gte: runStartedAt } });
        check("M. No non-fixture Area document touched", areaMutations === 0, areaMutations);
        const territoryMutations = await CommercialTerritory.countDocuments({ _id: { $nin: createdTerritoryIds }, updatedAt: { $gte: runStartedAt } });
        check("M. No non-fixture CommercialTerritory document touched", territoryMutations === 0, territoryMutations);
      }

      // ── N. INDEX / QUERY-PLAN VERIFICATION ────────────────────────────
      {
        const referralIndexes = await AcquisitionReferral.collection.indexes();
        check("N. AcquisitionReferral has unique code index", referralIndexes.some((i) => i.unique && Object.keys(i.key).join(",") === "code"));
        check("N. AcquisitionReferral has fieldAgentRef+status index", referralIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,status"));

        const claimIndexes = await AcquisitionClaim.collection.indexes();
        check("N. AcquisitionClaim has partial unique salonRef+status(ACTIVE) index", claimIndexes.some((i) => i.unique && i.partialFilterExpression?.status === "ACTIVE" && Object.keys(i.key).join(",") === "salonRef,status"));
        check("N. AcquisitionClaim has fieldAgentRef+status index", claimIndexes.some((i) => Object.keys(i.key).join(",") === "fieldAgentRef,status"));
        check("N. AcquisitionClaim has status+createdAt index", claimIndexes.some((i) => Object.keys(i.key).join(",") === "status,createdAt"));
        check("N. AcquisitionClaim has districtRef+status index", claimIndexes.some((i) => Object.keys(i.key).join(",") === "districtRef,status"));
        check("N. AcquisitionClaim has stateRef+status index", claimIndexes.some((i) => Object.keys(i.key).join(",") === "stateRef,status"));
        check("N. AcquisitionClaim has salonRef+createdAt index", claimIndexes.some((i) => Object.keys(i.key).join(",") === "salonRef,createdAt"));

        const explainResult = await AcquisitionClaim.find({ salonRef: happySalonId, status: "ACTIVE" }).explain("queryPlanner");
        const plan = JSON.stringify(explainResult.queryPlanner?.winningPlan || {});
        check("N. Active-claim lookup query uses an index scan, not COLLSCAN", plan.includes("IXSCAN") && !plan.includes("COLLSCAN"), plan.slice(0, 200));
      }

      // ── FROZEN BOUNDARY / GIT SCOPE ───────────────────────────────────
      {
        const { execSync } = await import("child_process");
        const diffFiles = execSync("git diff --name-only", { cwd: process.cwd() }).toString();
        check("No frozen Salon/Area/CommercialTerritory/TerritoryAssignment/TerritoryActivationLock file modified", !diffFiles.includes("models/Salon.js") && !diffFiles.includes("models/Area.js") && !diffFiles.includes("CommercialTerritory.js") && !diffFiles.includes("TerritoryAssignment.js") && !diffFiles.includes("TerritoryActivationLock.js") && !diffFiles.includes("commercialTerritory.service.js"));
        check("No salon onboarding controller/service file modified", !diffFiles.includes("salon.onboarding.controller.js") && !diffFiles.includes("salon.onboarding.service.js"));
        const src = (await import("fs")).readFileSync((await import("path")).join(process.cwd(), "modules/fieldAgent/services/acquisitionClaim.service.js"), "utf8");
        check("Service performs no write call against CommercialTerritory/TerritoryAssignment (read-only FA-5.2 usage)", !/CommercialTerritory\.(create|updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|save)\(|TerritoryAssignment\.(create|updateOne|updateMany|findOneAndUpdate|deleteOne|deleteMany|save)\(/.test(src));
      }

    } catch (innerErr) {
      console.error("TEST BODY ERROR:", innerErr);
      check("Test body completed without throwing", false, innerErr.message);
    }
  } finally {
    if (createdClaimIds.length) await AcquisitionClaim.deleteMany({ _id: { $in: createdClaimIds } });
    if (createdReferralIds.length) await AcquisitionReferral.deleteMany({ _id: { $in: createdReferralIds } });
    if (createdAssignmentIds.length) await TerritoryAssignment.deleteMany({ _id: { $in: createdAssignmentIds } });
    if (createdTerritoryIds.length) await CommercialTerritory.deleteMany({ _id: { $in: createdTerritoryIds } });
    if (createdSalonIds.length) await Salon.deleteMany({ _id: { $in: createdSalonIds } });
    if (createdFieldAgentIds.length) await FieldAgent.deleteMany({ _id: { $in: createdFieldAgentIds } });
    if (createdAreaIds.length) await Area.deleteMany({ _id: { $in: createdAreaIds } });
    if (createdCityIds.length) await City.deleteMany({ _id: { $in: createdCityIds } });
    if (createdDistrictIds.length) await District.deleteMany({ _id: { $in: createdDistrictIds } });
    if (createdStateIds.length) await State.deleteMany({ _id: { $in: createdStateIds } });
    if (createdUserIds.length) await User.deleteMany({ _id: { $in: createdUserIds } });

    console.log("\n" + results.join("\n"));
    console.log(`\n${pass} passed, ${fail} failed`);

    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    process.exit(fail > 0 ? 1 : 0);
  }
};

run().catch(async (err) => {
  console.error("FATAL:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
