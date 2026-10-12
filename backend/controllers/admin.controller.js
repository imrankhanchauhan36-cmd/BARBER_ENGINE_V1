import bcrypt from "bcryptjs";
import District from "../models/District.js";
import Salon from "../models/Salon.js";
import State from "../models/State.js";
import User from "../models/User.js";
import NotificationService from "../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/constants/notificationEvents.constants.js";
import { Errors, successResponse } from "../utils/response.js";

/**
 * =====================================================
 * LIST SALONS FOR ADMIN
 * =====================================================
 */
export const listSalonsForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    if (!admin || !admin.adminLevel) return next(Errors.forbidden("Invalid admin"));

    const {
      page      = 1,
      limit     = 20,
      search    = "",
      status    = "ALL",
      category,
      tier,
      state,
      district,
      sortBy    = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    // ── Base Filter ──────────────────────────────────
    const filter = { isDeleted: { $ne: true } };

    if (status !== "ALL") filter["approval.status"]   = status;
    if (category)         filter["basicInfo.category"] = category;
    if (tier)             filter["basicInfo.tier"]     = tier;

    // ── Search (shop name + owner phone via $or) ─────
    if (search?.trim()) {
      const regex = { $regex: search.trim(), $options: "i" };
      filter.$or  = [
        { "basicInfo.shopName": regex },
        { "manager.phone":      regex },
      ];
    }

    // ── Scope Filter ─────────────────────────────────
    if (admin.adminLevel === "STATE") {
      filter["location.territory.stateRef"] = admin.stateRef;
    }
    if (admin.adminLevel === "DISTRICT") {
      filter["location.territory.districtRef"] = admin.districtRef;
    }
    if (admin.adminLevel === "INDIA") {
      if (state)    filter["location.territory.stateRef"]    = state;
      if (district) filter["location.territory.districtRef"] = district;
    }

    // ── Sort (whitelist) ─────────────────────────────
    const allowedSort = {
      createdAt: "createdAt",
      shopName:  "basicInfo.shopName",
      status:    "approval.status",
      category:  "basicInfo.category",
    };
    const sortField = allowedSort[sortBy] || "createdAt";
    const sort      = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    // ── Query ────────────────────────────────────────
    const [salons, total] = await Promise.all([
      Salon.find(filter)
        .select("_id basicInfo location approval createdAt assignedAdmin ownerId rating business")
        .populate("ownerId",                        "name phone")
        .populate("assignedAdmin",                  "name phone adminLevel")
        .populate("location.territory.stateRef",    "name")
        .populate("location.territory.districtRef", "name")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Salon.countDocuments(filter),
    ]);

    // ── Flatten Response ─────────────────────────────
    const isIndia = admin.adminLevel === "INDIA";

    const data = salons.map(s => ({
      id:           s._id,
      shopName:     s.basicInfo?.shopName   ?? null,
      category:     s.basicInfo?.category   ?? null,
      tier:         s.basicInfo?.tier       ?? null,
      ownerName:    s.ownerId?.name         ?? null,
      ownerPhone:   s.ownerId?.phone        ?? null,
      state:        s.location?.territory?.stateRef?.name    ?? null,
      district:     s.location?.territory?.districtRef?.name ?? null,
      status:       s.approval?.status      ?? null,
      rating:       s.rating?.average       ?? null,  // ✅ FIX 3
      isForceClosed: s.business?.isForceClosed ?? false,
      isSuspended:   s.business?.isSuspended   ?? false,
      assignedAdmin: s.assignedAdmin ?? null,
      createdAt:     s.createdAt,
      // ✅ FIX 5 — commission sirf INDIA admin dekhe
      ...(isIndia && { commissionRate: s.business?.commissionRate ?? null }),
    }));

    return successResponse(res, {
      message: "Salons fetched",
      data,
      pagination: {
        page:       pageNumber,
        limit:      limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber) || 1,
      },
    });

  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * UPDATE SALON STATUS (APPROVE / REJECT)
 * INDIA = PAN-India authority. STATE = own state only.
 * DISTRICT = own district only — and has FINAL approval
 * authority there (no second-stage review by a higher level).
 * Only a PENDING salon may be approved or rejected; APPROVED/
 * REJECTED are terminal here — the only way back to PENDING is
 * the existing owner resubmission flow (REJECTED → DRAFT →
 * onboarding → PENDING), unchanged by this endpoint.
 * =====================================================
 */
