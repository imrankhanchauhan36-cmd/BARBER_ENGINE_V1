/**
 * BARBER ENGINE V1
 * backend/services/settlement/providers/CashfreePayoutProvider.js
 *
 * FA-P4-D Step 1 — Cashfree payout provider (CashfreePayoutProvider), implementing
 * the same PayoutProvider contract as ManualProvider so it plugs into
 * PayoutProviderResolver. Follows the contract rules: it performs HTTP
 * only — never Mongo, never WalletBalanceService — and REPORTS its
 * outcome by returning a result, never by throwing.
 *
 * Outcomes:
 *   PENDING — Cashfree accepted the transfer (RECEIVED/PENDING/...), OR
 *             the outcome is unknown (timeout / 5xx / 429 / connection
 *             error). Funds stay in PROCESSING; the webhook or the
 *             reconciliation job resolves it. Never FAILED on an
 *             unknown outcome — that would release money that may have
 *             been sent.
 *   SUCCESS — Cashfree reports the transfer already SUCCESS.
 *   FAILED  — Cashfree definitively rejected the request (4xx), so no
 *             transfer exists. retryable reflects whether the same
 *             request could succeed later (auth/IP/balance problems).
 *
 * The destination is passed in by the caller (`destination`) because
 * resolving the decrypted bank account is a DB read the provider must
 * not do.
 */

import { SETTLEMENT_STATUS, SETTLEMENT_FAILURE_CODE } from "../SettlementEnums.js";
import { buildTransferId, buildBeneficiaryId, createTransfer, getTransfer, getBeneficiary, createBeneficiary } from "../cashfree/cashfreePayoutClient.js";

export const CASHFREE_PROVIDER_NAME = "CASHFREE";

// Cashfree transfer statuses -> our provider status.
const SUCCESS_STATES = new Set(["SUCCESS"]);
const FAILED_STATES  = new Set(["FAILED", "REJECTED", "REVERSED", "CANCELLED"]);

export const mapTransferState = (state) => {
  const s = String(state || "").toUpperCase();
  if (SUCCESS_STATES.has(s)) return SETTLEMENT_STATUS.SUCCESS;
  if (FAILED_STATES.has(s)) return SETTLEMENT_STATUS.FAILED;
  return SETTLEMENT_STATUS.PENDING; // RECEIVED / PENDING / APPROVAL_PENDING / ...
};

const result = (status, extra = {}) => ({
  status,
  success:          status === SETTLEMENT_STATUS.SUCCESS,
  retryable:        false,
  utr:              null,
  providerPayoutId: null,
  providerResponse: null,
  failureCode:      null,
  failureReason:    null,
  ...extra,
});

const failureCodeFor = (httpStatus, json) => {
  const text = `${json?.code || ""} ${json?.message || ""}`.toLowerCase();
  if (text.includes("insufficient") || text.includes("balance")) return SETTLEMENT_FAILURE_CODE.INSUFFICIENT_BALANCE;
  if (text.includes("ifsc")) return SETTLEMENT_FAILURE_CODE.INVALID_IFSC;
  if (text.includes("account")) return SETTLEMENT_FAILURE_CODE.ACCOUNT_CLOSED;
  return SETTLEMENT_FAILURE_CODE.PROVIDER_ERROR;
};

// 401/403 (credentials / IP whitelist) and insufficient merchant balance
// are our-side conditions a later attempt can succeed from.
const isRetryableRejection = (httpStatus, json) =>
  httpStatus === 401 || httpStatus === 403 || failureCodeFor(httpStatus, json) === SETTLEMENT_FAILURE_CODE.INSUFFICIENT_BALANCE;

const fromTransferJson = (json) => {
  const status = mapTransferState(json?.status);
  if (status === SETTLEMENT_STATUS.FAILED) {
    return result(status, {
      providerPayoutId: json?.cf_transfer_id != null ? String(json.cf_transfer_id) : null,
      providerResponse: json,
      failureCode:      SETTLEMENT_FAILURE_CODE.PROVIDER_ERROR,
      failureReason:    json?.status_description || `Transfer ${json?.status}`,
    });
  }
  return result(status, {
    utr:              json?.transfer_utr || null,
    providerPayoutId: json?.cf_transfer_id != null ? String(json.cf_transfer_id) : null,
    providerResponse: json,
  });
};

