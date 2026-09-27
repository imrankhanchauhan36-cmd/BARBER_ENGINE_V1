/**
 * BARBER ENGINE V1
 * backend/modules/finance/controllers/adminTerritoryRevenue.controller.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. Thin controllers only —
 * all business logic lives in TerritoryRevenueSettingsService.js.
 * adminId is always req.user._id, never client-supplied (matches
 * adminRevenueSettings.controller.js's own convention exactly).
 *
 * Request bodies are RUPEES (minimumPayout) — converted to paise here,
 * at the boundary, same one-way conversion already used by
 * adminRevenueSettings.controller.js.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftTerritoryRevenueSettings,
  listTerritoryRevenueSettings,
  getPublishedTerritoryRevenueSettings,
  updateDraftTerritoryRevenueSettings,
  publishTerritoryRevenueSettings,
  retireTerritoryRevenueSettings,
} from "../services/TerritoryRevenueSettingsService.js";
import { toTerritoryRevenueAdminDTO, toTerritoryRevenueAdminListDTO } from "../dto/territoryRevenue.dto.js";

const rupeesToPaise = (rupees) => (rupees === undefined ? undefined : Math.round(rupees * 100));

export const createDraftTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const version = await createDraftTerritoryRevenueSettings({
      adminId: req.user._id,
      territoryCommissionPercent: req.body.territoryCommissionPercent,
      minimumPayoutInPaise: rupeesToPaise(req.body.minimumPayout),
      req,
    });
    return successResponse(res, { statusCode: 201, message: "Draft territory revenue settings created", data: toTerritoryRevenueAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const listTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const versions = await listTerritoryRevenueSettings({ page: req.query.page, limit: req.query.limit });
    return successResponse(res, { message: "Territory revenue settings fetched", data: toTerritoryRevenueAdminListDTO(versions) });
  } catch (err) {
    return next(err);
  }
};

// The one currently PUBLISHED version. null when none has ever been published.
export const getPublishedTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const version = await getPublishedTerritoryRevenueSettings();
    return successResponse(res, { message: "Published territory revenue settings fetched", data: toTerritoryRevenueAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const version = await updateDraftTerritoryRevenueSettings({
      versionId: req.params.id,
      adminId: req.user._id,
      territoryCommissionPercent: req.body.territoryCommissionPercent,
      minimumPayoutInPaise: rupeesToPaise(req.body.minimumPayout),
      req,
    });
    return successResponse(res, { message: "Draft territory revenue settings updated", data: toTerritoryRevenueAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const publishTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const version = await publishTerritoryRevenueSettings({ versionId: req.params.id, adminId: req.user._id, req });
    return successResponse(res, { message: "Territory revenue settings published", data: toTerritoryRevenueAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};

export const retireTerritoryRevenueHandler = async (req, res, next) => {
  try {
    const version = await retireTerritoryRevenueSettings({ versionId: req.params.id, adminId: req.user._id, req });
    return successResponse(res, { message: "Territory revenue settings retired", data: toTerritoryRevenueAdminDTO(version) });
  } catch (err) {
    return next(err);
  }
};
