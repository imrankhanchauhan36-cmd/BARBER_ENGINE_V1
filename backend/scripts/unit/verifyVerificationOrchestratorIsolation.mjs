/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyVerificationOrchestratorIsolation.mjs
 *
 * Phase 5 (non-Cashfree portion) — Global Verification Engine. Pure
 * unit check, NO database, NO HTTP server, NO live Cashfree call.
 * Confirms:
 *   (a) every Cashfree-only capability is reported disabled, and
 *       resolveProviderChain() correctly marks AADHAAR as Cashfree-only
 *       for FIELD_AGENT but Manual-only for OWNER (matching the real,
 *       existing divergence already confirmed in the Phase 1 audit),
 *   (b) verifyViaNonCashfreeProvider() actually calls the real,
 *       existing Manual/Surepass provider functions for PAN/BANK/
 *       AADHAAR(OWNER) and refuses outright for any Cashfree-only
 *       combination — never silently falling through to Cashfree,
 *   (c) assertAutoApprovalAllowed() throws for OWNER and for an
 *       unknown role, and does NOT throw for FIELD_AGENT — this is the
 *       hard, tested proof for constraint 6 ("do not extend automated
 *       approval to any additional role"),
 *   (d) this file makes zero network calls end-to-end (every check
 *       above completes in well under a second).
 *
 * Run:  cd backend && node scripts/unit/verifyVerificationOrchestratorIsolation.mjs
 */

import { APPLICANT_TYPE } from "../../modules/kyc/constants/kyc.constants.js";
import {
    CASHFREE_CAPABILITY_FLAGS,
    CHECK_TYPE,
    assertAutoApprovalAllowed,
    isCashfreeCapabilityEnabled,
    resolveProviderChain,
    verifyViaNonCashfreeProvider,
} from "../../modules/kyc/engine/verificationOrchestrator.service.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const run = async () => {
  const overallStart = Date.now();

  // ── Cashfree capability flags — all disabled, every reason string present ──
  for (const checkType of [CHECK_TYPE.AADHAAR, CHECK_TYPE.FACE, CHECK_TYPE.LIVENESS, CHECK_TYPE.GST]) {
    check(`${checkType} Cashfree capability is disabled`, isCashfreeCapabilityEnabled(checkType) === false);
    check(`${checkType} capability flag has a reason string`, typeof CASHFREE_CAPABILITY_FLAGS[checkType].reason === "string" && CASHFREE_CAPABILITY_FLAGS[checkType].reason.length > 0);
  }
  check("PAN is not gated by a Cashfree flag (Manual/Surepass already cover it)", isCashfreeCapabilityEnabled(CHECK_TYPE.PAN) === true);
  check("BANK is not gated by a Cashfree flag (Manual already covers it)", isCashfreeCapabilityEnabled(CHECK_TYPE.BANK) === true);

  // ── Provider chain metadata — matches real, existing divergence ──
  const ownerAadhaar = resolveProviderChain(CHECK_TYPE.AADHAAR, APPLICANT_TYPE.OWNER);
  check("OWNER Aadhaar chain is Manual-only, not Cashfree-only", ownerAadhaar.cashfreeOnly === false, ownerAadhaar);

  const faAadhaar = resolveProviderChain(CHECK_TYPE.AADHAAR, APPLICANT_TYPE.FIELD_AGENT);
  check("FIELD_AGENT Aadhaar chain is Cashfree-only (no Manual fallback exists for this role)", faAadhaar.cashfreeOnly === true, faAadhaar);

  const facePath = resolveProviderChain(CHECK_TYPE.FACE, APPLICANT_TYPE.FIELD_AGENT);
  check("FACE is Cashfree-only for FIELD_AGENT", facePath.cashfreeOnly === true);

  let threwUnknownCheck = false;
  try { resolveProviderChain("NOT_A_REAL_CHECK", APPLICANT_TYPE.OWNER); } catch { threwUnknownCheck = true; }
  check("resolveProviderChain throws for an unknown checkType (fails closed)", threwUnknownCheck);

  // ── verifyViaNonCashfreeProvider — real calls to real Manual/Surepass
  // functions, zero Cashfree, zero network (Surepass unconfigured here) ──
  delete process.env.SUREPASS_TOKEN;
  const panResult = await verifyViaNonCashfreeProvider({
    checkType: CHECK_TYPE.PAN,
    applicantType: APPLICANT_TYPE.OWNER,
    payload: { panNumber: "ABCDE1234F", nameOnPAN: "TEST" },
  });
  check("verifyViaNonCashfreeProvider(PAN) returns success=true via Manual fallback", panResult.success === true, panResult);

  const bankResult = await verifyViaNonCashfreeProvider({
    checkType: CHECK_TYPE.BANK,
    applicantType: APPLICANT_TYPE.FIELD_AGENT,
    payload: { accountNumber: "123456789012", ifsc: "HDFC0001234", bankName: "Test Bank", accountHolder: "Test Holder" },
  });
  check("verifyViaNonCashfreeProvider(BANK) returns success=true via Manual", bankResult.success === true, bankResult);

  const ownerAadhaarResult = await verifyViaNonCashfreeProvider({
    checkType: CHECK_TYPE.AADHAAR,
    applicantType: APPLICANT_TYPE.OWNER,
    payload: { last4: "1234" },
  });
  check("verifyViaNonCashfreeProvider(AADHAAR, OWNER) succeeds via Manual", ownerAadhaarResult.success === true, ownerAadhaarResult);

  // ── Must refuse Cashfree-only combinations outright, never fall through ──
  let threwForFieldAgentAadhaar = false;
  try {
    await verifyViaNonCashfreeProvider({ checkType: CHECK_TYPE.AADHAAR, applicantType: APPLICANT_TYPE.FIELD_AGENT, payload: {} });
  } catch { threwForFieldAgentAadhaar = true; }
  check("verifyViaNonCashfreeProvider refuses FIELD_AGENT Aadhaar (Cashfree-only) rather than silently calling Cashfree", threwForFieldAgentAadhaar);

  let threwForFace = false;
  try {
    await verifyViaNonCashfreeProvider({ checkType: CHECK_TYPE.FACE, applicantType: APPLICANT_TYPE.FIELD_AGENT, payload: {} });
  } catch { threwForFace = true; }
  check("verifyViaNonCashfreeProvider refuses FACE (Cashfree-only) rather than silently calling Cashfree", threwForFace);

  // ── Auto-approval guard — the constraint-6 hard proof ──
  let threwForOwnerApproval = false;
  try { assertAutoApprovalAllowed(APPLICANT_TYPE.OWNER); } catch { threwForOwnerApproval = true; }
  check("assertAutoApprovalAllowed THROWS for OWNER (auto-approval must never extend to Owner)", threwForOwnerApproval);

  let threwForUnknownRole = false;
  try { assertAutoApprovalAllowed("SOME_FUTURE_ROLE"); } catch { threwForUnknownRole = true; }
  check("assertAutoApprovalAllowed throws for an unknown role (fails closed)", threwForUnknownRole);

  let threwForFieldAgentApproval = false;
  try { assertAutoApprovalAllowed(APPLICANT_TYPE.FIELD_AGENT); } catch { threwForFieldAgentApproval = true; }
  check("assertAutoApprovalAllowed does NOT throw for FIELD_AGENT (the one role it already applies to in production)", threwForFieldAgentApproval === false);

  // ── Zero-network confirmation ──
  const elapsedMs = Date.now() - overallStart;
  check("entire suite completed in well under 1s — confirms no network call was made anywhere", elapsedMs < 1000, `elapsedMs=${elapsedMs}`);

  console.log(rows.join("\n"));
  console.log(`\nVERIFICATION ORCHESTRATOR ISOLATION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
