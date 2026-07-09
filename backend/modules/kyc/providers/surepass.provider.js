/**
 * BARBER ENGINE V1
 * backend/modules/kyc/providers/surepass.provider.js
 * Surepass API Provider — Phase 6B (Stub — activate with API key)
 * Docs: https://surepass.io/pan-verification-api/
 */

import { VERIFICATION_SOURCE, VERIFICATION_STATUS } from "../constants/kyc.constants.js";

const SUREPASS_BASE = "https://kyc-api.surepass.io/api/v1";

/**
 * Verify PAN via Surepass API
 * Requires: SUREPASS_TOKEN in .env
 */
export const verifyPANSurepass = async ({ panNumber }) => {
  const token = process.env.SUREPASS_TOKEN;

  if (!token) {
    return {
      success: false,
      source:  VERIFICATION_SOURCE.SUREPASS,
      status:  VERIFICATION_STATUS.FAILED,
      remarks: "Surepass API token not configured — use manual verification",
      data:    null,
    };
  }

  // ✅ Fix 1 — 20 second timeout
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch(`${SUREPASS_BASE}/pan`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body:   JSON.stringify({ id_number: panNumber }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const json = await res.json();

    if (!res.ok || !json.success) {
      return {
        success:     false,
        source:      VERIFICATION_SOURCE.SUREPASS,
        status:      VERIFICATION_STATUS.FAILED,
        remarks:     json.message || "PAN verification failed",
        providerRef: json.request_id ?? null,
        data:        null,
      };
    }

    // ✅ Fix 2 — safe data access
    const d = json.data ?? {};
    return {
      success: true,
      source:  VERIFICATION_SOURCE.SUREPASS,
      status:  VERIFICATION_STATUS.VERIFIED,
      remarks: "PAN verified via Surepass",
      providerRef: json.request_id ?? null,
      data: {
        panNumber,
        nameOnPAN:   d.full_name   ?? null,
        panType:     d.pan_type    ?? null,
        aadhaarLinked: d.aadhaar_seeding_status === "Y",
        verifiedAt:  new Date(),
      },
    };
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === "AbortError";
    return {
      success: false,
      source:  VERIFICATION_SOURCE.SUREPASS,
      status:  VERIFICATION_STATUS.FAILED,
      remarks: isTimeout ? "Surepass API timeout (20s)" : `Surepass API error: ${err.message}`,
      data:    null,
    };
  }
};