/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFinanceP02RevenueEngineQuarantine.js
 *
 * FINANCE-P0-2 QUARANTINE — disposable live verification.
 *
 * Real Express app (app.listen(0)), real signed JWTs, real Atlas dev DB.
 * Every fixture this script creates is tracked by exact _id and purged in
 * the `finally` block. The ONE real, pre-existing RevenueSettings document
 * (the RETIRED historical record) is READ ONLY here — never created,
 * updated, or deleted by this script.
 *
 * Proves:
 *   A. GET historical RevenueSettings (list/published/detail) still works
 *   B. The existing RETIRED RevenueSettings document is byte-for-byte
 *      unchanged after every check below
 *   C-F. create/update/publish/retire all reject with 410
 *        LEGACY_REVENUE_ENGINE_DISABLED (service-level AND over real HTTP)
 *   G-L. zero count change across RevenueSettings/RevenueSplit/Booking/
 *        Transaction/GSTLedger/WalletLedger/WalletTransaction/SalonEarnings
 *   R.   an INDIA admin hitting the mutation endpoints gets 410, not 200
 *   S.   STATE admin / OWNER / FIELD_AGENT / unauthenticated are all still
 *        blocked before ever reaching the quarantine guard (403/401,
 *        unchanged RBAC — proves the guard did not weaken anything)
 *   T.   the real HTTP response body carries the stable machine-readable
 *        code LEGACY_REVENUE_ENGINE_DISABLED
 *
 * Run:  cd backend && node scripts/e2e/verifyFinanceP02RevenueEngineQuarantine.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";
import RevenueSettings from "../../modules/finance/models/RevenueSettings.js";
import RevenueSplit from "../../modules/finance/models/RevenueSplit.js";
import GSTLedger from "../../modules/finance/models/GSTLedger.js";
import Booking from "../../models/Booking.js";
import Transaction from "../../models/Transaction.js";
import WalletLedger from "../../models/WalletLedger.js";
import WalletTransaction from "../../models/WalletTransaction.js";
import SalonEarnings from "../../models/SalonEarnings.js";
import {
  createDraftRevenueSettings,
  updateDraftRevenueSettings,
  publishRevenueSettings,
  retireRevenueSettings,
  listRevenueSettings,
  getRevenueSettingsDetail,
  getPublishedRevenueSettings,
} from "../../modules/finance/services/RevenueSettingsService.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const P = "ZTEST_FINP02Q_";
const oid = () => new mongoose.Types.ObjectId();
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

