/**
 * BARBER ENGINE V1
 * backend/modules/kyc/controllers/adminKyc.controller.js
 * Admin KYC Controller — Phase 6A — 10/10 FROZEN
 *
 * v1.1 — Extracted repeated admin-level permission checks into a single
 * assertAdminLevel() helper (maintainability improvement only — no
 * behavior change, no response/message change, no route change).
 */

import Salon from "../../../models/Salon.js";
import User from "../../../models/User.js";
import NotificationService from "../../../services/NotificationService.js";
import { NOTIFICATION_EVENTS } from "../../notifications/constants/notificationEvents.constants.js";
import { Errors, successResponse } from "../../../utils/response.js";
import { KYC_STATUS } from "../constants/kyc.constants.js";
import { toDetailDTO, toListDTO, toSummaryDTO } from "../dto/adminKyc.dto.js";
import KYC from "../models/KYC.js";
import { approveKYC, assignKYC, getKYCLogs, rejectKYC, requestReupload } from "../services/kyc.service.js";
import { verifyAadhaar, verifyBank, verifyPAN } from "../services/verification.service.js";
import { validateApprove, validateAssign, validateReject, validateRequestReupload } from "../validators/kyc.validator.js";

const isValidId = (id) => /^[0-9a-fA-F]{24}$/.test(id);

// ─── Admin Level Guard ─────────────────────────────────────
// ✅ Maintainability fix — was previously repeated inline as
//   if (!["INDIA", "STATE"].includes(admin.adminLevel)) return next(Errors.forbidden("Insufficient privileges"));
// in every write endpoint below. Centralized here so the allowed-levels
// list only needs to change in one place, and every handler stays
// shorter. Throws (rather than returning a value) so it composes with
// the existing `try { ... } catch (err) { next(err) }` pattern already
// present in every handler — no control-flow change at the call sites.
const assertAdminLevel = (admin, allowedLevels, message = "Insufficient privileges") => {
  if (!allowedLevels.includes(admin.adminLevel)) {
    throw Errors.forbidden(message);
  }
};

// ─── Scope Helper ─────────────────────────────────────────
const getScopedOwnerIds = async (admin) => {
  if (admin.adminLevel === "INDIA") return null;
  const salonFilter = { isDeleted: { $ne: true } };
  if (admin.adminLevel === "STATE")    salonFilter["location.territory.stateRef"]    = admin.stateRef;
  if (admin.adminLevel === "DISTRICT") salonFilter["location.territory.districtRef"] = admin.districtRef;
  const salons = await Salon.find(salonFilter).select("ownerId").lean();
  return [...new Set(salons.map(s => s.ownerId?.toString()).filter(Boolean))];
};

// ✅ Fix 2 — Reusable scope guard for write operations
const assertKYCInScope = async (kyc, admin) => {
  if (admin.adminLevel === "INDIA") return; // no restriction
  const ownerIds = await getScopedOwnerIds(admin);
  const ownerId  = kyc.ownerId?._id?.toString() || kyc.ownerId?.toString();
  if (!ownerIds?.includes(ownerId)) {
    throw Errors.forbidden("KYC is outside your admin scope");
  }
};

/**
 * GET /admin/kyc/summary
 */
export const getKYCSummary = async (req, res, next) => {
  try {
    const admin    = req.user;
    const ownerIds = await getScopedOwnerIds(admin);
    const filter   = { isDeleted: { $ne: true } };
    if (ownerIds) filter.ownerId = { $in: ownerIds };

    const [agg] = await KYC.aggregate([
      { $match: filter },
      {
        $group: {
          _id:               null,
          total:             { $sum: 1 },
          draft:             { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.DRAFT]              }, 1, 0] } },
          pending:           { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.PENDING]            }, 1, 0] } },
          underReview:       { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.UNDER_REVIEW]       }, 1, 0] } },
          partiallyVerified: { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.PARTIALLY_VERIFIED] }, 1, 0] } },
          verified:          { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.VERIFIED]           }, 1, 0] } },
          rejected:          { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.REJECTED]           }, 1, 0] } },
          expired:           { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.EXPIRED]            }, 1, 0] } },
          reverifyRequired:  { $sum: { $cond: [{ $eq: ["$status", KYC_STATUS.REVERIFY_REQUIRED]  }, 1, 0] } },
          highRisk:          { $sum: { $cond: [{ $gt: ["$risk.score", 60]                        }, 1, 0] } },
          manualReviewQueue: { $sum: { $cond: [{ $eq: ["$risk.manualReviewRequired", true]       }, 1, 0] } },
        },
      },
    ]);

    return successResponse(res, {
      message: "KYC summary fetched",
      data:    toSummaryDTO(agg || {}),
    });
  } catch (err) { next(err) }
};

