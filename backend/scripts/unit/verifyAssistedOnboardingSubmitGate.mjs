/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyAssistedOnboardingSubmitGate.mjs
 *
 * ZEMISH Section A — "assisted onboarding gate bypass" fix, wiring check.
 *
 * Why a SOURCE-TEXT check instead of calling the real functions:
 * fieldAgentOnboarding.service.js transitively imports services/geo.js
 * and services/slotEngine.service.js, both of which open a REAL Redis
 * connection as a module-load side effect (config/redis.js) — the exact
 * same hazard already found and worked around once before for
 * salon.onboarding.controller.js (see utils/onboardingKycGate.js's own
 * header). Importing either onboarding file here would violate the
 * "no real DB/Redis in an offline test" constraint. The gate PREDICATE
 * itself (isMandatoryOwnerKycVerified) is already exhaustively covered,
 * state-by-state, by verifyOnboardingKycGate.mjs in this same directory
 * — this file instead proves the WIRING contract: which functions call
 * that predicate and which don't, across both onboarding paths.
 *
 * Asserts, by reading the real source files on disk:
 *   1. The Field-Agent-assisted submitSalon (fieldAgentOnboarding.
 *      service.js) calls isMandatoryOwnerKycVerified — the new gate.
 *   2. UPDATED — ZEMISH expected-flow correction: the Owner self-serve
 *      submitSalon (salon.onboarding.controller.js) no longer calls
 *      it. This gate was deliberately removed so Owner submission
 *      never requires KYC first — KYC is now enforced at Admin
 *      approval (item 3) instead, not at this transition.
 *   3. UPDATED — ZEMISH "Admin approval blocked by KYC" fix: Admin's own
 *      final PENDING→APPROVED/REJECTED decision (admin.controller.js's
 *      updateSalonStatus) no longer calls it either. Admin can approve
 *      a salon while the owner's KYC is still pending — KYC is enforced
 *      post-approval (booking-readiness, see
 *      verifySalonReadyKycGuard.mjs), not at the approval decision.
 *   4. Every Field-Agent CREATION/step-write function (saveBasicInfo,
 *      saveLocation, saveServices, saveChairs, saveTimings, saveStaff,
 *      savePhotos) does NOT call it — a Field Agent must still be able
 *      to start and fill in a draft for a brand-new owner, unblocked.
 *   5. assistedOnboarding.service.js's own draft-creation
 *      findOneAndUpdate (the one that sets approval.status:"DRAFT" for
 *      a fresh Salon) does NOT call it either — creating the
 *      application itself stays ungated, per the explicit instruction
 *      not to hard-block assisted onboarding from starting.
 *   6. ZEMISH Partner Registration restore pass — the Owner self-serve
 *      saveBasicInfo (salon.onboarding.controller.js) ALSO no longer
 *      calls it — that creation-time gate was deliberately removed so
 *      an owner can save basic info and continue onboarding before
 *      PAN+Bank is verified. Combined with items 2 and 3 above, the
 *      ENTIRE Owner path (create → fill in → submit → Admin approval)
 *      is now KYC-ungated end to end; enforcement moved from "can this
 *      transition happen" to "can this salon be discovered/booked"
 *      (business.isKycVerifiedForDiscovery, see
 *      verifySalonReadyKycGuard.mjs) — the Field-Agent-assisted
 *      submitSalon port (item 1) remains the one submit/approval-time
 *      gate still standing, and only for that path.
 *   7. ZEMISH "submit blocked by KYC" bug fix — proves removing ONLY the
 *      KYC gate from the Owner's submitSalon left every OTHER mandatory
 *      check (auth, status, step, data completeness) present and in
 *      their original relative order, and that the atomic DRAFT→PENDING
 *      update is still reached. This is the regression guard for "fix
 *      the KYC gate without weakening or reordering anything else."
 *
 * Run:  cd backend && node scripts/unit/verifyAssistedOnboardingSubmitGate.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const read = (rel) => readFileSync(path.join(backendRoot, rel), "utf8");

