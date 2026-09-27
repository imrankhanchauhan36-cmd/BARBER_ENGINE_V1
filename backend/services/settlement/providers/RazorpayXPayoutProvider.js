/**
 * BARBER ENGINE V1
 * backend/services/settlement/providers/RazorpayXPayoutProvider.js
 *
 * STEP 6.4 — Razorpay Route Settlement Engine. Implements the SAME,
 * UNMODIFIED PayoutProvider contract (services/settlement/PayoutProvider.js)
 * CashfreePayoutProvider.js already implements — plugs into the
 * existing PayoutProviderResolver with one new registration line, no
 * changes to the contract or the resolver's own logic.
 *
 * Outcomes (identical vocabulary to CashfreePayoutProvider.js):
 *   PENDING — Razorpay accepted the payout (queued/pending/processing),
 *             OR the outcome is unknown (timeout/5xx/429/connection
 *             error). Funds stay in PROCESSING; the webhook or the
 *             reconciliation job resolves it. Never FAILED on an
 *             unknown outcome — that would release money that may
 *             already have been sent.
 *   SUCCESS — Razorpay reports the payout already "processed".
 *   FAILED  — Razorpay definitively rejected the request (4xx) or the
 *             payout itself resolved to "reversed"/"rejected"/
 *             "cancelled" — retryable reflects whether the same request
 *             could succeed later (auth/balance problems).
 *
 * HTTP only — never Mongo, never WalletBalanceService (per the
 * contract's own rule). Contact/fund-account reuse uses a DETERMINISTIC
 * reference_id looked up at call time (mirrors Cashfree's beneficiary
 * reuse) rather than any DB write from inside this file.
 */

import { SETTLEMENT_STATUS, SETTLEMENT_FAILURE_CODE } from "../SettlementEnums.js";
import {
  buildPayoutReferenceId,
  buildContactReferenceId,
  findContactByReferenceId,
  createContact,
  createFundAccount,
  createPayout,
  getPayout,
  findPayoutByReferenceId,
  mapPayoutState,
} from "../razorpayx/razorpayxPayoutClient.js";

export const RAZORPAY_ROUTE_PROVIDER_NAME = "RAZORPAY_ROUTE";

const result = (status, extra = {}) => ({
  status,
  success: status === SETTLEMENT_STATUS.SUCCESS,
  retryable: false,
  utr: null,
  providerPayoutId: null,
  providerResponse: null,
  failureCode: null,
  failureReason: null,
  ...extra,
});

const failureCodeFor = (httpStatus, json) => {
  const text = `${json?.error?.code || ""} ${json?.error?.description || ""}`.toLowerCase();
  if (text.includes("insufficient") || text.includes("balance")) return SETTLEMENT_FAILURE_CODE.INSUFFICIENT_BALANCE;
  if (text.includes("ifsc")) return SETTLEMENT_FAILURE_CODE.INVALID_IFSC;
  if (text.includes("account")) return SETTLEMENT_FAILURE_CODE.ACCOUNT_CLOSED;
  return SETTLEMENT_FAILURE_CODE.PROVIDER_ERROR;
};

// 401/403 (credentials) and insufficient RazorpayX account balance are
// our-side conditions a later attempt can succeed from.
const isRetryableRejection = (httpStatus, json) =>
  httpStatus === 401 || httpStatus === 403 || failureCodeFor(httpStatus, json) === SETTLEMENT_FAILURE_CODE.INSUFFICIENT_BALANCE;

const fromPayoutJson = (json) => {
  const status = mapPayoutState(json?.status);
  if (status === SETTLEMENT_STATUS.FAILED) {
    return result(status, {
      providerPayoutId: json?.id || null,
      providerResponse: json,
      failureCode: SETTLEMENT_FAILURE_CODE.PROVIDER_ERROR,
      failureReason: json?.failure_reason || `Payout ${json?.status}`,
    });
  }
  return result(status, {
    utr: json?.utr || null,
    providerPayoutId: json?.id || null,
    providerResponse: json,
  });
};

const isUnknownOutcome = (res) => res.networkError || res.httpStatus === 429 || (res.httpStatus && res.httpStatus >= 500);

