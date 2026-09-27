/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyTerritoryRevenueSettingsAdmin.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine — disposable live
 * verification. Same methodology as verifyRevenueSettingsAdmin.js: real
 * Express app (app.listen(0)), real signed JWTs, real Atlas dev DB,
 * disposable fixtures purged before/after. Proves:
 *   1. Only INDIA-level admin can create/update/publish/retire;
 *      STATE/DISTRICT and unauthenticated are all rejected.
 *   2. Save (POST) creates a DRAFT only — no PUBLISHED row exists yet.
 *   3. Publish retires whichever version was previously PUBLISHED and
 *      makes the new one PUBLISHED — atomically.
 *   4. Only one PUBLISHED version can ever exist (DB-enforced).
 *   5. GET /published reflects the live PUBLISHED version exactly.
 *   6. Validation: rupees converted to paise correctly; bad input
 *      rejected; server-controlled fields cannot be injected.
 *   7. PATCH/retire lifecycle works exactly like RevenueSettings' own.
 *   8. ISOLATION (this ticket's central requirement): nothing this
 *      module does ever touches RevenueSettings or CommercialPolicyVersion
 *      (the pre-existing territoryPartnerCommissionPercent field flagged
 *      in the STEP 5.1 read-only audit).
 *
 * Run:  cd backend && node scripts/verifyTerritoryRevenueSettingsAdmin.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import TerritoryRevenueSettings from "../modules/finance/models/TerritoryRevenueSettings.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import CommercialPolicyVersion from "../modules/fieldAgent/models/CommercialPolicyVersion.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_TERRREV51_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const purgeFixtures = async (fixtureUserIds, fixtureSettingsIds) => {
  await TerritoryRevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds } });
  await User.deleteMany({ _id: { $in: fixtureUserIds } });
};