export const updateSalonStatus = async (req, res, next) => {
  try {
    if (!["INDIA", "STATE", "DISTRICT"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Invalid admin level for salon approval"));
    }

    const allowedStatuses = ["APPROVED", "REJECTED"];
    if (!allowedStatuses.includes(req.body.status)) {
      return next(Errors.badRequest("Invalid status"));
    }

    const { status } = req.body;
    const rejectionReason = typeof req.body.rejectionReason === "string" ? req.body.rejectionReason.trim() : "";

    const salon = await Salon.findById(req.params.id);
    if (!salon) return next(Errors.notFound("Salon not found"));

    // Scope check first — an admin outside their own state/district must
    // get a plain 403 without learning anything about the salon's current
    // approval status.
    if (req.user.adminLevel === "STATE") {
      const salonStateId = salon.location?.territory?.stateRef?.toString();
      if (!salonStateId || salonStateId !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Not allowed to approve this salon"));
      }
    }
    // DISTRICT admin → apne poore district ke salons approve kar sakta hai
    // (matches listSalonsForAdmin scope — one district = one district admin,
    // so district-wide access, not per-salon assignedAdmin matching)
    if (req.user.adminLevel === "DISTRICT") {
      const salonDistrictId = salon.location?.territory?.districtRef?.toString();
      if (!salonDistrictId || salonDistrictId !== req.user.districtRef?.toString()) {
        return next(Errors.forbidden("Not allowed to approve this salon"));
      }
    }
    // INDIA → koi bhi salon approve kar sakta hai (PAN-India)

    // State-machine guard — only a PENDING salon can receive a new
    // decision. APPROVED→REJECTED, REJECTED→APPROVED, and re-deciding an
    // already-decided salon are all invalid transitions in this workflow.
    if (salon.approval?.status !== "PENDING") {
      return next(Errors.conflict("Only a PENDING salon can be approved or rejected"));
    }

    if (status === "REJECTED") {
      if (!rejectionReason) {
        return next(Errors.badRequest("Rejection reason is required"));
      }
      if (rejectionReason.length > 300) {
        return next(Errors.badRequest("Rejection reason must be 300 characters or fewer"));
      }
    }

    // ZEMISH expected-flow correction — the KYC gate that used to live
    // here (blocking APPROVED when the owner's PAN+Bank KYC wasn't yet
    // verified) has been REMOVED, not merely hidden. Admin can now
    // approve a salon while the owner's KYC is still pending: the
    // corrected flow is submit -> Admin review/approval -> post-
    // approval KYC Choice screen, so KYC is no longer a precondition
    // for approval itself. Mandatory PAN+Bank verification is NOT
    // removed: discoverability/bookability for a salon approved while
    // KYC-pending is now independently enforced by
    // business.isKycVerifiedForDiscovery (see utils/salonReady.guard.js
    // and services/salonVisibilitySync.service.js) rather than by
    // blocking the approval decision itself. The Owner's own
    // submitSalon() (controllers/salon.onboarding.controller.js) is
    // unaffected by this change — unchanged. The Field-Agent-assisted
    // submitSalon() port (fieldAgentOnboarding.service.js) still
    // enforces its own shared gate predicate at submit time, also
    // unaffected — unchanged.

    // MUST-DO-NOW #3 — concurrency fix. The pre-check above (line 180)
    // reads from `salon`, loaded by a separate, earlier findById — two
    // concurrent requests can both read PENDING and both pass it. The
    // DATABASE WRITE ITSELF must also require "approval.status":
    // "PENDING" so only the first one to actually commit can match;
    // the second finds no matching document (status already changed
    // by the first) and gets null back here, never a silent second
    // "success". This is the only change — every $set field and the
    // existing { new: true, runValidators: true } behavior are
    // unchanged.
    const updated = await Salon.findOneAndUpdate(
      { _id: req.params.id, "approval.status": "PENDING" },
      {
        $set: {
          "approval.status":          status,
          "approval.approvedBy":      status === "APPROVED" ? req.user._id : null,
          "approval.approvedAt":      status === "APPROVED" ? new Date()   : null,
          "approval.rejectedBy":      status === "REJECTED" ? req.user._id : null,
          "approval.rejectedAt":      status === "REJECTED" ? new Date()   : null,
          "approval.rejectionReason": status === "REJECTED" ? rejectionReason : null,
        },
      },
      { new: true, runValidators: true }
    );

    // Lost the race (or the status genuinely changed between the
    // earlier read and this write) — no document matched the
    // conditional filter. Same conflict response as the existing
    // pre-check, and — critically — return BEFORE any notification is
    // sent, so a losing concurrent request can never produce a
    // duplicate/contradictory notification.
    if (!updated) {
      return next(Errors.conflict("Only a PENDING salon can be approved or rejected"));
    }

    //////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after write)
    //////////////////////////////////////////////////////

    await NotificationService.send({
      recipientId:   updated._id,
      recipientType: "SALON",
      templateKey:   status === "APPROVED" ? NOTIFICATION_EVENTS.SALON_APPROVED : NOTIFICATION_EVENTS.SALON_REJECTED,
      variables:      status === "REJECTED" ? { reason: updated.approval?.rejectionReason || "Not specified" } : {},
      title:         status === "APPROVED" ? "Salon Approved ✅" : "Salon Application Rejected",
      message:       status === "APPROVED"
        ? "Congratulations! Your salon has been approved and is now live."
        : `Your salon application was rejected. Reason: ${updated.approval?.rejectionReason || "Not specified"}`,
      type:          "SYSTEM",
      priority:      "HIGH",
      actionType:    "OPEN_SALON",
      actionUrl:     "/salon/profile",
      meta:          { salonId: updated._id },
    });

    return successResponse(res, { message: "Salon status updated", data: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * SET SALON COMMISSION
 * INDIA admin only — route level bhi guard hoga
 * =====================================================
 */
export const setSalonCommission = async (req, res, next) => {
  try {
    // ✅ FIX 7 — INDIA only
    if (req.user.adminLevel !== "INDIA") {
      return next(Errors.forbidden("Only INDIA admin can set commission"));
    }

    const { commission } = req.body;

    if (commission == null || commission < 0 || commission > 50) {
      return next(Errors.badRequest("Commission must be between 0 and 50"));
    }

    const salon = await Salon.findByIdAndUpdate(
      req.params.id,
      { $set: { "business.commissionRate": commission } },
      { new: true }
    );

    if (!salon) return next(Errors.notFound("Salon not found"));

    return successResponse(res, { message: "Commission updated", data: { commissionRate: salon.business.commissionRate } });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * FORCE CLOSE SALON
 * INDIA + STATE admin only
 * =====================================================
 */
export const forceCloseSalon = async (req, res, next) => {
  try {
    // ✅ FIX 6 — INDIA + STATE only
    if (!["INDIA", "STATE"].includes(req.user.adminLevel)) {
      return next(Errors.forbidden("Insufficient privileges to force close salon"));
    }

    const salon = await Salon.findById(req.params.id);
    if (!salon) return next(Errors.notFound("Salon not found"));

    // Scope check — same pattern as updateSalonStatus above: a STATE
    // admin may only force-close salons within their own state.
    if (req.user.adminLevel === "STATE") {
      const salonStateId = salon.location?.territory?.stateRef?.toString();
      if (!salonStateId || salonStateId !== req.user.stateRef?.toString()) {
        return next(Errors.forbidden("Not allowed to force close this salon"));
      }
    }
    // INDIA → koi bhi salon force close kar sakta hai (PAN-India)

    const updated = await Salon.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          "business.isForceClosed": true,
          "business.isShopOpen":    false,
        },
      },
      { new: true }
    );

    return successResponse(res, { message: "Salon force closed", data: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * =====================================================
 * CREATE STATE ADMIN
 * =====================================================
 */
export const createStateAdmin = async (req, res, next) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId } = req.body;

    if (creator.adminLevel !== "INDIA") {
      return next(Errors.forbidden("Only INDIA admin can create state admin"));
    }

    name  = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const state = await State.findById(stateId).lean();
    if (!state) return next(Errors.notFound("State not found"));

    const hashedPassword = await bcrypt.hash("Admin@12345", 10);

    const admin = await User.create({
      name, phone, email,
      password:   hashedPassword,
      role:       "ADMIN",
      adminLevel: "STATE",
      countryRef: creator.countryRef,
      stateRef:   stateId,
    });

    return successResponse(res, {
      statusCode: 201,
      message:    "State admin created",
      data:       { adminId: admin._id, tempPassword: "Admin@12345" },
    });
  } catch (err) {
    if (err.code === 11000) return next(Errors.conflict("Duplicate admin"));
    next(err);
  }
};

/**
 * =====================================================
 * CREATE DISTRICT ADMIN
 * =====================================================
 */
export const createDistrictAdmin = async (req, res, next) => {
  try {
    const creator = req.user;
    let { name, phone, email, stateId, districtId } = req.body;

    if (!["INDIA", "STATE"].includes(creator.adminLevel)) {
      return next(Errors.forbidden("Not allowed to create district admin"));
    }

    if (
      creator.adminLevel === "STATE" &&
      creator.stateRef.toString() !== stateId
    ) {
      return next(Errors.forbidden("Cannot create admin outside your state"));
    }

    name  = name.trim().replace(/\s+/g, " ");
    phone = String(phone.replace(/\D/g, ""));
    email = email?.toLowerCase().trim() || null;

    const district = await District.findById(districtId).lean();
    if (!district) return next(Errors.notFound("District not found"));

    if (district.stateRef.toString() !== stateId) {
      return next(Errors.badRequest("District mismatch"));
    }

    const hashedPassword = await bcrypt.hash("Admin@12345", 10);

    const admin = await User.create({
      name, phone, email,
      password:    hashedPassword,
      role:        "ADMIN",
      adminLevel:  "DISTRICT",
      countryRef:  creator.countryRef,
      stateRef:    stateId,
      districtRef: districtId,
    });

    return successResponse(res, {
      statusCode: 201,
      message:    "District admin created",
      data:       { adminId: admin._id, tempPassword: "Admin@12345" },
    });
  } catch (err) {
    if (err.code === 11000) return next(Errors.conflict("Duplicate admin"));
    next(err);
  }
};