/**
 * BARBER ENGINE V1
 * backend/modules/kyc/engine/roleConfig.js
 * Global Verification Engine — Phase 2 (approved, additive, read-only mirror)
 *
 * PURPOSE: a single, role-keyed view of "what does this applicant
 * type need," derived from the EXISTING, already-approved constants in
 * modules/kyc/constants/kyc.constants.js. This file does not change,
 * override, or re-decide any business rule — it only re-shapes rules
 * that already exist elsewhere so a future orchestrator can read them
 * in one place instead of importing five separate constants at every
 * call site.
 *
 * DRIFT SAFETY — two different guarantees, stated honestly:
 *
 *   1. Document-key maps and their derived required/optional lists
 *      (OWNER_DOCUMENT_KEY_MAP, FIELD_AGENT_DOCUMENT_KEY_MAP,
 *      REQUIRED_DOCUMENT_KEYS, FIELD_AGENT_REQUIRED_DOCUMENT_KEYS) are
 *      imported and referenced DIRECTLY below, never copied as a
 *      literal. Structural drift is therefore impossible by
 *      construction — if kyc.constants.js changes, this file's
 *      exported shape changes with it automatically, with no edit
 *      needed here.
 *
 *   2. MANDATORY_AUTO_VERIFY_FIELDS is DIFFERENT: it is declared as a
 *      private, non-exported `const` inside
 *      modules/kyc/services/fieldAgentKyc.service.js (line ~252) and
 *      is NOT importable from here. That file is explicitly out of
 *      scope for this phase (not approved for modification), so this
 *      file instead carries its own, manually-synced copy of the same
 *      five field names, clearly flagged below. This copy CAN drift if
 *      fieldAgentKyc.service.js's list is ever changed without a
 *      matching edit here — the drift-detection test for this file
 *      (verifyRoleConfigDriftDetection.js) asserts the current value
 *      matches what was true at the time this file was written, but
 *      cannot detect a future change to the private constant the way
 *      it can for the exported constants above. Exporting that
 *      constant from fieldAgentKyc.service.js would close this gap
 *      permanently — flagged here as a candidate for a future,
 *      separately-approved minimal change, not done in this phase.
 *
 * This file performs no I/O, calls no provider, and is not imported by
 * any existing route, controller, or service.
 */

import {
    APPLICANT_TYPE,
    FIELD_AGENT_DOCUMENT_KEY_MAP,
    FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS,
    FIELD_AGENT_REQUIRED_DOCUMENT_KEYS,
    OPTIONAL_DOCUMENT_KEYS,
    OWNER_DOCUMENT_KEY_MAP,
    REQUIRED_DOCUMENT_KEYS,
} from "../constants/kyc.constants.js";

// ─── Manually-synced mirror of fieldAgentKyc.service.js's private
// MANDATORY_AUTO_VERIFY_FIELDS (line ~252) — see file header, point 2.
// GST is deliberately excluded here, exactly as it is in the real
// constant: GST is optional for Field Agent and never gates
// auto-approval.
const FIELD_AGENT_MANDATORY_AUTO_VERIFY_FIELDS = ["pan", "aadhaar", "bank", "face", "liveness"];

/**
 * @typedef {Object} RoleVerificationConfig
 * @property {string} applicantType
 * @property {Object<string,string>} documentKeyMap - camelCase key -> DOCUMENT_TYPE enum value
 * @property {string[]} requiredDocumentKeys
 * @property {string[]} optionalDocumentKeys
 * @property {boolean} autoApprovalEligible - whether ANY auto-approval
 *   mechanism exists for this role today. Only ever true for
 *   FIELD_AGENT — see assertAutoApprovalAllowed() in
 *   verificationOrchestrator.service.js, which enforces this as a hard
 *   guard, not just documentation.
 * @property {string[]|null} mandatoryAutoVerifyFields - null when
 *   autoApprovalEligible is false (there is nothing to mirror for a
 *   role with no auto-approval mechanism).
 */

export const ROLE_CONFIG = {
  [APPLICANT_TYPE.OWNER]: {
    applicantType: APPLICANT_TYPE.OWNER,
    documentKeyMap: OWNER_DOCUMENT_KEY_MAP,
    requiredDocumentKeys: REQUIRED_DOCUMENT_KEYS,
    optionalDocumentKeys: OPTIONAL_DOCUMENT_KEYS,
    autoApprovalEligible: false,
    mandatoryAutoVerifyFields: null,
  },
  [APPLICANT_TYPE.FIELD_AGENT]: {
    applicantType: APPLICANT_TYPE.FIELD_AGENT,
    documentKeyMap: FIELD_AGENT_DOCUMENT_KEY_MAP,
    requiredDocumentKeys: FIELD_AGENT_REQUIRED_DOCUMENT_KEYS,
    optionalDocumentKeys: FIELD_AGENT_OPTIONAL_DOCUMENT_KEYS,
    autoApprovalEligible: true,
    mandatoryAutoVerifyFields: FIELD_AGENT_MANDATORY_AUTO_VERIFY_FIELDS,
  },
};

/**
 * @param {string} applicantType - one of APPLICANT_TYPE's values
 * @returns {RoleVerificationConfig}
 * @throws if applicantType is not a known role (fails closed, never
 *   returns a guessed/default config for an unrecognized role)
 */
export const getRoleConfig = (applicantType) => {
  const config = ROLE_CONFIG[applicantType];
  if (!config) {
    throw new Error(`roleConfig: unknown applicantType "${applicantType}"`);
  }
  return config;
};
