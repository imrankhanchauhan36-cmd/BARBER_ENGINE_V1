/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyFieldAgentFE_T5_001_FormatterFix.js
 *
 * FA-16 Tier-5 P1 REMEDIATION — FE-T5-001.
 *
 * Focused regression for the paise-exact currency formatter
 * (salon-app/src/shared/utils/formatPaise.js) that replaced the
 * rounding `Math.round(paise/100)` defect in PayoutWithdrawScreen.js /
 * PayoutHistoryScreen.js / MyEarningsScreen.js.
 *
 * No RN test runner exists in salon-app (confirmed during Tier-5
 * discovery) — this reuses Tier-5's own lightweight contract-check
 * convention. The formatter is a pure function with no RN/React
 * dependency, so its exact source is loaded and evaluated directly
 * (not re-typed by hand) — this test would fail if the shipped file
 * changed in a way that broke the contract, matching the same
 * discipline as every other FA-16 verification script.
 *
 * Also proves the fix against a REAL backend response: a real
 * FieldAgentEarningLedger row with creditedAmountInPaise=990 is
 * created, fetched via the real listMyEarnings endpoint (same route
 * Tier-5 already proved the contract for), and the actual returned
 * paise value is run through the real, current formatPaiseToRupees()
 * — proving the fix end-to-end, not just as an isolated unit check.
 *
 * TESTING + TEST INFRASTRUCTURE ONLY. This file makes no backend,
 * schema, or production financial-logic change.
 *
 * Run:
 *   cd backend
 *   node scripts/e2e/verifyFieldAgentFE_T5_001_FormatterFix.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import app from "../../app.js";
import connectDB from "../../config/db.js";
import { generateAccessToken } from "../../services/token.service.js";

import User from "../../models/User.js";
import FieldAgent from "../../modules/fieldAgent/models/FieldAgent.js";
import FieldAgentApplication from "../../modules/fieldAgent/models/FieldAgentApplication.js";
import FieldAgentEarningLedger from "../../modules/fieldAgent/models/FieldAgentEarningLedger.js";