const CashfreePayoutProvider = Object.freeze({
  name: CASHFREE_PROVIDER_NAME,

  /** @param {import("../PayoutProvider.js").PayoutProviderExecuteParams & {destination: {name,accountNumber,ifsc,phone}, fieldAgentId: *}} params */
  execute: async ({ payout, destination }) => {
    const transferId = buildTransferId(payout._id);
    const beneficiaryId = buildBeneficiaryId({ fieldAgentId: payout.fieldAgentRef, accountNumber: destination.accountNumber, ifsc: destination.ifsc });

    // ── 1. Beneficiary: reuse if it already exists, otherwise create ──
    const existing = await getBeneficiary(beneficiaryId);
    if (existing.networkError || (existing.httpStatus && existing.httpStatus >= 500) || existing.httpStatus === 429) {
      // Nothing was sent to the bank yet; safe to leave PROCESSING and retry later.
      return result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "beneficiary", httpStatus: existing.httpStatus, message: existing.json?.message || null } });
    }
    let beneficiaryReused = existing.ok;
    if (!existing.ok) {
      if (existing.httpStatus !== 404) {
        return result(SETTLEMENT_STATUS.FAILED, {
          retryable: isRetryableRejection(existing.httpStatus, existing.json),
          providerResponse: { stage: "beneficiary", httpStatus: existing.httpStatus, ...existing.json },
          failureCode: failureCodeFor(existing.httpStatus, existing.json),
          failureReason: existing.json?.message || `Cashfree beneficiary lookup failed (HTTP ${existing.httpStatus})`,
        });
      }
      const created = await createBeneficiary({ beneficiaryId, beneficiary: destination });
      if (created.networkError || (created.httpStatus && created.httpStatus >= 500) || created.httpStatus === 429) {
        return result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, stage: "beneficiary", httpStatus: created.httpStatus, message: created.json?.message || null } });
      }
      if (created.httpStatus === 409) beneficiaryReused = true; // raced with another request — it exists
      else if (!created.ok) {
        return result(SETTLEMENT_STATUS.FAILED, {
          retryable: isRetryableRejection(created.httpStatus, created.json),
          providerResponse: { stage: "beneficiary", httpStatus: created.httpStatus, ...created.json },
          failureCode: failureCodeFor(created.httpStatus, created.json),
          failureReason: created.json?.message || `Cashfree rejected the beneficiary (HTTP ${created.httpStatus})`,
        });
      }
    }

    // ── 2. Transfer to that beneficiary ──
    const res = await createTransfer({
      transferId,
      amountInPaise: payout.amountInPaise,
      beneficiaryId,
      remarks:       `Zemish payout ${String(payout._id).slice(-8)}`,
    });
    const withBeneficiary = (r) => ({ ...r, providerResponse: { ...(r.providerResponse || {}), beneficiaryId, beneficiaryReused } });

    // Unknown outcome — must NOT be treated as failure (see header).
    if (res.networkError || res.httpStatus === 429 || (res.httpStatus && res.httpStatus >= 500)) {
      return withBeneficiary(result(SETTLEMENT_STATUS.PENDING, { providerResponse: { unknownOutcome: true, httpStatus: res.httpStatus, message: res.json?.message || null } }));
    }

    // Duplicate transfer_id: a previous attempt DID create it.
    if (res.httpStatus === 409) {
      const dup = await getTransfer(transferId);
      if (dup.ok) return withBeneficiary(fromTransferJson(dup.json));
      return withBeneficiary(result(SETTLEMENT_STATUS.PENDING, { providerResponse: { duplicate: true } }));
    }

    if (res.ok) return withBeneficiary(fromTransferJson(res.json));

    // Definitive rejection — nothing was sent.
    return withBeneficiary(result(SETTLEMENT_STATUS.FAILED, {
      retryable:     isRetryableRejection(res.httpStatus, res.json),
      providerResponse: { httpStatus: res.httpStatus, ...res.json },
      failureCode:   failureCodeFor(res.httpStatus, res.json),
      failureReason: res.json?.message || `Cashfree rejected the transfer (HTTP ${res.httpStatus})`,
    }));
  },

  /** Poll one transfer by our transfer_id — used by reconciliation. */
  fetchStatus: async (payoutId) => {
    const res = await getTransfer(buildTransferId(payoutId));
    if (res.networkError || (res.httpStatus && res.httpStatus >= 500)) return { known: false };
    if (res.httpStatus === 404) return { known: true, notFound: true };
    if (!res.ok) return { known: false, httpStatus: res.httpStatus, message: res.json?.message };
    return { known: true, notFound: false, ...fromTransferJson(res.json) };
  },
});

export default CashfreePayoutProvider;
