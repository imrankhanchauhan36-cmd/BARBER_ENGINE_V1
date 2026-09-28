/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentPayoutHistory.service.js
 *
 * STEP 2.4 — Admin Field Agent Payout History API. Read-only only —
 * GenericPayoutRequest and FieldAgentPayoutRequest are reused exactly
 * as they are, no write to either anywhere in this file. Both live
 * payout systems are merged (same documented rationale as STEP 2.1's
 * pendingWithdraw/totalWithdrawn totals — both are independently
 * reachable by the same Field Agent today, so reading only one would
 * silently hide real payout history).
 *
 * NORMALIZATION, one field at a time:
 *  - provider    → GenericPayoutRequest.payoutProvider (RAZORPAY_ROUTE|
 *                  MANUAL) / FieldAgentPayoutRequest.payoutProvider
 *                  (CASHFREE|MANUAL) — same field name on both models,
 *                  copied through as-is, never remapped.
 *  - amountInPaise/status/utr → identical field names on both models,
 *                  copied through as-is.
 *  - requestDate → createdAt on both models (when the request was
 *                  created).
 *  - paidDate    → neither model has a dedicated "paid at" timestamp
 *                  (confirmed by reading both schemas before writing
 *                  this file — GenericPayoutRequest and
 *                  FieldAgentPayoutRequest only carry createdAt/
 *                  updatedAt + admin-audit fields like approvedAt,
 *                  none of which mark the PAID transition itself). A
 *                  disclosed, deliberate choice: `updatedAt` is used
 *                  as paidDate ONLY when status === PAID (the last
 *                  write to a PAID row is, in current practice, the
 *                  transition into PAID itself), and `null` otherwise
 *                  — never fabricated for a non-PAID row.
 *  - `id`/`system` are additive (not in the ticket's field list) —
 *                  included only so two rows from different
 *                  collections remain distinguishable/keyable by a
 *                  consumer; nothing about the ticket's requested
 *                  fields is renamed or dropped by adding them.
 */

import FieldAgent from "../models/FieldAgent.js";
import GenericPayoutRequest from "../../payout/models/GenericPayoutRequest.js";
import FieldAgentPayoutRequest from "../models/FieldAgentPayoutRequest.js";
import { GENERIC_PAYOUT_STATUS } from "../../payout/constants/genericPayoutRequest.constants.js";
import { FIELD_AGENT_PAYOUT_STATUS } from "../models/FieldAgentPayoutRequest.js";
import { Errors } from "../../../utils/response.js";

const normalizeGeneric = (row) => ({
  id: row._id,
  system: "GENERIC",
  provider: row.payoutProvider,
  amountInPaise: row.amountInPaise,
  status: row.status,
  utr: row.utr ?? null,
  requestDate: row.createdAt,
  paidDate: row.status === GENERIC_PAYOUT_STATUS.PAID ? row.updatedAt : null,
});

const normalizeFieldAgent = (row) => ({
  id: row._id,
  system: "FIELD_AGENT",
  provider: row.payoutProvider,
  amountInPaise: row.amountInPaise,
  status: row.status,
  utr: row.utr ?? null,
  requestDate: row.createdAt,
  paidDate: row.status === FIELD_AGENT_PAYOUT_STATUS.PAID ? row.updatedAt : null,
});

export const getAdminFieldAgentPayoutHistory = async ({ fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).select("_id commercialPath").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const [genericRows, fieldAgentRows] = await Promise.all([
    fieldAgent.commercialPath
      ? GenericPayoutRequest.find({ entityType: fieldAgent.commercialPath, entityId: fieldAgent._id })
          .select("payoutProvider amountInPaise status utr createdAt updatedAt")
          .lean()
      : Promise.resolve([]),
    FieldAgentPayoutRequest.find({ fieldAgentRef: fieldAgent._id })
      .select("payoutProvider amountInPaise status utr createdAt updatedAt")
      .lean(),
  ]);

  const merged = [
    ...genericRows.map(normalizeGeneric),
    ...fieldAgentRows.map(normalizeFieldAgent),
  ].sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  return merged;
};
