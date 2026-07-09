/**
 * BARBER ENGINE V1
 * backend/modules/kyc/routes/adminKyc.routes.js
 * Phase 6A + 6B
 */

import express from "express";
import asyncHandler from "express-async-handler";
import {
    approveKYCHandler,
    assignKYCHandler,
    getKYCDetail,
    getKYCSummary,
    listKYCForAdmin,
    rejectKYCHandler,
    requestReuploadHandler,
    verifyAadhaarHandler,
    verifyBankHandler,
    verifyPANHandler,
} from "../controllers/adminKyc.controller.js";

const router = express.Router();

// ── Phase 6A ──────────────────────────────────────────────
router.get  ("/summary",              asyncHandler(getKYCSummary));
router.get  ("/",                     asyncHandler(listKYCForAdmin));
router.get  ("/:id",                  asyncHandler(getKYCDetail));
router.patch("/:id/approve",          asyncHandler(approveKYCHandler));
router.patch("/:id/reject",           asyncHandler(rejectKYCHandler));
router.patch("/:id/assign",           asyncHandler(assignKYCHandler));
router.patch("/:id/request-reupload", asyncHandler(requestReuploadHandler));

// ── Phase 6B ──────────────────────────────────────────────
router.patch("/:id/verify-pan",     asyncHandler(verifyPANHandler));
router.patch("/:id/verify-aadhaar", asyncHandler(verifyAadhaarHandler));
router.patch("/:id/verify-bank",    asyncHandler(verifyBankHandler));

export default router;