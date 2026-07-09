/**
 * BARBER ENGINE V1
 * backend/modules/kyc/validators/kyc.validator.js
 * KYC Validators — Phase 6A — 10/10 FROZEN
 */

// ─── Safe string helper ───────────────────────────────────
// ✅ Fix 1 + Fix 2 — never call .trim() without type check
const isStr   = (v) => typeof v === "string"
const safeStr = (v) => isStr(v) ? v.trim() : ""

// ─── Approve ─────────────────────────────────────────────
export const validateApprove = (body = {}) => {
  const errors = []
  if (body.notes !== undefined && body.notes !== null) {
    if (!isStr(body.notes)) errors.push("notes must be a string")
    else if (body.notes.length > 1000) errors.push("Notes must be under 1000 characters")
  }
  return errors
}

// ─── Reject ──────────────────────────────────────────────
export const validateReject = (body = {}) => {
  const errors = []
  if (!isStr(body.reason)) {
    errors.push("reason must be a string")
    return errors
  }
  const reason = safeStr(body.reason)
  if (!reason)              errors.push("Reason is required when rejecting KYC")
  else if (reason.length < 10)  errors.push("Reason must be at least 10 characters")
  else if (reason.length > 500) errors.push("Reason must be under 500 characters")
  return errors
}

// ─── Assign ──────────────────────────────────────────────
export const validateAssign = (body = {}) => {
  const errors = []
  if (!isStr(body.assignTo)) {
    errors.push("assignTo must be a string")
    return errors
  }
  const assignTo = safeStr(body.assignTo)
  if (!assignTo) {
    errors.push("assignTo (admin user ID) is required")
    return errors
  }
  if (!/^[0-9a-fA-F]{24}$/.test(assignTo)) {
    errors.push("assignTo must be a valid admin ID")
  }
  return errors
}

// ─── Request Reupload ────────────────────────────────────
export const validateRequestReupload = (body = {}) => {
  const errors = []

  const VALID_DOCS = [
    "panCard", "aadhaarFront", "aadhaarBack",
    "cancelledCheque", "gstCertificate", "selfie",
  ]

  // documentType check
  if (!isStr(body.documentType)) {
    errors.push("documentType must be a string")
  } else {
    const documentType = safeStr(body.documentType)
    if (!documentType)                    errors.push("documentType is required")
    else if (!VALID_DOCS.includes(documentType)) {
      errors.push(`documentType must be one of: ${VALID_DOCS.join(", ")}`)
    }
  }

  // reason check
  if (!isStr(body.reason)) {
    errors.push("reason must be a string")
  } else {
    const reason = safeStr(body.reason)
    if (!reason)             errors.push("Reason is required when requesting re-upload")
    else if (reason.length < 5) errors.push("Reason must be at least 5 characters")
  }

  return errors
}