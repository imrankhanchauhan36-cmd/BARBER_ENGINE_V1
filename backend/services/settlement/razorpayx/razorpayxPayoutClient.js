/**
 * BARBER ENGINE V1
 * backend/services/settlement/razorpayx/razorpayxPayoutClient.js
 *
 * STEP 6.4 — Razorpay Route Settlement Engine. Thin HTTP client for
 * Razorpay's Contacts / Fund Accounts / Payouts APIs (RazorpayX Route).
 * Transport only — no Mongo, no wallet, no lifecycle. Mirrors
 * services/settlement/cashfree/cashfreePayoutClient.js's exact shape
 * and discipline (same file family, same conventions), applied to a
 * different gateway.
 *
 * CREDENTIALS: reuses RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET — the SAME
 * credentials services/Razorpay.service.js already uses for
 * orders/payments/refunds (Route lives on the same Razorpay account,
 * unlike Cashfree which needed a separate credential pair). Additionally
 * requires RAZORPAY_ROUTE_ACCOUNT_NUMBER — the RazorpayX virtual/current
 * account payouts are debited FROM (a Razorpay Route prerequisite that
 * must be configured on the dashboard; this file only reads the env var).
 *
 * ENDPOINTS (Razorpay's public Payouts API — NOTE: field names/shapes
 * below are the documented public contract at the time this was
 * written; the STEP 6.4 audit's own Risk #1 flagged this as needing
 * final confirmation against live Razorpay docs/dashboard before this
 * is ever pointed at production):
 *   POST /v1/contacts                create a contact (payee)
 *   GET  /v1/contacts?reference_id=  find an existing contact by OUR id
 *   POST /v1/fund_accounts           attach a bank account to a contact
 *   POST /v1/payouts                 create a payout (X-Payout-Idempotency header)
 *   GET  /v1/payouts/:id             fetch a payout's current status
 *   GET  /v1/payouts?reference_id=   find an existing payout by OUR id
 *   webhook signature: hex(HMAC-SHA256(rawBody, secret)), header X-Razorpay-Signature
 *     — the SAME scheme services/razorpayWebhook.service.js already
 *       verifies payment/refund events with.
 *
 * Every payout uses a deterministic reference_id AND the dedicated
 * X-Payout-Idempotency header (belt-and-suspenders — matches this
 * codebase's own idempotency discipline elsewhere), so a retried create
 * can never send money twice.
 */

import crypto from "crypto";

const TIMEOUT_MS = 20_000;
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

const isProduction = () => process.env.NODE_ENV === "production";

// RAZORPAYX_ROUTE_BASE_URL exists only so a local stub server can stand
// in for Razorpay in disposable verification scripts; ignored in
// production so it can never redirect real money — same escape hatch
// cashfreePayoutClient.js's own getPayoutBaseUrl already uses.
export const getRouteBaseUrl = () => {
  if (!isProduction() && process.env.RAZORPAYX_ROUTE_BASE_URL) return process.env.RAZORPAYX_ROUTE_BASE_URL;
  return "https://api.razorpay.com/v1";
};

export const isRazorpayRoutePayoutConfigured = () =>
  !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET && !!process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER;

const webhookSecret = () => process.env.RAZORPAY_PAYOUT_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || "";

const basicAuthHeader = () =>
  `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;

// Deterministic per GenericPayoutRequest — Razorpay reference_id: caller-chosen, unique.
export const buildPayoutReferenceId = (payoutId) => `GPR_${String(payoutId)}`;

// Deterministic per (entityType, entityId) — the SAME entity always maps
// to the SAME Razorpay contact (reuse), mirroring buildBeneficiaryId's
// own reasoning in cashfreePayoutClient.js.
export const buildContactReferenceId = ({ entityType, entityId }) => `GPRC_${entityType}_${String(entityId)}`;

/**
 * @returns {Promise<{ok:boolean, httpStatus:number|null, json:object, networkError:boolean}>}
 *   networkError:true means the request outcome is UNKNOWN (timeout /
 *   connection error) — the operation may or may not have taken effect.
 */
const call = async (method, path, body, extraHeaders = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${getRouteBaseUrl()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(),
        ...extraHeaders,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, httpStatus: res.status, json, networkError: false };
  } catch (err) {
    return { ok: false, httpStatus: null, json: { error: { description: err.name === "AbortError" ? "Razorpay Route API timeout" : `Razorpay Route API error: ${err.message}` } }, networkError: true };
  } finally {
    clearTimeout(timeout);
  }
};

export const findContactByReferenceId = (referenceId) =>
  call("GET", `/contacts?reference_id=${encodeURIComponent(referenceId)}`);

export const createContact = ({ referenceId, name, phone, email }) =>
  call("POST", "/contacts", {
    name,
    contact: phone,
    email: email || undefined,
    type: "vendor",
    reference_id: referenceId,
  });

export const createFundAccount = ({ contactId, accountHolder, accountNumber, ifsc }) =>
  call("POST", "/fund_accounts", {
    contact_id: contactId,
    account_type: "bank_account",
    bank_account: {
      name: accountHolder,
      ifsc,
      account_number: accountNumber,
    },
  });

export const findPayoutByReferenceId = (referenceId) =>
  call("GET", `/payouts?reference_id=${encodeURIComponent(referenceId)}`);

export const createPayout = ({ referenceId, fundAccountId, amountInPaise, narration }) =>
  call(
    "POST",
    "/payouts",
    {
      account_number: process.env.RAZORPAY_ROUTE_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount: amountInPaise,
      currency: "INR",
      mode: "IMPS",
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: narration || "Zemish payout",
    },
    { "X-Payout-Idempotency": referenceId }
  );

export const getPayout = (payoutId) => call("GET", `/payouts/${encodeURIComponent(payoutId)}`);

/**
 * Verifies a Razorpay Payouts webhook. `rawBody` MUST be the exact
 * bytes received — re-serialising parsed JSON changes the signature.
 * Same HMAC-SHA256-hex scheme already used for payment/refund webhooks.
 */
export const verifyWebhookSignature = ({ rawBody, signature }) => {
  const secret = webhookSecret();
  if (!secret || !signature || rawBody === undefined || rawBody === null) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody)))
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Test helper — produces a signature exactly as Razorpay would.
export const signWebhookForTest = (rawBody) =>
  crypto.createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");

// Razorpay payout entity `status` -> our provider-level outcome mapping.
export const mapPayoutState = (state) => {
  const s = String(state || "").toLowerCase();
  if (s === "processed") return "SUCCESS";
  if (s === "reversed" || s === "rejected" || s === "cancelled") return "FAILED";
  return "PENDING"; // queued / pending / processing / scheduled / unknown
};