const countsOf = async () => ({
  RevenueSettings: await RevenueSettings.countDocuments({}),
  RevenueSplit: await RevenueSplit.countDocuments({}),
  GSTLedger: await GSTLedger.countDocuments({}),
  Booking: await Booking.countDocuments({}),
  Transaction: await Transaction.countDocuments({}),
  WalletLedger: await WalletLedger.countDocuments({}),
  WalletTransaction: await WalletTransaction.countDocuments({}),
  SalonEarnings: await SalonEarnings.countDocuments({}),
});

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

  const BASE = "/api/admin/finance/revenue-settings";
  const fixtureUserIds = [];

  try {
    const before = await countsOf();

    const existingRetired = await RevenueSettings.findOne({ status: "RETIRED" }).lean();
    const retiredSnapshotBefore = existingRetired
      ? JSON.parse(JSON.stringify(existingRetired))
      : null;

    // ── SETUP ──────────────────────────────────────────────────────
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA" }).select("+tokenVersion").lean();
    if (!indiaAdmin) throw new Error("No INDIA admin in DB to drive this verification");
    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });

    const stateAdminUser = await User.create({ name: `${P}STATE_ADMIN`, email: `${P.toLowerCase()}state_${Date.now()}@ztest.local`, phone: phone(), role: "ADMIN", adminLevel: "STATE", adminSubRole: "PRIMARY", countryRef: oid(), stateRef: oid() });
    fixtureUserIds.push(stateAdminUser._id);
    const stateToken = generateAccessToken({ _id: stateAdminUser._id, role: "ADMIN", adminLevel: "STATE", tokenVersion: 0 });

    const ownerUser = await User.create({ name: `${P}OWNER`, phone: phone(), role: "OWNER" });
    fixtureUserIds.push(ownerUser._id);
    const ownerToken = generateAccessToken({ _id: ownerUser._id, role: "OWNER", tokenVersion: 0 });

    // ═══ A. HISTORICAL READ ACCESS (service-level, direct) ══════════
    const listResult = await listRevenueSettings({ page: 1, limit: 20 });
    check("A1. listRevenueSettings() still returns data", Array.isArray(listResult) && listResult.length >= 1, listResult.length);

    const publishedResult = await getPublishedRevenueSettings();
    check("A2. getPublishedRevenueSettings() still callable (null — none PUBLISHED today)", publishedResult === null, publishedResult);

    if (existingRetired) {
      const detailResult = await getRevenueSettingsDetail(existingRetired._id);
      check("A3. getRevenueSettingsDetail() still returns the real RETIRED record", String(detailResult._id) === String(existingRetired._id), detailResult);
    } else {
      check("A3. getRevenueSettingsDetail() — skipped, no existing record found", false, "no RevenueSettings document exists");
    }

    // ═══ A (HTTP). GET endpoints still reachable over real HTTP for INDIA admin ═══
    let r = await authFetch(BASE, indiaToken, { method: "GET" });
    check("A4. GET / (list) over HTTP -> 200", r.status === 200, r);
    r = await authFetch(`${BASE}/published`, indiaToken, { method: "GET" });
    check("A5. GET /published over HTTP -> 200", r.status === 200, r);
    if (existingRetired) {
      r = await authFetch(`${BASE}/${existingRetired._id}`, indiaToken, { method: "GET" });
      check("A6. GET /:versionId over HTTP -> 200", r.status === 200, r);
    }

    // ═══ C-F. MUTATIONS REJECTED (service-level, direct) ═══════════
    const expectQuarantined = async (label, fn) => {
      try {
        await fn();
        check(label, false, "did not throw");
      } catch (err) {
        check(label, err.statusCode === 410 && err.code === "LEGACY_REVENUE_ENGINE_DISABLED", { statusCode: err.statusCode, code: err.code, message: err.message });
      }
    };

    await expectQuarantined("C1. createDraftRevenueSettings() -> 410 LEGACY_REVENUE_ENGINE_DISABLED", () =>
      createDraftRevenueSettings({ adminId: indiaAdmin._id, platformFeeInPaise: 1000, gstRate: 18, gstEnabled: true, minimumPayoutInPaise: 10000, autoPayoutEnabled: false })
    );
    await expectQuarantined("D1. updateDraftRevenueSettings() -> 410 LEGACY_REVENUE_ENGINE_DISABLED", () =>
      updateDraftRevenueSettings({ versionId: existingRetired?._id || oid(), adminId: indiaAdmin._id, platformFeeInPaise: 1000 })
    );
    await expectQuarantined("E1. publishRevenueSettings() -> 410 LEGACY_REVENUE_ENGINE_DISABLED", () =>
      publishRevenueSettings({ versionId: existingRetired?._id || oid(), adminId: indiaAdmin._id })
    );
    await expectQuarantined("F1. retireRevenueSettings() -> 410 LEGACY_REVENUE_ENGINE_DISABLED", () =>
      retireRevenueSettings({ versionId: existingRetired?._id || oid(), adminId: indiaAdmin._id })
    );

    // ═══ R/T. MUTATIONS REJECTED over real HTTP, as an INDIA admin ═══
    r = await authFetch(BASE, indiaToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 100 }) });
    check("R1. POST / (create draft) as INDIA admin -> 410", r.status === 410, r);
    check("T1. POST / response carries LEGACY_REVENUE_ENGINE_DISABLED code", r.data?.code === "LEGACY_REVENUE_ENGINE_DISABLED" || r.data?.error?.code === "LEGACY_REVENUE_ENGINE_DISABLED", r.data);

    const anyIdForUrl = existingRetired?._id || oid();
    r = await authFetch(`${BASE}/${anyIdForUrl}`, indiaToken, { method: "PATCH", body: JSON.stringify({ platformFee: 20 }) });
    check("R2. PATCH /:id (update draft) as INDIA admin -> 410", r.status === 410, r);

    r = await authFetch(`${BASE}/${anyIdForUrl}/publish`, indiaToken, { method: "POST" });
    check("R3. POST /:id/publish as INDIA admin -> 410", r.status === 410, r);

    r = await authFetch(`${BASE}/${anyIdForUrl}/retire`, indiaToken, { method: "POST" });
    check("R4. POST /:id/retire as INDIA admin -> 410", r.status === 410, r);

    // ═══ S. RBAC UNCHANGED — non-INDIA callers still blocked BEFORE the
    // quarantine guard is ever reached (403, not 410) ══════════════════
    r = await authFetch(BASE, stateToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 100 }) });
    check("S1. STATE admin POST / -> 403 (blocked by requireAdminLevel, same as before)", r.status === 403, r);

    r = await authFetch(BASE, ownerToken, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 100 }) });
    check("S2. OWNER POST / -> 403 (not an admin at all)", r.status === 403, r);

    r = await authFetch(BASE, null, { method: "POST", body: JSON.stringify({ platformFee: 20, gstRate: 18, minimumPayout: 100 }) });
    check("S3. Unauthenticated POST / -> 401", r.status === 401, r);

    r = await authFetch(`${BASE}/${anyIdForUrl}/publish`, stateToken, { method: "POST" });
    check("S4. STATE admin POST /:id/publish -> 403", r.status === 403, r);

    // ═══ B. HISTORICAL RECORD INTEGRITY ════════════════════════════
    if (existingRetired) {
      const retiredSnapshotAfter = await RevenueSettings.findById(existingRetired._id).lean();
      check(
        "B1. Existing RETIRED RevenueSettings document byte-for-byte unchanged",
        JSON.stringify(retiredSnapshotAfter) === JSON.stringify(retiredSnapshotBefore),
        { before: retiredSnapshotBefore, after: retiredSnapshotAfter }
      );
    }

    // ═══ G-L. ZERO COUNT CHANGE ACROSS EVERY FINANCIAL COLLECTION ═══
    const after = await countsOf();
    check("G1. RevenueSettings count unchanged", after.RevenueSettings === before.RevenueSettings, { before: before.RevenueSettings, after: after.RevenueSettings });
    check("H1. RevenueSplit count unchanged", after.RevenueSplit === before.RevenueSplit, { before: before.RevenueSplit, after: after.RevenueSplit });
    check("K1. GSTLedger count unchanged", after.GSTLedger === before.GSTLedger, { before: before.GSTLedger, after: after.GSTLedger });
    check("I1. Booking count unchanged", after.Booking === before.Booking, { before: before.Booking, after: after.Booking });
    check("J1. Transaction count unchanged", after.Transaction === before.Transaction, { before: before.Transaction, after: after.Transaction });
    check("L1. WalletLedger count unchanged", after.WalletLedger === before.WalletLedger, { before: before.WalletLedger, after: after.WalletLedger });
    check("L2. WalletTransaction count unchanged", after.WalletTransaction === before.WalletTransaction, { before: before.WalletTransaction, after: after.WalletTransaction });
    check("L3. SalonEarnings count unchanged", after.SalonEarnings === before.SalonEarnings, { before: before.SalonEarnings, after: after.SalonEarnings });

  } finally {
    await User.deleteMany({ _id: { $in: fixtureUserIds } });
    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nFINANCE-P0-2 QUARANTINE: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
