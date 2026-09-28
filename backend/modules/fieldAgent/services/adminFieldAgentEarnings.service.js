/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/adminFieldAgentEarnings.service.js
 *
 * STEP 2.3 — Admin Field Agent Earnings Ledger API. Read-only join
 * only — FieldAgentEarningLedger, RevenueSplit, Booking, WalletLedger,
 * WalletBalanceService are all reused exactly as they are (WalletLedger/
 * WalletBalanceService are imported nowhere in this file — this
 * endpoint's numbers come entirely from FieldAgentEarningLedger's own
 * stored creditedAmountInPaise and RevenueSplit's own stored
 * customerPaidInPaise, never recomputed — matching the ticket's "Do
 * NOT recalculate money" instruction). No write to any model anywhere
 * in this file.
 *
 * JOIN CHAIN (exactly as specified): FieldAgentEarningLedger →
 * Booking (via bookingRef) → Salon (via Booking.salonRef) →
 * RevenueSplit (via RevenueSplit.bookingId === ledger.bookingRef, a
 * separate single batched query — RevenueSplit has no back-reference
 * on Booking/FieldAgentEarningLedger to populate() through, so it is
 * joined here as an explicit second read keyed by the same bookingId,
 * still a plain read/join, no aggregation pipeline of any kind).
 *
 * ROW SCOPE (a deliberate, disclosed interpretation — the ticket does
 * not say whether zero-credit ledger rows belong in the list): EVERY
 * FieldAgentEarningLedger row for this agent is returned, including
 * ZERO_TARGET_REACHED/ZERO_AGENT_INELIGIBLE/ZERO_TERM_EXPIRED outcomes
 * (their agentEarnedInPaise is simply 0, the ledger's own real stored
 * value) — this keeps `bookingCount` and `items.length` identical and
 * never hides an audit-relevant row from the admin. lifetimeEarningsInPaise
 * is the plain sum of creditedAmountInPaise across those same rows (zero
 * rows contribute 0), so it is unaffected either way.
 */

import FieldAgent from "../models/FieldAgent.js";
import FieldAgentEarningLedger from "../models/FieldAgentEarningLedger.js";
import RevenueSplit from "../../finance/models/RevenueSplit.js";
import { Errors } from "../../../utils/response.js";

export const getAdminFieldAgentEarnings = async ({ fieldAgentId }) => {
  const fieldAgent = await FieldAgent.findById(fieldAgentId).select("_id").lean();
  if (!fieldAgent) throw Errors.notFound("Field Agent not found");

  const ledgerRows = await FieldAgentEarningLedger.find({ fieldAgentRef: fieldAgent._id })
    .select("bookingRef creditedAmountInPaise entitlementType bookingCompletedAt")
    .sort({ bookingCompletedAt: -1 })
    .populate({
      path: "bookingRef",
      select: "bookingDate salonRef",
      populate: { path: "salonRef", select: "basicInfo.shopName", model: "Salon" },
    })
    .lean();

  // A ledger row's bookingRef can fail to resolve only if the Booking
  // document itself was hard-deleted out of the collection — every
  // FieldAgentEarningLedger row is otherwise permanently, immutably
  // tied to the booking it was created for (see that model's own
  // header). Rows that can't resolve are excluded from the list (there
  // is nothing to join against) rather than returned half-populated.
  const resolvedRows = ledgerRows.filter((r) => r.bookingRef);

  const bookingIds = resolvedRows.map((r) => r.bookingRef._id);
  const revenueSplits = bookingIds.length
    ? await RevenueSplit.find({ bookingId: { $in: bookingIds } })
        .select("bookingId customerPaidInPaise")
        .lean()
    : [];
  const customerPaidByBookingId = new Map(
    revenueSplits.map((rs) => [String(rs.bookingId), rs.customerPaidInPaise])
  );

  const items = resolvedRows.map((r) => {
    const booking = r.bookingRef;
    return {
      bookingId: booking._id,
      bookingDate: booking.bookingDate ?? null,
      salonName: booking.salonRef?.basicInfo?.shopName ?? null,
      // null (not 0) when no RevenueSplit exists yet for this booking —
      // a real, distinct condition from "customer paid zero", never
      // silently coerced to 0.
      customerPaidInPaise: customerPaidByBookingId.has(String(booking._id))
        ? customerPaidByBookingId.get(String(booking._id))
        : null,
      agentEarnedInPaise: r.creditedAmountInPaise,
      commercialType: r.entitlementType,
    };
  });

  const lifetimeEarningsInPaise = resolvedRows.reduce((sum, r) => sum + r.creditedAmountInPaise, 0);

  return {
    summary: {
      lifetimeEarningsInPaise,
      bookingCount: items.length,
    },
    items,
  };
};