const RazorpayXPayoutProvider = Object.freeze({
  name: RAZORPAY_ROUTE_PROVIDER_NAME,

  /** @param {{ payout: object, destination: {accountHolder:string, accountNumber:string, ifsc:string, phone:string, email?:string} }} params */
  execute: async ({ payout, destination }) => {
    const contactReferenceId = buildContactReferenceId({ entityType: payout.entityType, entityId: payout.entityId });

    // ── 1. Contact: reuse if it already exists, otherwise create ──
    const existingContact = await findContactByReferenceId(contactReferenceId);
    if (isUnknownOutcome(existingContact)) {
      return result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "contact_lookup", httpStatus: existingContact.httpStatus, message: existingContact.json?.error?.description || null } });
    }

    let contactId = existingContact.ok && Array.isArray(existingContact.json?.items) && existingContact.json.items.length > 0
      ? existingContact.json.items[0].id
      : null;

    if (!contactId) {
      const created = await createContact({ referenceId: contactReferenceId, name: destination.accountHolder, phone: destination.phone, email: destination.email });
      if (isUnknownOutcome(created)) {
        return result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "contact_create", httpStatus: created.httpStatus, message: created.json?.error?.description || null } });
      }
      if (!created.ok) {
        return result(SETTLEMENT_STATUS.FAILED, {
          retryable: isRetryableRejection(created.httpStatus, created.json),
          providerResponse: { stage: "contact_create", httpStatus: created.httpStatus, ...created.json },
          failureCode: failureCodeFor(created.httpStatus, created.json),
          failureReason: created.json?.error?.description || `Razorpay rejected the contact (HTTP ${created.httpStatus})`,
        });
      }
      contactId = created.json.id;
    }

    // ── 2. Fund account for this contact (see file header: no
    // persisted reuse across calls without a Mongo write, which this
    // provider must never perform — a harmless duplicate fund account
    // is an acceptable tradeoff since no money moves at this step) ──
    const fundAccountRes = await createFundAccount({ contactId, accountHolder: destination.accountHolder, accountNumber: destination.accountNumber, ifsc: destination.ifsc });
    if (isUnknownOutcome(fundAccountRes)) {
      return result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "fund_account", httpStatus: fundAccountRes.httpStatus, message: fundAccountRes.json?.error?.description || null, contactId } });
    }
    if (!fundAccountRes.ok) {
      return result(SETTLEMENT_STATUS.FAILED, {
        retryable: isRetryableRejection(fundAccountRes.httpStatus, fundAccountRes.json),
        providerResponse: { stage: "fund_account", httpStatus: fundAccountRes.httpStatus, ...fundAccountRes.json, contactId },
        failureCode: failureCodeFor(fundAccountRes.httpStatus, fundAccountRes.json),
        failureReason: fundAccountRes.json?.error?.description || `Razorpay rejected the fund account (HTTP ${fundAccountRes.httpStatus})`,
      });
    }
    const fundAccountId = fundAccountRes.json.id;

    // ── 3. Payout — the real money-moving step. Deterministic
    // reference_id AND the X-Payout-Idempotency header (see client's
    // own header) so a retried call can never send money twice. ──
    const referenceId = buildPayoutReferenceId(payout._id);
    const payoutRes = await createPayout({ referenceId, fundAccountId, amountInPaise: payout.amountInPaise, narration: `Zemish payout ${String(payout._id).slice(-8)}` });
    const withMeta = (r) => ({ ...r, providerResponse: { ...(r.providerResponse || {}), contactId, fundAccountId } });

    if (isUnknownOutcome(payoutRes)) {
      return withMeta(result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "payout_create", httpStatus: payoutRes.httpStatus, message: payoutRes.json?.error?.description || null } }));
    }

    // Idempotency conflict — a previous attempt already created this payout.
    if (payoutRes.httpStatus === 400 && /idempoten|already exist|duplicate/i.test(payoutRes.json?.error?.description || "")) {
      const dup = await findPayoutByReferenceId(referenceId);
      if (dup.ok && Array.isArray(dup.json?.items) && dup.json.items.length > 0) {
        return withMeta(fromPayoutJson(dup.json.items[0]));
      }
      return withMeta(result(SETTLEMENT_STATUS.PENDING, { providerResponse: { duplicate: true } }));
    }

    if (payoutRes.ok) return withMeta(fromPayoutJson(payoutRes.json));

    // Definitive rejection — nothing was sent.
    return withMeta(result(SETTLEMENT_STATUS.FAILED, {
      retryable: isRetryableRejection(payoutRes.httpStatus, payoutRes.json),
      providerResponse: { httpStatus: payoutRes.httpStatus, ...payoutRes.json },
      failureCode: failureCodeFor(payoutRes.httpStatus, payoutRes.json),
      failureReason: payoutRes.json?.error?.description || `Razorpay rejected the payout (HTTP ${payoutRes.httpStatus})`,
    }));
  },

  /** Poll one payout by our reference_id — used by reconciliation. */
  fetchStatus: async (payoutId) => {
    const referenceId = buildPayoutReferenceId(payoutId);
    const res = await findPayoutByReferenceId(referenceId);
    if (isUnknownOutcome(res)) return { known: false };
    if (!res.ok) return { known: false, httpStatus: res.httpStatus, message: res.json?.error?.description };
    if (!Array.isArray(res.json?.items) || res.json.items.length === 0) return { known: true, notFound: true };
    return { known: true, notFound: false, ...fromPayoutJson(res.json.items[0]) };
  },

  /** Direct fetch by Razorpay's own payout id (used opportunistically, not the primary reconciliation path). */
  fetchByProviderId: async (providerPayoutId) => {
    const res = await getPayout(providerPayoutId);
    if (isUnknownOutcome(res) || !res.ok) return { known: false };
    return { known: true, notFound: false, ...fromPayoutJson(res.json) };
  },
});

export default RazorpayXPayoutProvider;
