/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyCustomersServerSidePagination.js
 *
 * ADMIN PANEL MUST-DO-NOW #1 — Customers server-side pagination fix.
 * Disposable, self-cleaning, live verification against the real
 * backend contract the fixed CustomersPage.jsx now relies on
 * (GET /admin/users, unmodified by this ticket). Real Express app
 * (app.listen(0)), real signed JWTs for existing real admins, real
 * Atlas dev DB. Every fixture tracked by exact _id and deleted in the
 * `finally` block. No backend file was touched by this ticket; this
 * script exists to prove the EXISTING contract behaves the way the
 * new frontend now depends on — most importantly, that a customer
 * positioned well beyond the old 100-row bulk-fetch window is still
 * found correctly via server-side search.
 */

import "dotenv/config";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";
import User from "../../models/User.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

const P = "ZTEST_CUST01_";
const phone = () => `8${Math.floor(100000000 + Math.random() * 899999999)}`;

const run = async () => {
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (path, token) =>
    fetch(url(path), { headers: { Authorization: `Bearer ${token}` } }).then(async (res) => ({ status: res.status, data: await res.json().catch(() => ({})) }));

  const fixtureUserIds = [];

  try {
    const beforeTotalUsers = await User.countDocuments({});
    const beforeCustomers = await User.countDocuments({ role: "USER", isDeleted: { $ne: true } });

    // ── Reuse real, existing admins (read-only lookups, zero new admin fixtures).
    // tokenVersion is read from the LIVE record (these are real, actively-used
    // admin accounts — hardcoding 0 produced an intermittent "Session expired"
    // in an earlier run once their real tokenVersion turned out to be non-zero). ──
    const indiaAdmin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id adminLevel tokenVersion").lean();
    const stateAdmin = await User.findOne({ role: "ADMIN", adminLevel: "STATE", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id adminLevel stateRef tokenVersion").lean();
    const districtAdmin = await User.findOne({ role: "ADMIN", adminLevel: "DISTRICT", isDeleted: { $ne: true }, accountStatus: "ACTIVE" }).select("_id adminLevel stateRef districtRef tokenVersion").lean();
    if (!indiaAdmin || !stateAdmin || !districtAdmin) throw new Error("Missing a real INDIA/STATE/DISTRICT admin fixture in this environment");

    const indiaToken = generateAccessToken({ _id: indiaAdmin._id, role: "ADMIN", adminLevel: "INDIA", tokenVersion: indiaAdmin.tokenVersion ?? 0 });
    const stateToken = generateAccessToken({ _id: stateAdmin._id, role: "ADMIN", adminLevel: "STATE", stateRef: stateAdmin.stateRef, tokenVersion: stateAdmin.tokenVersion ?? 0 });
    const districtToken = generateAccessToken({ _id: districtAdmin._id, role: "ADMIN", adminLevel: "DISTRICT", districtRef: districtAdmin.districtRef, tokenVersion: districtAdmin.tokenVersion ?? 0 });

    // ── Disposable fixtures: 105 "filler" customers (recent createdAt,
    // so they sort ahead of the target under the real default
    // createdAt-desc sort) + 1 uniquely-named "target" customer with a
    // deliberately old createdAt, guaranteeing it lands well past
    // position 100 (the old BULK_FETCH_LIMIT) regardless of how many
    // real customers already exist. All tagged with the stateRef of
    // the reused STATE admin so the RBAC/scope test has something
    // meaningful to check. ──────────────────────────────────────────
    const now = Date.now();
    const targetName = `${P}TARGET_RAHUL`;
    const targetPhone = phone();
    const fillerDocs = Array.from({ length: 105 }, (_, i) => ({
      name: `${P}FILLER_${i}`,
      phone: phone(),
      role: "USER",
      accountStatus: "ACTIVE",
      createdAt: new Date(now - i * 1000), // all newer than the target below
      stateRef: stateAdmin.stateRef,
    }));
    const targetDoc = {
      name: targetName,
      phone: targetPhone,
      role: "USER",
      accountStatus: "ACTIVE",
      createdAt: new Date(now - 10 * 365 * 24 * 60 * 60 * 1000), // 10 years old — sorts last
      stateRef: stateAdmin.stateRef,
    };

    const createdFillers = await User.insertMany(fillerDocs, { ordered: false });
    fixtureUserIds.push(...createdFillers.map((d) => d._id));
    const [createdTarget] = await User.insertMany([targetDoc]);
    fixtureUserIds.push(createdTarget._id);

    const afterSeedCustomers = await User.countDocuments({ role: "USER", isDeleted: { $ne: true } });
    check("Setup: disposable fixtures created (105 filler + 1 target)", afterSeedCustomers === beforeCustomers + 106, { beforeCustomers, afterSeedCustomers });

    // ═══ A. PAGINATION — BASIC ════════════════════════════════════
    let r = await authFetch(`/api/admin/users?role=USER&page=1&limit=20`, indiaToken);
    check("A1. First page -> 200, 20 rows, page=1", r.status === 200 && r.data?.data?.length === 20 && r.data?.pagination?.page === 1, r.data?.pagination);
    const page1Ids = new Set((r.data?.data || []).map((u) => u.id));

    r = await authFetch(`/api/admin/users?role=USER&page=2&limit=20`, indiaToken);
    check("A2. Second page -> 200, 20 rows, page=2, no overlap with page 1", r.status === 200 && r.data?.data?.length === 20 && r.data?.pagination?.page === 2 && !(r.data.data.some((u) => page1Ids.has(u.id))), { status: r.status, len: r.data?.data?.length });

    const totalPages = r.data?.pagination?.totalPages;
    r = await authFetch(`/api/admin/users?role=USER&page=${totalPages}&limit=20`, indiaToken);
    check("A3. Last page -> 200, non-empty, <= 20 rows", r.status === 200 && r.data?.data?.length > 0 && r.data.data.length <= 20, { page: totalPages, len: r.data?.data?.length });

    r = await authFetch(`/api/admin/users?role=USER&page=${totalPages + 50}&limit=20`, indiaToken);
    check("A4. Way-beyond-last page -> 200, empty rows (not an error)", r.status === 200 && Array.isArray(r.data?.data) && r.data.data.length === 0, { len: r.data?.data?.length });

    // ═══ B. THE CRITICAL TEST — customer beyond the old 100-row window ═══
    r = await authFetch(`/api/admin/users?role=USER&page=1&limit=20`, indiaToken);
    const targetOnPage1Unfiltered = (r.data?.data || []).some((u) => u.id === String(createdTarget._id));
    check("B1. Target is NOT on page 1 of the plain (unsearched) list — confirms it is genuinely beyond the old 100-row window", targetOnPage1Unfiltered === false, {});

    r = await authFetch(`/api/admin/users?role=USER&search=${encodeURIComponent("TARGET_RAHUL")}&page=1&limit=20`, indiaToken);
    const foundByNameSearch = (r.data?.data || []).some((u) => u.id === String(createdTarget._id));
    check("B2. *** CRITICAL *** Search by (partial) name finds the target beyond the old 100-row window", r.status === 200 && foundByNameSearch === true, { status: r.status, count: r.data?.data?.length });

    r = await authFetch(`/api/admin/users?role=USER&search=${encodeURIComponent(targetPhone)}&page=1&limit=20`, indiaToken);
    const foundByPhoneSearch = (r.data?.data || []).some((u) => u.id === String(createdTarget._id));
    check("B3. Search by phone finds the target beyond the old 100-row window", r.status === 200 && foundByPhoneSearch === true, {});

    r = await authFetch(`/api/admin/users?role=USER&search=${encodeURIComponent("ZTEST_CUST01_NO_SUCH_CUSTOMER_XYZ")}&page=1&limit=20`, indiaToken);
    check("B4. Search with no matches -> 200, empty, not an error", r.status === 200 && Array.isArray(r.data?.data) && r.data.data.length === 0, {});

    // ═══ C. COUNT ACCURACY ════════════════════════════════════════
    const directCount = await User.countDocuments({ role: "USER", isDeleted: { $ne: true } });
    r = await authFetch(`/api/admin/users?role=USER&page=1&limit=20`, indiaToken);
    check("C1. pagination.total matches a direct countDocuments (INDIA, unrestricted)", r.data?.pagination?.total === directCount, { apiTotal: r.data?.pagination?.total, directCount });

    // ═══ D. RBAC / SCOPE ══════════════════════════════════════════
    const directScopedCount = await User.countDocuments({ role: "USER", isDeleted: { $ne: true }, stateRef: stateAdmin.stateRef });
    r = await authFetch(`/api/admin/users?role=USER&page=1&limit=20`, stateToken);
    check("D1. STATE admin sees a scoped total matching own-state countDocuments (not PAN-India)", r.status === 200 && r.data?.pagination?.total === directScopedCount, { apiTotal: r.data?.pagination?.total, directScopedCount });
    check("D1b. STATE admin's scoped total is strictly less than the unrestricted INDIA total (real scoping is active, not a no-op)", directScopedCount < directCount, { directScopedCount, directCount });

    r = await authFetch(`/api/admin/users?role=USER&search=${encodeURIComponent("TARGET_RAHUL")}&page=1&limit=20`, stateToken);
    const foundByStateAdmin = (r.data?.data || []).some((u) => u.id === String(createdTarget._id));
    check("D2. STATE admin (same state as fixtures) can still find the target via search", r.status === 200 && foundByStateAdmin === true, {});

    r = await authFetch(`/api/admin/users?role=USER&page=1&limit=20`, districtToken);
    check("D3. DISTRICT admin read access still works (read-only list endpoint allows DISTRICT)", r.status === 200, { status: r.status });

    // ═══ E. CUSTOMER DETAIL / SUMMARY REGRESSION ═════════════════
    r = await authFetch(`/api/admin/users/${createdTarget._id}/summary`, indiaToken);
    check("E1. Customer summary endpoint still loads for a customer found via the new search path", r.status === 200 && String(r.data?.data?.customerId) === String(createdTarget._id), { status: r.status });

    r = await authFetch(`/api/admin/users/${createdTarget._id}`, indiaToken);
    check("E2. Customer detail endpoint still loads", r.status === 200, { status: r.status });

    // ═══ F. ANALYTICS — Total Customers KPI source untouched ═════
    r = await authFetch(`/api/admin/users/summary`, indiaToken);
    const summaryByRoleUsers = r.data?.data?.byRole?.users;
    check("F1. GET /admin/users/summary still returns an exact byRole.users count (Analytics KPI source, unmodified)", r.status === 200 && typeof summaryByRoleUsers === "number" && summaryByRoleUsers === directCount, { summaryByRoleUsers, directCount });

  } finally {
    // ═══ CLEANUP — exact IDs only ═══════════════════════════════════
    const delRes = await User.deleteMany({ _id: { $in: fixtureUserIds } });
    server.close();
    results.push(`Cleanup: deleted ${delRes.deletedCount} of ${fixtureUserIds.length} tracked disposable fixtures`);
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\nCUSTOMERS SERVER-SIDE PAGINATION FIX: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
