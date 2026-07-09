/**
 * BARBER ENGINE V1
 * backend/controllers/adminMe.controller.js
 * GET /api/admin/me
 */

import User from "../models/User.js";
import { Errors, successResponse } from "../utils/response.js";

export const getAdminMe = async (req, res, next) => {
  try {
    const admin = await User.findById(req.user._id)
      .select(
        "_id name email phone role adminLevel adminSubRole " +
        "countryRef stateRef districtRef cityRef " +
        "profilePhoto isActive accountStatus lastLoginAt createdAt"
      )
      .populate("stateRef",    "name code")
      .populate("districtRef", "name")
      .populate("countryRef",  "name code")
      .lean();

    if (!admin) return next(Errors.notFound("Admin not found"));

    return successResponse(res, {
      message: "Admin profile fetched",
      data:    admin,
    });
  } catch (err) {
    next(err);
  }
};