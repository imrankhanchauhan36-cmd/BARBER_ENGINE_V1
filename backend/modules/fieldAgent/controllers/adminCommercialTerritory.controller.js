/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/adminCommercialTerritory.controller.js
 *
 * FA-5.2 — thin controllers only. adminId is always req.user._id —
 * never client-supplied, matching the identity-derivation convention
 * used everywhere else in this codebase (adminCommercialPolicy.controller.js,
 * adminFieldAgentApproval.controller.js). Admin scoping for reads uses
 * req.user directly (adminLevel/stateRef/districtRef), the same fields
 * adminBooking/adminFinance/adminProvider controllers already rely on.
 */

import { successResponse } from "../../../utils/response.js";
import {
  createDraftTerritory,
  listTerritories,
  getTerritoryDetail,
  updateDraftTerritory,
  activateTerritory,
  suspendTerritory,
  retireTerritory,
  assignPartner,
  vacatePartner,
} from "../services/commercialTerritory.service.js";

export const createDraftTerritoryHandler = async (req, res, next) => {
  try {
    const territory = await createDraftTerritory({ adminId: req.user._id, ...req.body });
    return successResponse(res, { statusCode: 201, message: "Draft Commercial Territory created", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const listTerritoriesHandler = async (req, res, next) => {
  try {
    const result = await listTerritories({
      admin: req.user,
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status,
    });
    return successResponse(res, {
      message: "Commercial Territories fetched",
      data: { territories: result.items },
      pagination: { page: result.page, limit: result.limit, total: result.total },
    });
  } catch (err) {
    return next(err);
  }
};

export const getTerritoryDetailHandler = async (req, res, next) => {
  try {
    const territory = await getTerritoryDetail({ territoryId: req.params.territoryId, admin: req.user });
    return successResponse(res, { message: "Commercial Territory detail fetched", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const updateDraftTerritoryHandler = async (req, res, next) => {
  try {
    const territory = await updateDraftTerritory({ territoryId: req.params.territoryId, adminId: req.user._id, ...req.body });
    return successResponse(res, { message: "Draft Commercial Territory updated", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const activateTerritoryHandler = async (req, res, next) => {
  try {
    const territory = await activateTerritory({ territoryId: req.params.territoryId, adminId: req.user._id });
    return successResponse(res, { message: "Commercial Territory activated", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const suspendTerritoryHandler = async (req, res, next) => {
  try {
    const territory = await suspendTerritory({ territoryId: req.params.territoryId, adminId: req.user._id });
    return successResponse(res, { message: "Commercial Territory suspended", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const retireTerritoryHandler = async (req, res, next) => {
  try {
    const territory = await retireTerritory({ territoryId: req.params.territoryId, adminId: req.user._id });
    return successResponse(res, { message: "Commercial Territory retired", data: { territory } });
  } catch (err) {
    return next(err);
  }
};

export const assignPartnerHandler = async (req, res, next) => {
  try {
    const result = await assignPartner({
      territoryId: req.params.territoryId,
      fieldAgentId: req.body.fieldAgentId,
      adminId: req.user._id,
    });
    return successResponse(res, { message: "Territory Partner assigned", data: result });
  } catch (err) {
    return next(err);
  }
};

export const vacatePartnerHandler = async (req, res, next) => {
  try {
    const result = await vacatePartner({
      territoryId: req.params.territoryId,
      adminId: req.user._id,
      endReason: req.body.endReason,
    });
    return successResponse(res, { message: "Territory Partner vacated", data: result });
  } catch (err) {
    return next(err);
  }
};
