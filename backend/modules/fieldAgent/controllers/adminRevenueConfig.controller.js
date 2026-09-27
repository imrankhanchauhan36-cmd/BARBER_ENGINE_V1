/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminRevenueConfig.controller.js
 *
 * FA-P3-A — Revenue Configuration Engine, Phase 1. Thin controllers
 * only — all orchestration lives in revenueConfig.service.js. Rupee ->
 * paise conversion happens HERE (the HTTP boundary), never inside the
 * service, matching this codebase's existing convention of services
 * working exclusively in paise.
 */

import { successResponse } from "../../../utils/response.js";
import {
  getRevenueSettings,
  updateRevenueSettings,
  listRevenueTerritories,
  updateRevenueTerritory,
} from "../services/revenueConfig.service.js";
import { toRevenueSettingsDTO, toTerritoryListDTO, toTerritoryRowDTO } from "../dto/revenueConfig.dto.js";

const rupeesToPaise = (rupees) => (rupees === undefined ? undefined : Math.round(rupees * 100));

export const getRevenueSettingsHandler = async (req, res, next) => {
  try {
    const version = await getRevenueSettings();
    return successResponse(res, { message: "Revenue settings fetched", data: toRevenueSettingsDTO(version) });
  } catch (err) { next(err) }
};

export const updateRevenueSettingsHandler = async (req, res, next) => {
  try {
    const { acquisitionReward, recoveryPercentage, minimumPayout, autoPayoutEnabled } = req.body;
    const updated = await updateRevenueSettings({
      adminId: req.user._id,
      acquisitionRewardInPaise: rupeesToPaise(acquisitionReward),
      recoveryPercentage,
      minimumPayoutInPaise: rupeesToPaise(minimumPayout),
      autoPayoutEnabled,
    });
    return successResponse(res, { message: "Revenue settings updated", data: toRevenueSettingsDTO(updated) });
  } catch (err) { next(err) }
};

export const listRevenueTerritoriesHandler = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await listRevenueTerritories({ page, limit });
    return successResponse(res, { message: "Revenue territories fetched", data: toTerritoryListDTO(result) });
  } catch (err) { next(err) }
};

export const updateRevenueTerritoryHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { territoryPercent } = req.body;
    const row = await updateRevenueTerritory({
      areaId: id,
      adminId: req.user._id,
      territoryPartnerCommissionPercent: territoryPercent,
    });
    return successResponse(res, { message: "Territory commission updated", data: toTerritoryRowDTO(row) });
  } catch (err) { next(err) }
};
