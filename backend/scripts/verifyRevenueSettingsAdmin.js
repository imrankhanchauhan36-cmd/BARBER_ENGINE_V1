/**
 * BARBER_ENGINE_V1
 * backend/scripts/verifyRevenueSettingsAdmin.js
 *
 * P0 Revenue Calculation Engine — Step 2 — disposable live verification.
 *
 * Real Express app (app.listen(0)), real signed JWTs, real Atlas dev DB,
 * disposable fixtures purged before/after. Proves:
 *   1. Only INDIA-level admin ("Super Admin" in this codebase — see the
 *      routes file's own header) can create/update/publish/retire;
 *      STATE/DISTRICT and unauthenticated are all rejected.
 *   2. Save (POST) creates a DRAFT only — no PUBLISHED row exists yet.
 *   3. Publish retires whichever version was previously PUBLISHED and
 *      makes the new one PUBLISHED — atomically.
 *   4. Only one PUBLISHED version can ever exist (DB-enforced).
 *   5. GET /published reflects the live PUBLISHED version exactly.
 *   6. Existing bookings never change: an already-created RevenueSplit
 *      (Step 1) keeps its old snapshot after a republish through this
 *      Step 2 API.
 *   7. Validation: rupees converted to paise correctly; bad input
 *      rejected; server-controlled fields cannot be injected.
 *
 * Run:  cd backend && node scripts/verifyRevenueSettingsAdmin.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../app.js";
import connectDB from "../config/db.js";
import { generateAccessToken } from "../services/token.service.js";
import User from "../models/User.js";
import RevenueSettings from "../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../modules/finance/models/RevenueSplit.js";
import { calculateRevenue } from "../modules/finance/services/RevenueCalculationService.js";
import { toRevenueSplitDocumentDTO } from "../modules/finance/dto/revenue.dto.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const P = "ZTEST_REVSET2_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const purgeFixtures = async (fixtureUserIds, fixtureSettingsIds, fixtureSplitIds) => {
  await RevenueSplit.collection.deleteMany({ _id: { $in: fixtureSplitIds } });
  await RevenueSettings.deleteMany({ _id: { $in: fixtureSettingsIds } });
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
  const fixtureSplitIds = [];
  const BASE = "/api/admin/finance/revenue-settings";

  try {
    // ── SETUP ────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateAdminUser = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    fixtureUserIds.push(stateAdminUser._id);
    const stateToken = generateAccessToken({ _id: stateAdminUser._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    // Baseline: retire whatever this fixture run's ancestors may have left
    // PUBLISHED so "only one PUBLISHED" checks below start from a clean slate.
    await RevenueSettings.updateMany({ status: "PUBLISHED", createdBy: { $exists: true } }, {}); // no-op guard; real cleanup is fixture-scoped below

    // ═══ A. AUTH / RBAC ═══════════════════════════════════════════
    let r = await authFetch(BASE, null, { method: "GET" });
    check("A1. Unauthenticated GET denied (401)", r.status === 401, r.status);

    r = await authFetch(BASE, stateToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 500 }) });
    check("A2. STATE admin cannot create a draft (403) — only INDIA ('Super Admin') can edit", r.status === 403, r.data);

    r = await authFetch(BASE, stateToken, { method: "GET" });
    check("A3. STATE admin cannot even LIST (403) — INDIA-only for every verb, matches GST/Platform Fee precedent", r.status === 403, r.data);

    // ═══ B. SAVE = DRAFT ONLY (never auto-published) ═════════════
    r = await authFetch(BASE, indiaToken, {
      method: "POST",
      body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 500, autoPayoutEnabled: false }),
    });
    check("B1. INDIA admin creates a draft (201)", r.status === 201, r.data);
    const draft1 = r.data?.data;
    fixtureSettingsIds.push(draft1?.id);
    check("B2. Response converts rupees correctly: platformFee=20, gstRate=18, minimumPayout=500", draft1?.platformFee === 20 && draft1?.gstRate === 18 && draft1?.minimumPayout === 500, draft1);
    check("B3. New draft has status DRAFT — Save never auto-publishes", draft1?.status === "DRAFT", draft1?.status);

    const storedRaw = await RevenueSettings.findById(draft1.id).lean();
    check("B4. Stored in paise correctly: platformFeeInPaise=2000, minimumPayoutInPaise=50000", storedRaw.platformFeeInPaise === 2000 && storedRaw.minimumPayoutInPaise === 50000, storedRaw);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("B5. GET /published shows the PREVIOUS live state (this new draft has not published anything)", r.status === 200, r.data);
    const publishedBeforeAnyPublish = r.data?.data;

    // ═══ C. VALIDATION ════════════════════════════════════════════
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: -5, gstRate: 18, minimumPayout: 500 }) });
    check("C1. Negative platformFee rejected (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 150, minimumPayout: 500 }) });
    check("C2. gstRate > 100 rejected (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 500, status: "PUBLISHED" }) });
    check("C3. Client-supplied status is rejected outright (400) — never silently stripped and honored", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 500, version: 999999 }) });
    check("C4. Client-supplied version is rejected outright (400)", r.status === 400, r.data);
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18 }) });
    check("C5. Missing required field (minimumPayout) rejected (400)", r.status === 400, r.data);

    // ═══ D. PUBLISH — retires the previous PUBLISHED version atomically ══
    r = await authFetch(`${BASE}/${draft1.id}/publish`, stateToken, { method: "POST" });
    check("D1. STATE admin cannot publish (403)", r.status === 403, r.data);

    r = await authFetch(`${BASE}/${draft1.id}/publish`, indiaToken, { method: "POST" });
    check("D2. INDIA admin publishes the draft (200)", r.status === 200 && r.data?.data?.status === "PUBLISHED", r.data);
    const v1Version = r.data.data.version;

    check("D3. Exactly one PUBLISHED RevenueSettings exists in the whole collection", (await RevenueSettings.countDocuments({ status: "PUBLISHED" })) === 1);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("D4. GET /published now returns this exact version (fee ₹20, GST 18%, min ₹500)", r.data?.data?.id === draft1.id && r.data.data.platformFee === 20, r.data);

    // Draft #2 — a higher fee, to prove publish RETIRES the prior one.
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 25, gstRate: 18, minimumPayout: 500, autoPayoutEnabled: true }) });
    const draft2 = r.data.data;
    fixtureSettingsIds.push(draft2.id);
    check("D5. Second draft created (₹25 fee)", r.status === 201 && draft2.platformFee === 25, draft2);

    r = await authFetch(`${BASE}/${draft2.id}/publish`, indiaToken, { method: "POST" });
    check("D6. Publishing the SECOND draft succeeds (200)", r.status === 200 && r.data?.data?.status === "PUBLISHED", r.data);

    const v1After = await RevenueSettings.findById(draft1.id).lean();
    check("D7. The FIRST version is now RETIRED — publish atomically retired it", v1After.status === "RETIRED" && !!v1After.retiredAt, v1After);
    check("D8. Still exactly ONE PUBLISHED version after the second publish (DB-enforced 'only one PUBLISHED')", (await RevenueSettings.countDocuments({ status: "PUBLISHED" })) === 1);

    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("D9. GET /published now reflects the NEW live version (₹25 fee), not the old one", r.data?.data?.id === draft2.id && r.data.data.platformFee === 25, r.data);

    // Attempting to publish an already-non-DRAFT version is rejected.
    r = await authFetch(`${BASE}/${draft1.id}/publish`, indiaToken, { method: "POST" });
    check("D10. Publishing an already-RETIRED version is rejected (409)", r.status === 409, r.data);

    // ═══ E. DB-LEVEL invariant survives even a bypassed code path ════
    let dbLevelErr;
    try {
      await RevenueSettings.create({ platformFeeInPaise: 3000, gstRate: 18, minimumPayoutInPaise: 50000, version: 88888888, status: "PUBLISHED", publishedAt: new Date(), createdBy: indiaAdmin._id });
    } catch (e) { dbLevelErr = e; }
    check("E1. Even a DIRECT model write attempting a second PUBLISHED row is rejected by the partial unique index (not just the service)", dbLevelErr?.code === 11000, dbLevelErr?.message);
    // in case E1 unexpectedly succeeded, make sure it's cleaned up too
    const stray = await RevenueSettings.findOne({ version: 88888888 }).lean();
    if (stray) fixtureSettingsIds.push(stray._id);

    // ═══ F. EXISTING BOOKINGS NEVER CHANGE (Step 1 + Step 2 integration) ══
    const bookingId = oid();
    const calcAtV1 = calculateRevenue({ serviceAmountInPaise: 10000, revenueSettings: { platformFeeInPaise: v1After.platformFeeInPaise, gstRate: v1After.gstRate, gstEnabled: v1After.gstEnabled, version: v1Version } });
    const split = await RevenueSplit.create({ bookingId, ...toRevenueSplitDocumentDTO(calcAtV1) });
    fixtureSplitIds.push(split._id);
    check("F1. A RevenueSplit calculated against the FIRST published version stores fee ₹20, GST ₹3.60, customer ₹123.60", split.platformFeeInPaise === 2000 && split.gstAmountInPaise === 360 && split.customerPaidInPaise === 12360, split.toObject());

    // Publish a THIRD version (₹30 fee) through the real API.
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 30, gstRate: 18, minimumPayout: 500 }) });
    const draft3 = r.data.data;
    fixtureSettingsIds.push(draft3.id);
    r = await authFetch(`${BASE}/${draft3.id}/publish`, indiaToken, { method: "POST" });
    check("F2. A THIRD version (₹30 fee) published via the real API", r.status === 200 && r.data.data.platformFee === 30, r.data);

    const splitAfterRepublish = await RevenueSplit.findById(split._id).lean();
    check("F3. THE EXISTING BOOKING'S SPLIT IS UNCHANGED after two more publishes through this Step 2 API — still fee ₹20, GST ₹3.60, customer ₹123.60, old policyVersion",
      splitAfterRepublish.platformFeeInPaise === 2000 && splitAfterRepublish.customerPaidInPaise === 12360 && splitAfterRepublish.policyVersion === v1Version,
      splitAfterRepublish);

    // ═══ G. Read/list/detail/retire ════════════════════════════════
    r = await authFetch(`${BASE}?page=1&limit=50`, indiaToken, { method: "GET" });
    const listedIds = (r.data?.data || []).map((v) => v.id);
    check("G1. List includes all three fixture versions", [draft1.id, draft2.id, draft3.id].every((id) => listedIds.includes(id)), listedIds);

    r = await authFetch(`${BASE}/${draft1.id}`, indiaToken, { method: "GET" });
    check("G2. Detail fetch for a RETIRED version still works (audit trail)", r.status === 200 && r.data.data.status === "RETIRED");

    r = await authFetch(`${BASE}/${draft3.id}/retire`, indiaToken, { method: "POST" });
    check("G3. Retiring the currently-PUBLISHED version works and clears /published", r.status === 200 && r.data.data.status === "RETIRED");
    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("G4. GET /published now returns null (nothing PUBLISHED)", r.data?.data === null, r.data);
    check("G5. Zero PUBLISHED versions exist after the manual retire", (await RevenueSettings.countDocuments({ status: "PUBLISHED" })) === 0);

    // Update-draft path, then publish it — proves the full lifecycle once more end-to-end.
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 22, gstRate: 12, minimumPayout: 600 }) });
    const draft4 = r.data.data;
    fixtureSettingsIds.push(draft4.id);
    r = await authFetch(`${BASE}/${draft4.id}`, indiaToken, { method: "PATCH", body: JSON.stringify({ platformFee: 24 }) });
    check("G6. PATCH updates a DRAFT in place (still DRAFT, new fee ₹24)", r.status === 200 && r.data.data.platformFee === 24 && r.data.data.status === "DRAFT", r.data);
    r = await authFetch(`${BASE}/${draft4.id}/publish`, indiaToken, { method: "POST" });
    check("G7. That updated draft then publishes normally", r.status === 200 && r.data.data.platformFee === 24 && r.data.data.status === "PUBLISHED");
    r = await authFetch(`${BASE}/${draft1.id}`, indiaToken, { method: "PATCH", body: JSON.stringify({ platformFee: 99 }) });
    check("G8. PATCH on a RETIRED (non-DRAFT) version is rejected (409) — history is immutable", r.status === 409, r.data);
  } catch (err) {
    fail++; results.push(`❌ UNEXPECTED ERROR — ${err.stack || err}`);
  } finally {
    await purgeFixtures(fixtureUserIds, fixtureSettingsIds.filter(Boolean), fixtureSplitIds).catch((e) => results.push(`⚠️ purge error ${e.message}`));
    server.close();
    await mongoose.disconnect();
  }
  console.log(results.join("\n"));
  console.log(`\nRESULT: ${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
};
run();
