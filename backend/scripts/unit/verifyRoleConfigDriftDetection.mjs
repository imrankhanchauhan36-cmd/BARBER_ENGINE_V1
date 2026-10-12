/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyRoleConfigDriftDetection.mjs
 *
 * Phase 2 — Global Verification Engine. Pure unit check, NO database,
 * NO HTTP, NO provider call. Confirms:
 *   (a) roleConfig.js's OWNER/FIELD_AGENT entries are byte-for-byte
 *       consistent with the LIVE constants in kyc.constants.js (not
 *       just consistent with themselves) — this is possible to assert
 *       with full confidence for the document-key-map-derived fields
 *       because roleConfig.js imports those constants directly rather
 *       than copying them (see roleConfig.js's file header, point 1).
 *   (b) the one manually-synced field (mandatoryAutoVerifyFields, for
 *       FIELD_AGENT) currently matches what fieldAgentKyc.service.js's
 *       private MANDATORY_AUTO_VERIFY_FIELDS constant is documented to
 *       contain today (["pan","aadhaar","bank","face","liveness"]) —
 *       this check CANNOT import that private constant (it is not
 *       exported) and so cannot detect a FUTURE change to it; it only
 *       proves today's value is correctly mirrored. This limitation is
 *       intentional and documented, not a bug in this test.
 *   (c) getRoleConfig() fails closed for an unknown role.
 *   (d) OWNER has autoApprovalEligible === false and
 *       mandatoryAutoVerifyFields === null (no auto-approval surface
 *       exists for Owner, consistent with the audit's findings).
 *
 * Run:  cd backend && node scripts/unit/verifyRoleConfigDriftDetection.mjs
 */

import {
    APPLICANT_TYPE,
    FIELD_AGENT_DOCUMENT_KEY_MAP,
    FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS,
    FIELD_AGENT_REQUIRED_DOCUMENT_KEYS,
    OPTIONAL_DOCUMENT_KEYS,
    OWNER_DOCUMENT_KEY_MAP,
    REQUIRED_DOCUMENT_KEYS,
} from "../../modules/kyc/constants/kyc.constants.js";
import { ROLE_CONFIG, getRoleConfig } from "../../modules/kyc/engine/roleConfig.js";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const run = () => {
  const owner = getRoleConfig(APPLICANT_TYPE.OWNER);
  const fieldAgent = getRoleConfig(APPLICANT_TYPE.FIELD_AGENT);

  // ── OWNER — must be the exact same object references as the live
  // constants (not a copy), proving structural (not just value) sync ──
  check("OWNER.documentKeyMap === live OWNER_DOCUMENT_KEY_MAP (same reference)", owner.documentKeyMap === OWNER_DOCUMENT_KEY_MAP);
  check("OWNER.requiredDocumentKeys === live REQUIRED_DOCUMENT_KEYS (same reference)", owner.requiredDocumentKeys === REQUIRED_DOCUMENT_KEYS);
  check("OWNER.optionalDocumentKeys === live OPTIONAL_DOCUMENT_KEYS (same reference)", owner.optionalDocumentKeys === OPTIONAL_DOCUMENT_KEYS);
  check("OWNER.autoApprovalEligible is false", owner.autoApprovalEligible === false);
  check("OWNER.mandatoryAutoVerifyFields is null", owner.mandatoryAutoVerifyFields === null);

  // ── FIELD_AGENT — same reference checks ──
  check("FIELD_AGENT.documentKeyMap === live FIELD_AGENT_DOCUMENT_KEY_MAP (same reference)", fieldAgent.documentKeyMap === FIELD_AGENT_DOCUMENT_KEY_MAP);
  check("FIELD_AGENT.requiredDocumentKeys === live FIELD_AGENT_REQUIRED_DOCUMENT_KEYS (same reference)", fieldAgent.requiredDocumentKeys === FIELD_AGENT_REQUIRED_DOCUMENT_KEYS);
  check("FIELD_AGENT.optionalDocumentKeys === live FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS (same reference)", fieldAgent.optionalDocumentKeys === FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS);
  check("FIELD_AGENT.autoApprovalEligible is true", fieldAgent.autoApprovalEligible === true);

  // ── GST stays optional for Field Agent — explicit regression check
  // for constraint 6/7 ("preserve role-specific document requirements,
  // do not make GST mandatory where policy says optional"). GST is not
  // even a FIELD_AGENT_DOCUMENT_KEY_MAP key (no certificate upload for
  // Field Agent), which this asserts directly. ──
  check("GST is not a required document key for FIELD_AGENT", !fieldAgent.requiredDocumentKeys.includes("gstCertificate") && !("gstCertificate" in fieldAgent.documentKeyMap));
  check("gstCertificate stays optional for OWNER (unchanged)", owner.optionalDocumentKeys.includes("gstCertificate"));

  // ── Manually-synced field — point-in-time value check (see header) ──
  const EXPECTED_MANDATORY_FIELDS = ["pan", "aadhaar", "bank", "face", "liveness"];
  check(
    "FIELD_AGENT.mandatoryAutoVerifyFields matches fieldAgentKyc.service.js's documented private constant (point-in-time check only)",
    deepEqual(fieldAgent.mandatoryAutoVerifyFields, EXPECTED_MANDATORY_FIELDS),
    fieldAgent.mandatoryAutoVerifyFields
  );
  check("FIELD_AGENT.mandatoryAutoVerifyFields excludes GST (optional, never gates auto-approval)", !fieldAgent.mandatoryAutoVerifyFields.includes("gst"));

  // ── Fail-closed on unknown role ──
  let threw = false;
  try { getRoleConfig("SOME_FUTURE_ROLE"); } catch { threw = true; }
  check("getRoleConfig throws for an unknown applicantType (fails closed)", threw);

  // ── ROLE_CONFIG has exactly the two roles that exist today — not more, not fewer ──
  check("ROLE_CONFIG has exactly OWNER and FIELD_AGENT keys", deepEqual(Object.keys(ROLE_CONFIG).sort(), [APPLICANT_TYPE.FIELD_AGENT, APPLICANT_TYPE.OWNER].sort()));

  console.log(rows.join("\n"));
  console.log(`\nROLE CONFIG DRIFT DETECTION: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