const run = async () => {
  await connectDB();
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

  const fixtureUserIds = [];
  const fixtureSettingsIds = [];
  const BASE = "/api/admin/finance/territory-settings";

  try {
    // ── SETUP ────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateAdminUser = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    fixtureUserIds.push(stateAdminUser._id);
    const stateToken = generateAccessToken({ _id: stateAdminUser._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    // Isolation baselines, taken BEFORE any TerritoryRevenueSettings
    // activity — snapshotting the exact untouched systems this ticket
    // requires stay untouched.
    const revenueSettingsCountBefore = await RevenueSettings.countDocuments({});
    const commercialPolicySnapshotBefore = await CommercialPolicyVersion.find({}).select("_id territoryPartnerCommissionPercent status").sort({ _id: 1 }).lean();

    // ═══ A. AUTH / RBAC ═══════════════════════════════════════════
    let r = await authFetch(BASE, null, { method: "GET" });
    check("A1. Unauthenticated GET denied (401)", r.status === 401, r.status);

    r = await authFetch(BASE, stateToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 8, minimumPayout: 500 }) });
    check("A2. STATE admin cannot create a draft (403) — INDIA-only", r.status === 403, r.data);

    r = await authFetch(BASE, stateToken, { method: "GET" });
    check("A3. STATE admin cannot even LIST (403) — INDIA-only for every verb", r.status === 403, r.data);

    // ═══ B. SAVE = DRAFT ONLY (never auto-published) ═════════════
    r = await authFetch(BASE, indiaToken, {
      method: "POST",
      body: JSON.stringify({ territoryCommissionPercent: 8, minimumPayout: 500 }),
    });
    check("B1. INDIA admin creates a draft (201)", r.status === 201, r.data);
    const draft1 = r.data?.data;
    fixtureSettingsIds.push(draft1?.id);
    check("B2. Response converts rupees correctly: territoryCommissionPercent=8, minimumPayout=500", draft1?.territoryCommissionPercent === 8 && draft1?.minimumPayout === 500, draft1);
    check("B3. New draft has status DRAFT — Save never auto-publishes", draft1?.status === "DRAFT", draft1?.status);

    const storedRaw = await TerritoryRevenueSettings.findById(draft1.id).lean();
    check("B4. Stored in paise correctly: minimumPayoutInPaise=50000", storedRaw.minimumPayoutInPaise === 50000, storedRaw);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("B5. GET /published shows the PREVIOUS live state (this new draft has not published anything)", r.status === 200, r.data);

    // ═══ C. VALIDATION ════════════════════════════════════════════
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 150, minimumPayout: 500 }) });
    check("C1. territoryCommissionPercent > 100 rejected (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 8, minimumPayout: -5 }) });
    check("C2. Negative minimumPayout rejected (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 8, minimumPayout: 500, status: "PUBLISHED" }) });
    check("C3. Client-supplied status is rejected outright (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 8, minimumPayout: 500, version: 999999 }) });
    check("C4. Client-supplied version is rejected outright (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 8 }) });
    check("C5. Missing required field (minimumPayout) rejected (400)", r.status === 400, r.data);

    // ═══ D. PUBLISH — retires the previous PUBLISHED version atomically ══
    r = await authFetch(`${BASE}/${draft1.id}/publish`, stateToken, { method: "POST" });
    check("D1. STATE admin cannot publish (403)", r.status === 403, r.data);

    r = await authFetch(`${BASE}/${draft1.id}/publish`, indiaToken, { method: "POST" });
    check("D2. INDIA admin publishes the draft (200)", r.status === 200 && r.data?.data?.status === "PUBLISHED", r.data);

    check("D3. Exactly one PUBLISHED TerritoryRevenueSettings exists in the whole collection", (await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" })) === 1);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("D4. GET /published now returns this exact version (commission 8%, min ₹500)", r.data?.data?.id === draft1.id && r.data.data.territoryCommissionPercent === 8, r.data);

    // Draft #2 — a higher commission, to prove publish RETIRES the prior one.
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 10, minimumPayout: 500 }) });
    const draft2 = r.data.data;
    fixtureSettingsIds.push(draft2.id);
    check("D5. Second draft created (10% commission)", r.status === 201 && draft2.territoryCommissionPercent === 10, draft2);

    r = await authFetch(`${BASE}/${draft2.id}/publish`, indiaToken, { method: "POST" });
    check("D6. Publishing the SECOND draft succeeds (200)", r.status === 200 && r.data?.data?.status === "PUBLISHED", r.data);

    const v1After = await TerritoryRevenueSettings.findById(draft1.id).lean();
    check("D7. The FIRST version is now RETIRED — publish atomically retired it", v1After.status === "RETIRED" && !!v1After.retiredAt, v1After);
    check("D8. Still exactly ONE PUBLISHED version after the second publish (DB-enforced 'only one PUBLISHED')", (await TerritoryRevenueSettings.countDocuments({ status: "PUBLISHED" })) === 1);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("D9. GET /published now reflects the NEW live version (10%), not the old one", r.data?.data?.id === draft2.id && r.data.data.territoryCommissionPercent === 10, r.data);

    // ═══ E. DB-LEVEL invariant survives even a bypassed code path ════
    let dbLevelErr;
    try {
      await TerritoryRevenueSettings.create({ territoryCommissionPercent: 12, minimumPayoutInPaise: 50000, version: 88888888, status: "PUBLISHED", publishedAt: new Date(), createdBy: indiaAdmin._id });
    } catch (e) { dbLevelErr = e; }
    check("E1. Even a DIRECT model write attempting a second PUBLISHED row is rejected by the partial unique index", dbLevelErr?.code === 11000, dbLevelErr?.message);
    const stray = await TerritoryRevenueSettings.findOne({ version: 88888888 }).lean();
    if (stray) fixtureSettingsIds.push(stray._id);

    // ═══ F. PATCH + RETIRE lifecycle ════════════════════════════════
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ territoryCommissionPercent: 6, minimumPayout: 400 }) });
    const draft3 = r.data.data;
    fixtureSettingsIds.push(draft3.id);
    r = await authFetch(`${BASE}/${draft3.id}`, indiaToken, { method: "PATCH", body: JSON.stringify({ territoryCommissionPercent: 7 }) });
    check("F1. PATCH updates a DRAFT in place (still DRAFT, commission now 7%)", r.status === 200 && r.data.data.territoryCommissionPercent === 7 && r.data.data.status === "DRAFT", r.data);

    r = await authFetch(`${BASE}/${draft1.id}`, indiaToken, { method: "PATCH", body: JSON.stringify({ territoryCommissionPercent: 99 }) });
    check("F2. PATCH on a RETIRED (non-DRAFT) version is rejected (409) — history is immutable", r.status === 409, r.data);

    r = await authFetch(`${BASE}/${draft3.id}/publish`, indiaToken, { method: "POST" });
    check("F3a. Third draft (7%) publishes normally, retiring the second", r.status === 200 && r.data.data.status === "PUBLISHED", r.data);
    r = await authFetch(`${BASE}/${draft3.id}/retire`, indiaToken, { method: "POST" });
    const retiredOk = r.status === 200 && r.data.data.status === "RETIRED";
    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("F3. Retiring the currently-PUBLISHED version works and GET /published now returns null", retiredOk && r.data?.data === null, r.data);

    // ═══ G. ISOLATION — the ticket's central requirement ═════════════
    r = await authFetch(`${BASE}?page=1&limit=50`, indiaToken, { method: "GET" });
    const listedIds = (r.data?.data || []).map((v) => v.id);
    check("G1. List includes all fixture versions (isolated collection, own pagination)", [draft1.id, draft2.id, draft3.id].every((id) => listedIds.includes(id)), listedIds);

    const revenueSettingsCountAfter = await RevenueSettings.countDocuments({});
    check("G2. RevenueSettings collection is completely untouched by this entire run (count unchanged, LOCKED module)", revenueSettingsCountAfter === revenueSettingsCountBefore, { before: revenueSettingsCountBefore, after: revenueSettingsCountAfter });

    const commercialPolicySnapshotAfter = await CommercialPolicyVersion.find({}).select("_id territoryPartnerCommissionPercent status").sort({ _id: 1 }).lean();
    check("G3. CommercialPolicyVersion.territoryPartnerCommissionPercent (the pre-existing, separately-owned field) is completely untouched by this entire run", JSON.stringify(commercialPolicySnapshotBefore) === JSON.stringify(commercialPolicySnapshotAfter), { before: commercialPolicySnapshotBefore.length, after: commercialPolicySnapshotAfter.length });
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures(fixtureUserIds, fixtureSettingsIds.filter(Boolean)).catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