/**
 * GET /admin/kyc
 * ✅ Fix 3 — Search in DB before pagination
 */
export const listKYCForAdmin = async (req, res, next) => {
  try {
    const admin = req.user;
    const {
      page      = 1,
      limit     = 20,
      status    = "ALL",
      search    = "",
      sortBy    = "submittedAt",
      sortOrder = "desc",
    } = req.query;

    const pageNumber  = Math.max(parseInt(page,  10), 1);
    const limitNumber = Math.min(Math.max(parseInt(limit, 10), 1), 100);
    const skip        = (pageNumber - 1) * limitNumber;

    const ownerIds = await getScopedOwnerIds(admin);

    // ✅ Fix 3 — If search, find matching owners first
    let filteredOwnerIds = ownerIds;
    if (search?.trim()) {
      const s = search.trim();
      const ownerFilter = {
        role:      { $in: ["OWNER"] }, // extend here if role names change
        isDeleted: { $ne: true },
        $or: [
          { name:  { $regex: s, $options: "i" } },
          { phone: { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
        ],
      };
      if (ownerIds) ownerFilter._id = { $in: ownerIds };
      const matchedOwners = await User.find(ownerFilter).select("_id").lean();
      const matchedIds    = matchedOwners.map(o => o._id.toString());
      // Intersection with scope
      filteredOwnerIds = ownerIds
        ? matchedIds.filter(id => ownerIds.includes(id))
        : matchedIds;
    }

    const filter = { isDeleted: { $ne: true } };
    if (filteredOwnerIds) filter.ownerId = { $in: filteredOwnerIds };
    if (status !== "ALL") filter.status  = status;

    const SORT_WHITELIST = ["submittedAt", "createdAt"];
    const sortField = SORT_WHITELIST.includes(sortBy) ? sortBy : "submittedAt";
    const sort = { [sortField]: sortOrder === "asc" ? 1 : -1 };

    const [kycs, total] = await Promise.all([
      KYC.find(filter)
        .populate("ownerId",           "name phone email accountStatus")
        .populate("review.assignedTo", "name adminLevel")
        .populate("review.reviewedBy", "name adminLevel")
        .sort(sort)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      KYC.countDocuments(filter),
    ]);

    return successResponse(res, {
      message: "KYC list fetched",
      data:    kycs.map(toListDTO),
      pagination: {
        page:       pageNumber,
        limit:      limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber) || 1,
      },
    });
  } catch (err) { next(err) }
};

/**
 * GET /admin/kyc/:id
 * ✅ Fix 1 — use req.user consistently
 */
export const getKYCDetail = async (req, res, next) => {
  try {
    const admin = req.user; // ✅ Fix 1 — was undefined before
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
      .populate("ownerId",                   "name phone email accountStatus createdAt")
      .populate("documents.panCard",         "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("documents.aadhaarFront",    "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("documents.aadhaarBack",     "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("documents.cancelledCheque", "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("documents.gstCertificate",  "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("documents.selfie",          "documentType status originalUrl thumbnailUrl version isCurrentVersion rejectedReason createdAt")
      .populate("review.assignedTo",         "name adminLevel")
      .populate("review.reviewedBy",         "name adminLevel")
      .lean();

    if (!kyc) return next(Errors.notFound("KYC not found"));

    // Scope guard
    await assertKYCInScope(kyc, admin);

    const logs = await getKYCLogs(kyc._id);

    return successResponse(res, {
      message: "KYC detail fetched",
      data: {
        ...toDetailDTO(kyc),
        auditLogs: logs.map(l => ({
          id:          l._id,
          action:      l.action,
          source:      l.source,
          field:       l.field       ?? null,
          remarks:     l.remarks     ?? null,
          success:     l.success     ?? true,
          requestId:   l.requestId   ?? null,
          triggeredBy: l.triggeredBy
            ? { id: l.triggeredBy._id, name: l.triggeredBy.name, adminLevel: l.triggeredBy.adminLevel }
            : null,
          createdAt: l.createdAt,
        })),
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/approve
 * ✅ Fix 2 — scope check before write
 */
export const approveKYCHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const errors = validateApprove(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));
    if (kyc.status === KYC_STATUS.VERIFIED) return next(Errors.badRequest("KYC already verified"));

    // ✅ Fix 2 — scope guard
    await assertKYCInScope(kyc, admin);

    const updated = await approveKYC({
      kyc,
      adminId:    admin._id,
      adminLevel: admin.adminLevel,
      notes:      req.body.notes?.trim() || null,
      requestId:  req.requestId ?? null,
    });

    //////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after write)
    //////////////////////////////////////////////////////

    const kycSalon = await Salon.findOne({ ownerId: kyc.ownerId }).select("_id").lean();
    if (kycSalon) {
      await NotificationService.send({
        recipientId:   kycSalon._id,
        recipientType: "SALON",
        templateKey:   NOTIFICATION_EVENTS.KYC_APPROVED,
        variables:     {},
        title:         "KYC Approved ✅",
        message:       "Your KYC verification has been approved.",
        type:          "SYSTEM",
        priority:      "HIGH",
        actionType:    "OPEN_PROFILE",
        actionUrl:     "/kyc",
        meta:          { kycId: updated._id },
      });
    }

    return successResponse(res, {
      message: "KYC approved successfully",
      data: { id: updated._id, status: updated.status, approvedAt: updated.approvedAt, expiresAt: updated.expiresAt },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/reject
 * ✅ Fix 2 — scope check before write
 */
export const rejectKYCHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const errors = validateReject(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));
    if (kyc.status === KYC_STATUS.REJECTED) return next(Errors.badRequest("KYC already rejected"));

    // ✅ Fix 2 — scope guard
    await assertKYCInScope(kyc, admin);

    const updated = await rejectKYC({
      kyc,
      adminId:    admin._id,
      adminLevel: admin.adminLevel,
      reason:     req.body.reason.trim(),
      requestId:  req.requestId ?? null,
    });

    //////////////////////////////////////////////////////
    // 📬 NOTIFICATION (non-blocking, after write)
    //////////////////////////////////////////////////////

    const kycSalon = await Salon.findOne({ ownerId: kyc.ownerId }).select("_id").lean();
    if (kycSalon) {
      await NotificationService.send({
        recipientId:   kycSalon._id,
        recipientType: "SALON",
        templateKey:   NOTIFICATION_EVENTS.KYC_REJECTED,
        variables:     { reason: req.body.reason.trim() },
        title:         "KYC Rejected",
        message:       `Your KYC verification was rejected. Reason: ${req.body.reason.trim()}`,
        type:          "SYSTEM",
        priority:      "HIGH",
        actionType:    "OPEN_PROFILE",
        actionUrl:     "/kyc",
        meta:          { kycId: updated._id },
      });
    }

    return successResponse(res, {
      message: "KYC rejected",
      data: { id: updated._id, status: updated.status, rejectedAt: updated.rejectedAt, reason: req.body.reason.trim() },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/assign
 * ✅ Fix 2 — scope check before write
 */
export const assignKYCHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const errors = validateAssign(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));

    // ✅ Fix 2 — scope guard
    await assertKYCInScope(kyc, admin);

    const updated = await assignKYC({
      kyc,
      assignToId: req.body.assignTo,
      adminId:    admin._id,
      adminLevel: admin.adminLevel,
      requestId:  req.requestId ?? null,
    });

    return successResponse(res, {
      message: "KYC assigned successfully",
      data: { id: updated._id, status: updated.status, assignedTo: updated.review.assignedTo },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/request-reupload
 * ✅ Fix 2 — scope check before write
 */
export const requestReuploadHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const errors = validateRequestReupload(req.body);
    if (errors.length) return next(Errors.badRequest(errors.join(", ")));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));

    // ✅ Fix 2 — scope guard
    await assertKYCInScope(kyc, admin);

    const updated = await requestReupload({
      kyc,
      documentType: req.body.documentType,
      reason:       req.body.reason.trim(),
      adminId:      admin._id,
      adminLevel:   admin.adminLevel,
      requestId:    req.requestId ?? null,
    });

    return successResponse(res, {
      message: "Re-upload requested successfully",
      data: {
        id:           updated._id,
        status:       updated.status,
        documentType: req.body.documentType,
        reason:       req.body.reason.trim(),
      },
    });
  } catch (err) { next(err) }
};

// ─── Phase 6B — Verification Endpoints ───────────────────
/**
 * PATCH /admin/kyc/:id/verify-pan
 */
export const verifyPANHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const { panNumber, nameOnPAN } = req.body;
    if (!panNumber?.trim()) return next(Errors.badRequest("panNumber is required"));
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(panNumber.trim().toUpperCase())) {
      return next(Errors.badRequest("Invalid PAN format. Expected: ABCDE1234F"));
    }

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));
    await assertKYCInScope(kyc, admin);

    const { success, result } = await verifyPAN({
      kyc, panNumber: panNumber.trim().toUpperCase(),
      nameOnPAN: nameOnPAN?.trim() || null,
      adminId: admin._id, adminLevel: admin.adminLevel,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "PAN verified successfully" : "PAN verification failed",
      data: {
        id:          kyc._id,
        status:      kyc.status,
        level:       kyc.verificationLevel,
        panVerified: kyc.verification.pan.verified,
        maskedPAN:   kyc.identity.pan.maskedNumber,
        source:      result.source,
        remarks:     result.remarks,
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/verify-aadhaar
 */
export const verifyAadhaarHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const { last4 } = req.body;
    if (!last4?.trim() || !/^\d{4}$/.test(last4.trim())) {
      return next(Errors.badRequest("last4 must be 4 digits"));
    }

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));
    await assertKYCInScope(kyc, admin);

    const { success, result } = await verifyAadhaar({
      kyc, last4: last4.trim(),
      adminId: admin._id, adminLevel: admin.adminLevel,
      requestId: req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Aadhaar verified successfully" : "Aadhaar verification failed",
      data: {
        id:              kyc._id,
        status:          kyc.status,
        level:           kyc.verificationLevel,
        aadhaarVerified: kyc.verification.aadhaar.verified,
        maskedAadhaar:   kyc.identity.aadhaar.maskedNumber,
        source:          result.source,
        remarks:         result.remarks,
      },
    });
  } catch (err) { next(err) }
};

/**
 * PATCH /admin/kyc/:id/verify-bank
 */
export const verifyBankHandler = async (req, res, next) => {
  try {
    const admin = req.user;
    assertAdminLevel(admin, ["INDIA", "STATE"]);
    if (!isValidId(req.params.id)) return next(Errors.badRequest("Invalid KYC ID"));

    const { accountNumber, ifsc, bankName, accountHolder } = req.body;
    if (!accountNumber?.trim()) return next(Errors.badRequest("accountNumber is required"));
    if (accountNumber.trim().replace(/\D/g,'').length < 9 || accountNumber.trim().replace(/\D/g,'').length > 18) {
      return next(Errors.badRequest("Account number must be 9–18 digits"));
    }
    if (!ifsc?.trim()) return next(Errors.badRequest("ifsc is required"));
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.trim().toUpperCase())) {
      return next(Errors.badRequest("Invalid IFSC format. Expected: ABCD0123456"));
    }
    if (!bankName?.trim())      return next(Errors.badRequest("bankName is required"));
    if (!accountHolder?.trim()) return next(Errors.badRequest("accountHolder is required"));

    const kyc = await KYC.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!kyc) return next(Errors.notFound("KYC not found"));
    await assertKYCInScope(kyc, admin);

    const { success, result } = await verifyBank({
      kyc,
      accountNumber:  accountNumber.trim(),
      ifsc:           ifsc.trim().toUpperCase(),
      bankName:       bankName.trim(),
      accountHolder:  accountHolder.trim(),
      adminId:        admin._id,
      adminLevel:     admin.adminLevel,
      requestId:      req.requestId ?? null,
    });

    return successResponse(res, {
      message: success ? "Bank verified successfully" : "Bank verification failed",
      data: {
        id:            kyc._id,
        status:        kyc.status,
        level:         kyc.verificationLevel,
        bankVerified:  kyc.verification.bank.verified,
        maskedAccount: kyc.bank.maskedAccount,
        pennyDrop:     kyc.bank.pennyDropStatus,
        source:        result.source,
        remarks:       result.remarks,
      },
    });
  } catch (err) { next(err) }
};