import { nextPhone, authFetch as sharedAuthFetch, requireField, NAME_PREFIX } from "./fieldAgentE2EHelpers.js";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; results.push(`✅ ${name}`); }
  else { fail++; results.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail).slice(0, 300) : ""}`); }
};

// ── Load the REAL shipped formatter source and evaluate it, rather
// than re-typing its logic — a change to the shipped implementation
// that breaks the contract will fail this test, not silently pass
// against a stale copy.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const formatterPath = path.resolve(__dirname, "../../../salon-app/src/shared/utils/formatPaise.js");
const formatterSource = fs.readFileSync(formatterPath, "utf8");
check("Setup: formatPaise.js exists at the expected shared/utils path", formatterSource.length > 0);

// The module uses `export const` (ESM) — evaluate it in a CommonJS-safe
// sandbox by stripping the single `export` keyword, since this script
// runs under Node ESM but has no bundler to import a sibling RN
// package's source directly.
// eslint-disable-next-line no-new-func
const formatPaiseToRupees = new Function(
  `${formatterSource.replace("export const formatPaiseToRupees", "const formatPaiseToRupees")}\nreturn formatPaiseToRupees;`
)();

const createdIds = { users: [], fieldAgents: [], applications: [], earnings: [] };

const run = async () => {
  // ═══════════════════════════════════════════════════════════
  // PART 1 — PURE UNIT MATRIX (Part 2/7 of the remediation spec)
  // ═══════════════════════════════════════════════════════════
  const matrix = [
    [0, "₹0.00"], [1, "₹0.01"], [10, "₹0.10"], [99, "₹0.99"],
    [100, "₹1.00"], [101, "₹1.01"], [990, "₹9.90"], [9999, "₹99.99"],
    [10000, "₹100.00"], [10001, "₹100.01"],
    [123456, "₹1,234.56"], [1000000, "₹10,000.00"],
  ];
  for (const [paise, expected] of matrix) {
    check(`formatPaiseToRupees(${paise}) === "${expected}"`, formatPaiseToRupees(paise) === expected, formatPaiseToRupees(paise));
  }

  // Regression proof against the ORIGINAL finding's exact reported
  // before/after (Part 8).
  check('REGRESSION: 990 paise no longer renders "₹10" (the original defect)', formatPaiseToRupees(990) !== "₹10");
  check('REGRESSION: 990 paise now renders exactly "₹9.90"', formatPaiseToRupees(990) === "₹9.90");
  check('REGRESSION: 9999 paise no longer renders "₹100"', formatPaiseToRupees(9999) !== "₹100");
  check('REGRESSION: 10001 paise no longer renders "₹100"', formatPaiseToRupees(10001) !== "₹100");

  // ═══════════════════════════════════════════════════════════
  // PART 2 — INPUT SAFETY (Part 4 of the remediation spec)
  // ═══════════════════════════════════════════════════════════
  check("undefined -> \"₹0.00\" (never crashes, never silently mis-displays)", formatPaiseToRupees(undefined) === "₹0.00");
  check("null -> \"₹0.00\"", formatPaiseToRupees(null) === "₹0.00");
  check("NaN -> \"₹0.00\"", formatPaiseToRupees(NaN) === "₹0.00");
  check('non-numeric string "abc" -> "₹0.00"', formatPaiseToRupees("abc") === "₹0.00");
  check("0 remains \"₹0.00\" (zero is not treated as missing)", formatPaiseToRupees(0) === "₹0.00");
  check("negative value preserves sign and exact paise: -990 -> \"-₹9.90\"", formatPaiseToRupees(-990) === "-₹9.90");

  // ═══════════════════════════════════════════════════════════
  // PART 3 — REAL BACKEND INTEGRATION (Part 6/8 of the remediation
  // spec): a real ledger row's real paise value, fetched over real
  // HTTP via the same route Tier-5 already proved, run through the
  // real shipped formatter.
  // ═══════════════════════════════════════════════════════════
  await connectDB();
  const server = app.listen(0);
  const { port } = server.address();
  const url = (p) => `http://127.0.0.1:${port}${p}`;
  const authFetch = (p, token, opts) => sharedAuthFetch(url, p, token, opts);

  try {
    const phone = nextPhone("9");
    const agentUser = await User.create({ name: `${NAME_PREFIX}FET5001`, phone, role: "FIELD_AGENT", accountStatus: "ACTIVE" });
    createdIds.users.push(agentUser._id);
    const application = await FieldAgentApplication.create({ userRef: agentUser._id, phone, status: "APPROVED", nonTerminal: false });
    createdIds.applications.push(application._id);
    const fieldAgent = await FieldAgent.create({ userRef: agentUser._id, applicationRef: application._id, agentCode: `${NAME_PREFIX}FET5001-${Date.now()}`, operationalStatus: "ACTIVE", commercialPath: "ACQUISITION_AGENT" });
    createdIds.fieldAgents.push(fieldAgent._id);
    const token = generateAccessToken({ _id: agentUser._id, role: "FIELD_AGENT", tokenVersion: 0 });

    const earningDoc = await FieldAgentEarningLedger.create({
      bookingRef: new mongoose.Types.ObjectId(),
      entitlementType: "ACQUISITION",
      idempotencyKey: `${NAME_PREFIX}FET5001LEDGER_${new mongoose.Types.ObjectId()}`,
      fieldAgentRef: fieldAgent._id,
      policySource: "NATIONAL",
      policyVersionRef: new mongoose.Types.ObjectId(),
      appliedRatePercent: 33,
      bookingCommissionAmountInPaise: 3000,
      rawEligibleAmountInPaise: 990,
      creditedAmountInPaise: 990,
      creditOutcome: "CREDITED",
      bookingCompletedAt: new Date(),
    });
    createdIds.earnings.push(earningDoc._id);

    const listRes = await authFetch("/api/field-agent/earnings/mine", token, { method: "GET" });
    check("[REAL API] listMyEarnings -> 200 (backend contract untouched by this fix)", listRes.status === 200, listRes);
    const row = listRes.data?.data?.earnings?.find((e) => String(e.id) === String(earningDoc._id));
    check("real ledger row round-trips with creditedAmountInPaise=990 intact (backend unchanged)", row?.creditedAmountInPaise === 990, row);

    if (row) {
      const displayed = formatPaiseToRupees(row.creditedAmountInPaise);
      check('END-TO-END: real backend creditedAmountInPaise=990 now displays exactly "₹9.90" via the fixed shared formatter', displayed === "₹9.90", displayed);
    }
  } finally {
    const safeDelete = async (label, fn) => { try { await fn(); } catch (err) { check(`Cleanup step: ${label}`, false, String(err)); } };
    // FieldAgentEarningLedger rows are immutable at the Mongoose layer —
    // same raw-driver bypass established in prior FA-16 tiers.
    await safeDelete("FieldAgentEarningLedger", () => FieldAgentEarningLedger.collection.deleteMany({ _id: { $in: createdIds.earnings } }));
    await safeDelete("FieldAgent", () => FieldAgent.deleteMany({ _id: { $in: createdIds.fieldAgents } }));
    await safeDelete("FieldAgentApplication", () => FieldAgentApplication.deleteMany({ _id: { $in: createdIds.applications } }));
    await safeDelete("User", () => User.deleteMany({ _id: { $in: createdIds.users } }));

    const residue = {
      users: await User.countDocuments({ _id: { $in: createdIds.users } }),
      fieldAgents: await FieldAgent.countDocuments({ _id: { $in: createdIds.fieldAgents } }),
      applications: await FieldAgentApplication.countDocuments({ _id: { $in: createdIds.applications } }),
      earnings: await FieldAgentEarningLedger.countDocuments({ _id: { $in: createdIds.earnings } }),
    };
    check("Cleanup: zero residue across all FE-T5-001 fixtures", Object.values(residue).every((n) => n === 0), residue);

    server.close();
    await mongoose.disconnect();
  }

  console.log("\n" + results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
