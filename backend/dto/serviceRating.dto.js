//////////////////////////////////////////////////////////////
// RATING & REVIEW ENGINE — RESPONSE DTOs (Phase 2)
//
// Mirrors dto/professionalChairAssignment.dto.js's convention —
// keeps Mongoose internals out of API responses.
//////////////////////////////////////////////////////////////

const toIdString = (value) => (value === null || value === undefined ? null : String(value));

export const toEligibilityDTO = (eligibility) => ({
  bookingId: toIdString(eligibility.bookingId),
  salonId: toIdString(eligibility.salonId),
  completedAt: eligibility.completedAt,
  fullyRated: eligibility.fullyRated,
  dimensions: eligibility.dimensions.map((d) => ({
    type: d.type,
    targetId: toIdString(d.targetId),
    name: d.name,
    alreadyRated: d.alreadyRated,
  })),
});

export const toSubmissionResultDTO = (results) =>
  results.map((r) => ({
    type: r.type,
    targetId: toIdString(r.targetId),
    status: r.status,
    ...(r.reason ? { reason: r.reason } : {}),
  }));

// R3.3-C: public review-list rows never expose raw customerId — only a
// safe display name, resolved by the caller via a single batched User
// lookup (see controllers/serviceRating.controller.js::enrichReviewRows)
// and passed in as `nameById`. Falls back to "Verified Customer" when
// the reviewer's User document is missing/deleted, exactly matching
// the placeholder the User App already uses today.
export const toReviewListItemDTO = (row, nameById) => ({
  id: toIdString(row._id),
  stars: row.stars,
  review: row.review || null,
  reviewer: { name: nameById.get(row.customerId.toString()) || "Verified Customer" },
  createdAt: row.createdAt,
});

export const toMyRatingDTO = (row) => ({
  id: toIdString(row._id),
  bookingId: toIdString(row.bookingId),
  salonId: toIdString(row.salonId),
  type: row.type,
  targetId: toIdString(row.targetId),
  stars: row.stars,
  review: row.review || null,
  createdAt: row.createdAt,
});

export const toSummaryDTO = (summary) => ({
  count: summary.count,
  average: summary.average,
  distribution: summary.distribution,
});
