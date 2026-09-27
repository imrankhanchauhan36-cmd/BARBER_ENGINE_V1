/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminRevenueSettings.controller.js
 *
 * P0 Revenue Calculation Engine — Step 2. Thin controllers only — all
 * business logic lives in RevenueSettingsService.js. adminId is always
 * req.user._id, never client-supplied (matches
 * controllers/adminGstPolicy.controller.js's own convention exactly).
 *
 * Request bodies are RUPEES (platformFee, minimumPayout) — converted to
 * paise here, at the boundary, same one-way conversion already used by
 * modules/fieldAgent/controllers/adminRevenueConfig.controller.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftRevenueSettings,
  listRevenueSettings,
  getRevenueSettingsDetail,
  getPublishedRevenueSettings,
  updateDraftRevenueSettings,
  publishRevenueSettings,
  retireRevenueSettings,
} from "../services/RevenueSettingsService.js";
import { toRevenueSettingsAdminDTO, toRevenueSettingsAdminListDTO } from "../dto/revenue.dto.js";

const rupeesToPaise = (rupees) => (rupees === undefined ? undefined : Math.round(rupees * 100));

export const createDraftRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await createDraftRevenueSettings({
      adminId: req.user._id,
      platformFeeInPaise: rupeesToPaise(req.body.platformFee),
      gstRate: req.body.gstRate,
      gstEnabled: req.body.gstEnabled,
      minimumPayoutInPaise: rupeesToPaise(req.body.minimumPayout),
      autoPayoutEnabled: req.body.autoPayoutEnabled,
      req,
    });
    return successResponse(res, { statusCode: 201, message: "Draft revenue settings created", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const listRevenueSettingsHandler = async (req, res, next) => {
  try {
    const versions = await listRevenueSettings({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Revenue settings fetched", data: toRevenueSettingsAdminListDTO(versions) });
  } catch (err) {
    return next(err);
  }
};

export const getRevenueSettingsDetailHandler = async (req, res, next) => {
  try {
    const version = await getRevenueSettingsDetail(req.params.versionId);
    return successResponse(res, { message: "Revenue settings detail fetched", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

// The one currently PUBLISHED version — what a new booking would be
// priced against right now. null when none has ever been published.
export const getPublishedRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await getPublishedRevenueSettings();
    return successResponse(res, { message: "Published revenue settings fetched", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await updateDraftRevenueSettings({
      versionId: req.params.versionId,
      adminId: req.user._id,
      platformFeeInPaise: rupeesToPaise(req.body.platformFee),
      gstRate: req.body.gstRate,
      gstEnabled: req.body.gstEnabled,
      minimumPayoutInPaise: rupeesToPaise(req.body.minimumPayout),
      autoPayoutEnabled: req.body.autoPayoutEnabled,
      req,
    });
    return successResponse(res, { message: "Draft revenue settings updated", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const publishRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await publishRevenueSettings({ versionId: req.params.versionId, adminId: req.user._id, req });
    return successResponse(res, { message: "Revenue settings published", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const retireRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await retireRevenueSettings({ versionId: req.params.versionId, adminId: req.user._id, req });
    return successResponse(res, { message: "Revenue settings retired", data: toRevenueSettingsAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};
