/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentEarning.selfService.js
 *
 * FA-14 — Field Agent Earnings Self-Service (READ ONLY).
 *
 * Deliberately a SEPARATE file from fieldAgentEarning.service.js (FA-9,
 * frozen) — that file owns earning calculation/processing and is
 * never imported or touched here beyond the shared constants module.
 * This file only ever reads FieldAgentEarningLedger; it contains no
 * write, update, or recalculation path of any kind.
 *
 * Identity is resolved exclusively via getFieldAgentByUserId(userId)
 * (fieldAgentProfile.service.js, frozen, unmodified) — the exact same
 * function acquisitionClaim.service.js's listMyReferrals/listMyClaims
 * already use. No caller of this module can pass a fieldAgentRef
 * directly; there is no parameter for one.
 *
 * The response DTO is built explicitly, field-by-field (toEarningDTO
 * below) — never a raw `.lean()` document. A `.select()` on the query
 * itself additionally ensures sensitive fields (idempotencyKey,
 * policySource, policyVersionRef, bookingCommissionAmountInPaise,
 * rawEligibleAmountInPaise, territoryAssignmentRef, bookingRef,
 * fieldAgentRef) are never even fetched from MongoDB, not merely
 * omitted at serialization time — defense in depth beyond the DTO
 * mapping alone.
 */

import { Errors } from "../../../utils/response.js";
import { MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT } from "../constants/acquisitionClaim.constants.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import { getFieldAgentByUserId } from "./fieldAgentProfile.service.js";

const clampLimit = (limit) => Math.max(1, Math.min(Number(limit) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT));
const clampPage  = (page)  => Math.max(1, Number(page) || 1);

// Only the fields approved for agent-facing exposure — see this
// phase's own data-contract table. Never spreads the raw document.
const toEarningDTO = (doc) => ({
  id:                    doc._id,
  entitlementType:       doc.entitlementType,
  creditedAmountInPaise: doc.creditedAmountInPaise,
  creditOutcome:         doc.creditOutcome,
  bookingCompletedAt:    doc.bookingCompletedAt,
  createdAt:             doc.createdAt,
  appliedRatePercent:    doc.appliedRatePercent,
  acquisitionClaimRef:   doc.acquisitionClaimRef ?? null,
});

export const listMyEarnings = async ({ userId, page, limit }) => {
  const fieldAgent = await getFieldAgentByUserId(userId);
  if (!fieldAgent) throw Errors.notFound("Field Agent profile not found");

  const safeLimit = clampLimit(limit);
  const safePage  = clampPage(page);
  const filter     = { fieldAgentRef: fieldAgent._id };

  const [docs, total] = await Promise.all([
    FieldAgentEarningLedger.find(filter)
      .select("entitlementType creditedAmountInPaise creditOutcome bookingCompletedAt createdAt appliedRatePercent acquisitionClaimRef")
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    FieldAgentEarningLedger.countDocuments(filter),
  ]);

  return { items: docs.map(toEarningDTO), total, page: safePage, limit: safeLimit };
};