// Extracts the body of `export const <name> = ... => { ... };` by
// bracket-matching from the first `{` after the declaration — good
// enough for these specific, well-formed function declarations, not a
// general-purpose JS parser.
const extractFunctionBody = (source, exportName) => {
  const anchor = `export const ${exportName} =`;
  const start = source.indexOf(anchor);
  if (start === -1) return null;
  // Skip past the arrow first — the `{` of a destructured param list
  // (e.g. `async ({ salonId }) =>`) balances to zero on its own and
  // would otherwise be mistaken for the function body's opening brace.
  const arrowIdx = source.indexOf("=>", start);
  if (arrowIdx === -1) return null;
  const braceStart = source.indexOf("{", arrowIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
};

const run = () => {
  const fieldAgentSrc = read("modules/fieldAgent/services/fieldAgentOnboarding.service.js");
  const ownerSrc = read("controllers/salon.onboarding.controller.js");
  const assistedSrc = read("modules/fieldAgent/services/assistedOnboarding.service.js");
  const adminSrc = read("controllers/admin.controller.js");

  // ── 1. Both submit transitions call the shared gate ──
  const faSubmitBody = extractFunctionBody(fieldAgentSrc, "submitSalon");
  check("fieldAgentOnboarding.service.js submitSalon exists and was read", !!faSubmitBody);
  check("fieldAgentOnboarding.service.js submitSalon calls isMandatoryOwnerKycVerified", !!faSubmitBody && faSubmitBody.includes("isMandatoryOwnerKycVerified("));
  check("fieldAgentOnboarding.service.js submitSalon selects ownerId off the resolved Salon (never trusts req.user)", !!faSubmitBody && /ownerId:\s*salon\.ownerId/.test(faSubmitBody));

  const ownerSubmitBody = extractFunctionBody(ownerSrc, "submitSalon");
  check("salon.onboarding.controller.js submitSalon exists and was read", !!ownerSubmitBody);
  // ZEMISH expected-flow correction — the Owner submit-time gate was
  // deliberately removed so submission no longer requires KYC first;
  // KYC is now enforced later (Admin approval / post-approval choice),
  // not at this transition. Field-Agent's own submitSalon port (next
  // assertion) and Admin's final approval gate (assertion further
  // below) are both unchanged and still enforce it.
  check("salon.onboarding.controller.js submitSalon no longer calls isMandatoryOwnerKycVerified (Owner submit-time gate removed by design)", !!ownerSubmitBody && !ownerSubmitBody.includes("isMandatoryOwnerKycVerified("));

  // ── 1d. Removing ONLY the KYC gate must not have disturbed the other
  // mandatory validations in submitSalon, or their relative order: AUTH
  // → GET SALON → STATUS CHECK → STEP CHECK → DATA COMPLETENESS CHECK →
  // ATOMIC UPDATE must all still be present and in that same sequence. ──
  check(
    "submitSalon still requires authentication (ownerId / req.user._id check)",
    !!ownerSubmitBody && /Authentication required/.test(ownerSubmitBody)
  );
  check(
    "submitSalon still rejects a salon that is not DRAFT or APPROVED (status check intact)",
    !!ownerSubmitBody && /\[\s*"DRAFT"\s*,\s*"APPROVED"\s*\]\.includes\(\s*salon\.approval\?\.status\s*\)/.test(ownerSubmitBody)
  );
  check(
    "submitSalon still rejects onboarding.step < 7 (step check intact)",
    !!ownerSubmitBody && /salon\.onboarding\?\.step\s*<\s*7/.test(ownerSubmitBody)
  );
  check(
    "submitSalon still requires services/staff/media/chairs counts > 0 (data completeness check intact)",
    !!ownerSubmitBody && /servicesCount\s*===\s*0\s*\|\|\s*staffCount\s*===\s*0\s*\|\|\s*mediaCount\s*===\s*0\s*\|\|\s*chairsCount\s*===\s*0/.test(ownerSubmitBody)
  );
  check(
    "submitSalon still performs the atomic DRAFT→PENDING findOneAndUpdate (no double-submit)",
    !!ownerSubmitBody && /Salon\.findOneAndUpdate/.test(ownerSubmitBody)
  );
  {
    const authIdx = ownerSubmitBody.indexOf("Authentication required");
    const statusIdx = ownerSubmitBody.indexOf('"Already submitted or not editable"');
    const stepIdx = ownerSubmitBody.indexOf('"Complete all steps before submit"');
    const completenessIdx = ownerSubmitBody.indexOf("servicesCount");
    const updateIdx = ownerSubmitBody.indexOf("Salon.findOneAndUpdate");
    check(
      "submitSalon's checks remain in their original relative order: AUTH < STATUS < STEP < COMPLETENESS < ATOMIC UPDATE",
      [authIdx, statusIdx, stepIdx, completenessIdx, updateIdx].every((v) => v !== -1) &&
        authIdx < statusIdx && statusIdx < stepIdx && stepIdx < completenessIdx && completenessIdx < updateIdx
    );
  }

  // ── 1c. ZEMISH Partner Registration restore pass — saveBasicInfo's
  // own creation-time gate was deliberately removed (it used to block
  // an owner from even saving basic info without PAN+Bank already
  // verified); submitSalon above is now the real, primary enforcement
  // for the self-serve Owner path. ──
  const ownerSaveBasicInfoBody = extractFunctionBody(ownerSrc, "saveBasicInfo");
  check("salon.onboarding.controller.js saveBasicInfo exists and was read", !!ownerSaveBasicInfoBody);
  check("salon.onboarding.controller.js saveBasicInfo no longer calls isMandatoryOwnerKycVerified (creation-time gate removed)", !!ownerSaveBasicInfoBody && !ownerSaveBasicInfoBody.includes("isMandatoryOwnerKycVerified("));

  // ── 1b. ZEMISH "Admin approval blocked by KYC" fix — Admin's final
  // PENDING→APPROVED/REJECTED decision no longer requires KYC first;
  // enforcement moved to booking-readiness (verifySalonReadyKycGuard.
  // mjs) instead of blocking the approval transition itself. ──
  const adminStatusBody = extractFunctionBody(adminSrc, "updateSalonStatus");
  check("admin.controller.js updateSalonStatus exists and was read", !!adminStatusBody);
  check("admin.controller.js updateSalonStatus no longer calls isMandatoryOwnerKycVerified (approval-time KYC gate removed by design)", !!adminStatusBody && !adminStatusBody.includes("isMandatoryOwnerKycVerified("));
  check(
    "admin.controller.js's legitimate approval safeguards remain present: admin-level check, allowed-status check, scope check, PENDING-only state-machine guard, rejection-reason validation, and the atomic conditional findOneAndUpdate",
    !!adminStatusBody &&
      /adminLevel/.test(adminStatusBody) &&
      /allowedStatuses/.test(adminStatusBody) &&
      /Not allowed to approve this salon/.test(adminStatusBody) &&
      /Only a PENDING salon can be approved or rejected/.test(adminStatusBody) &&
      /Rejection reason is required/.test(adminStatusBody) &&
      /Salon\.findOneAndUpdate/.test(adminStatusBody) &&
      /"approval\.status":\s*"PENDING"/.test(adminStatusBody)
  );

  // ── 2. Every Field-Agent creation/step-write function stays ungated ──
  const stepWriteFns = ["saveBasicInfo", "saveLocation", "saveServices", "saveChairs", "saveTimings", "saveStaff", "savePhotos"];
  for (const fn of stepWriteFns) {
    const body = extractFunctionBody(fieldAgentSrc, fn);
    check(`fieldAgentOnboarding.service.js ${fn} exists and was read`, !!body);
    check(`fieldAgentOnboarding.service.js ${fn} does NOT call the KYC gate (creation/step-write stays unblocked)`, !!body && !body.includes("isMandatoryOwnerKycVerified("));
  }

  // ── 3. Draft/application creation itself stays ungated ──
  check(
    "assistedOnboarding.service.js does not call the KYC gate anywhere (draft/application creation is never blocked)",
    !assistedSrc.includes("isMandatoryOwnerKycVerified(")
  );
  check(
    "assistedOnboarding.service.js's Salon-creation findOneAndUpdate (fresh ObjectId, approval.status:DRAFT) is still present and unmodified",
    /\$set:\s*\{\s*ownerId,\s*"onboarding\.step":\s*0,\s*"onboarding\.completed":\s*false,\s*"approval\.status":\s*"DRAFT"\s*\}/.test(assistedSrc)
  );

  console.log(rows.join("\n"));
  console.log(`\nASSISTED ONBOARDING SUBMIT GATE WIRING: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
