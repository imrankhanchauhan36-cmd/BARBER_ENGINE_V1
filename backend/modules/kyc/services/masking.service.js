/**
 * BARBER ENGINE V1
 * backend/modules/kyc/services/masking.service.js
 * PII Masking Service — Phase 6B
 *
 * v1.1 — Added maskGST() for consistency with the other mask* helpers
 * (was previously inlined in ownerKyc.service.js). No existing function
 * changed.
 */

export const maskPAN = (pan) => {
  if (!pan || pan.length !== 10) return null;
  return pan.slice(0,5) + '****' + pan.slice(-1);
};

export const maskAadhaar = (aadhaar) => {
  if (!aadhaar) return null;
  const digits = aadhaar.replace(/\D/g, '');
  if (digits.length !== 12) return null;
  return 'XXXX-XXXX-' + digits.slice(-4);
};

export const maskAccount = (account) => {
  if (!account) return null;
  const digits = account.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return 'XXXX' + digits.slice(-4);
};

export const maskIFSC = (ifsc) => {
  if (!ifsc || ifsc.length < 4) return null;
  return ifsc.slice(0,4) + '0XXXXXX';
};

// ─── NEW (v1.1) ────────────────────────────────────────────
// GST number format: 22ABCDE1234F1Z5 (15 chars) — state code(2) +
// PAN(10) + entity code(1) + 'Z'(1) + checksum(1). We mask everything
// except the leading state code and trailing checksum, same convention
// as the other mask* helpers (show just enough to identify, hide the
// rest).
export const maskGST = (gst) => {
  if (!gst || gst.length !== 15) return null;
  return gst.slice(0, 2) + '*'.repeat(11) + gst.slice(-2);
};