/**
 * BARBER ENGINE V1
 * backend/services/adminCustomerReviews.service.js
 *
 * STEP 5.5A — Admin Customer Reviews API. Read-only — no write to
 * Rating/User/Booking/Salon anywhere in this file. No schema change.
 *
 * MODEL NAME DISCLOSURE — the ticket names "Review" as one of the
 * existing models to use. There is no `Review` model anywhere in
 * backend/models/ (confirmed by listing the directory before writing
 * this file). The model that actually holds a customer's rating +
 * written comment for a completed booking is `Rating`
 * (backend/models/Rating.js): one row per booking (`bookingId` is
 * unique on the schema), with `userId` (ref User), `salonId` (ref
 * Salon), `rating` (1-5), `review` (the free-text comment, up to 500
 * chars), `isFlagged`, `isHidden`. This service reads that model —
 * not a nonexistent `Review` collection — and is disclosed here
 * rather than silently assumed. No model was created or modified to
 * make this true; `Rating` already existed exactly as described.
 *
 * "Customer" = a User document with role "USER" (same definition as
 * STEP 5.1's audit finding, reused unchanged in STEP 5.2A/5.2B).
 *
 * "status" DERIVATION — the ticket's response shape asks for a
 * `status` field per review, but Rating has no status enum on its
 * schema (only two independent booleans: isFlagged, isHidden). This
 * is derived, disclosed, not invented data:
 *   isHidden  -> "HIDDEN"   (admin-hidden, per the model's own comment
 *                             "admin can hide, not delete")
 *   isFlagged -> "FLAGGED"  (flagged, not yet hidden)
 *   neither   -> "VISIBLE"
 * (isHidden takes precedence — a hidden+flagged review reports HIDDEN,
 * since that's the stronger, user-facing-impacting state.)
 *
 * Scope guard mirrors the now-standardized districtRef rule used by
 * every sibling admin/users/:id/* endpoint (STEP 5.2A/5.2B).
 */

import mongoose from "mongoose";
import User from "../models/User.js";
import Rating from "../models/Rating.js";
import { Errors } from "../utils/response.js";

const isWithinAdminScope = (admin, customer) => {
  if (admin?.adminLevel === "INDIA") return true;
  if (admin?.adminLevel === "STATE") {
    return customer.stateRef?.toString() === admin.stateRef?.toString();
  }
  if (admin?.adminLevel === "DISTRICT") {
    return customer.districtRef?.toString() === admin.districtRef?.toString();
  }
  return false;
};

const deriveStatus = (r) => {
  if (r.isHidden) return "HIDDEN";
  if (r.isFlagged) return "FLAGGED";
  return "VISIBLE";
};

export const getAdminCustomerReviews = async ({ customerId, admin }) => {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw Errors.badRequest("Invalid customer ID");
  }

  const customer = await User.findOne({ _id: customerId, role: "USER", isDeleted: { $ne: true } })
    .select("stateRef districtRef")
    .lean();
  if (!customer) throw Errors.notFound("Customer not found");
  if (!isWithinAdminScope(admin, customer)) throw Errors.forbidden("Out of your authorized scope");

  const rows = await Rating.find({ userId: customerId })
    .select("bookingId salonId rating review isFlagged isHidden createdAt")
    .sort({ createdAt: -1 })
    .populate("salonId", "basicInfo.shopName")
    .lean();

  const reviews = rows.map((r) => ({
    reviewId: r._id,
    reviewDate: r.createdAt ?? null,
    salonName: r.salonId?.basicInfo?.shopName ?? null,
    rating: r.rating ?? null,
    comment: r.review ?? null,
    bookingId: r.bookingId ?? null,
    status: deriveStatus(r),
  }));

  return { reviews };
};
