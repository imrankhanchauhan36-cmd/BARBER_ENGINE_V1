import express from "express";
import asyncHandler from "express-async-handler";

// ── Controllers ───────────────────────────────────────────
import {
  forceCloseSalon,
  listSalonsForAdmin,
  setSalonCommission,
  updateSalonStatus,
} from "../controllers/admin.controller.js";
import {
  adminCancelBooking,
  adminUpdateBookingStatus,
  getBookingDetail,
  getBookingsSummary,
  listBookingsForAdmin,
} from "../controllers/adminBooking.controller.js";
import {
  freezeWallet,
  getFinanceSummary,
  getRevenueTrend,
  getSalonLedger,
  getStatePerformance,
  getTopSalons,
  getWalletDetail,
  listTransactions,
  listWallets
} from "../controllers/adminFinance.controller.js";
import { getAdminMe } from "../controllers/adminMe.controller.js";
import {
  getProviderDetail,
  getProvidersSummary,
  listProvidersForAdmin,
  updateProviderStatus,
} from "../controllers/adminProvider.controller.js";
import {
  assignStaffChair,
  getStaffDetail,
  getStaffSummary,
  listStaffForAdmin,
  transferStaff,
  updateStaffStatus,
} from "../controllers/adminStaff.controller.js";
import {
  getUserDetail,
  getUsersSummary,
  listUsersForAdmin,
  updateUserStatus,
} from "../controllers/adminUser.controller.js";
import { getSalonDetail } from "../controllers/salonDetail.controller.js";

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
} from "../modules/kyc/controllers/adminKyc.controller.js";

import {
  createStateWithAdmin,
  getStates,
} from "../controllers/state.controller.js";

import {
  assignDistrictAdmin,
  createDistrictWithAdmin,
  deleteDistrict,
  getDistrictAnalytics,
  getDistrictAuditLog,
  getDistrictById,
  getDistricts,
  getDistrictSummary,
  restoreDistrict,
  updateDistrict,
} from "../controllers/district.controller.js";

import {
  createArea,
  createCity,
  deleteArea,
  deleteCity,
  getAreaById,
  getAreas,
  getCities,
  getCityById,
  updateArea,
  updateCity,
} from "../controllers/location.controller.js";

import {
  assignStateBackupAdmin,
  deleteState,
  getStateAnalytics,
  getStateById,
  getStateSummary,
  restoreState,
  updateState,
} from "../controllers/state.controller.js";


// ── Middlewares ───────────────────────────────────────────
import { protect } from "../middlewares/auth.middleware.js";
import { requireAdminLevel } from "../middlewares/requireAdminLevel.js";
import { requireRole } from "../middlewares/role.middleware.js";

const router = express.Router();

// ── Global Admin Lock ─────────────────────────────────────
router.use(protect, requireRole("ADMIN"));

// ── Auth ──────────────────────────────────────────────────
router.get("/me", asyncHandler(getAdminMe));

// ── Dashboard (stub) ──────────────────────────────────────
router.get("/dashboard", asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: { totalSalons:0, activeSalons:0, pendingApprovals:0, todaysBookings:0, totalRevenue:0 },
  });
}));

// ── States ────────────────────────────────────────────────
router.post("/states", requireAdminLevel("INDIA"),                      asyncHandler(createStateWithAdmin));
router.get ("/states", requireAdminLevel("INDIA","STATE","DISTRICT"),   asyncHandler(getStates));

router.get   ("/states/:id",         requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStateById));
router.get   ("/states/:id/summary", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStateSummary));
router.get   ("/states/:id/analytics", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStateAnalytics));
router.patch ("/states/:id",         requireAdminLevel("INDIA"),                    asyncHandler(updateState));
router.delete("/states/:id",         requireAdminLevel("INDIA"),                    asyncHandler(deleteState));
router.patch ("/states/:id/restore",   requireAdminLevel("INDIA"),                    asyncHandler(restoreState));
router.post  ("/states/:id/backup-admin",requireAdminLevel("INDIA"),                    asyncHandler(assignStateBackupAdmin));

// ── Districts ─────────────────────────────────────────────


router.post ("/districts",             requireAdminLevel("INDIA","STATE"),            asyncHandler(createDistrictWithAdmin));
router.get  ("/districts",             requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistricts));
router.get  ("/districts/:id",         requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistrictById));
router.get  ("/districts/:id/summary", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getDistrictSummary));
router.get  ("/districts/:id/analytics",requireAdminLevel("INDIA","STATE","DISTRICT"),asyncHandler(getDistrictAnalytics));
router.get  ("/districts/:id/audit",    requireAdminLevel("INDIA","STATE","DISTRICT"),asyncHandler(getDistrictAuditLog));
router.patch("/districts/:id",         requireAdminLevel("INDIA","STATE"),            asyncHandler(updateDistrict));
router.post ("/districts/:id/admin",   requireAdminLevel("INDIA","STATE"),            asyncHandler(assignDistrictAdmin));
router.delete("/districts/:id",        requireAdminLevel("INDIA"),                    asyncHandler(deleteDistrict));
router.patch("/districts/:id/restore", requireAdminLevel("INDIA"),                    asyncHandler(restoreDistrict));

// ── Cities ────────────────────────────────────────────────
router.get   ("/cities",             requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getCities));
router.get   ("/cities/:id",         requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getCityById));
router.post  ("/cities",             requireAdminLevel("INDIA","STATE"),            asyncHandler(createCity));
router.patch ("/cities/:id",         requireAdminLevel("INDIA","STATE"),            asyncHandler(updateCity));
router.delete("/cities/:id",         requireAdminLevel("INDIA"),                    asyncHandler(deleteCity));


// ── Areas ─────────────────────────────────────────────────
router.get   ("/areas",              requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getAreas));
router.get   ("/areas/:id",          requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getAreaById));
router.post  ("/areas",              requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(createArea));
router.patch ("/areas/:id",          requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(updateArea));
router.delete("/areas/:id",          requireAdminLevel("INDIA","STATE"),            asyncHandler(deleteArea));


// ── Admin Management ──────────────────────────────────────

// ── Salons ────────────────────────────────────────────────
router.get  ("/salons",                requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listSalonsForAdmin));
router.get  ("/salons/:id",            requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getSalonDetail));
router.patch("/salons/:id/status",     requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(updateSalonStatus));
router.patch("/salons/:id/commission", requireAdminLevel("INDIA"),                    asyncHandler(setSalonCommission));
router.patch("/salons/:id/force-close",requireAdminLevel("INDIA","STATE"),            asyncHandler(forceCloseSalon));

// ── Users ─────────────────────────────────────────────────
router.get  ("/users/summary",    requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getUsersSummary));
router.get  ("/users",            requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listUsersForAdmin));
router.get  ("/users/:id",        requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getUserDetail));
router.patch("/users/:id/status", requireAdminLevel("INDIA","STATE"),            asyncHandler(updateUserStatus));

// ── Bookings ──────────────────────────────────────────────
router.get  ("/bookings/summary",    requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getBookingsSummary));
router.get  ("/bookings",            requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listBookingsForAdmin));
router.get  ("/bookings/:id",        requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getBookingDetail));
router.patch("/bookings/:id/cancel", requireAdminLevel("INDIA","STATE"),            asyncHandler(adminCancelBooking));
router.patch("/bookings/:id/status", requireAdminLevel("INDIA","STATE"),            asyncHandler(adminUpdateBookingStatus));

// ── Staff ─────────────────────────────────────────────────
router.get  ("/staff/summary",    requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStaffSummary));
router.get  ("/staff",            requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listStaffForAdmin));
router.get  ("/staff/:id",        requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStaffDetail));
router.patch("/staff/:id/status", requireAdminLevel("INDIA","STATE"),            asyncHandler(updateStaffStatus));
router.patch("/staff/:id/chair",  requireAdminLevel("INDIA","STATE"),            asyncHandler(assignStaffChair));
router.patch("/staff/:id/salon",  requireAdminLevel("INDIA"),                    asyncHandler(transferStaff));

// ── Providers ─────────────────────────────────────────────
router.get  ("/providers/summary",    requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getProvidersSummary));
router.get  ("/providers",            requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listProvidersForAdmin));
router.get  ("/providers/:id",        requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getProviderDetail));
router.patch("/providers/:id/status", requireAdminLevel("INDIA","STATE"),            asyncHandler(updateProviderStatus));

// ── KYC — Phase 6A ───────────────────────────────────────
router.get  ("/kyc/summary",              requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getKYCSummary));
router.get  ("/kyc",                      requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listKYCForAdmin));
router.get  ("/kyc/:id",                  requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getKYCDetail));
router.patch("/kyc/:id/approve",          requireAdminLevel("INDIA","STATE"),            asyncHandler(approveKYCHandler));
router.patch("/kyc/:id/reject",           requireAdminLevel("INDIA","STATE"),            asyncHandler(rejectKYCHandler));
router.patch("/kyc/:id/assign",           requireAdminLevel("INDIA","STATE"),            asyncHandler(assignKYCHandler));
router.patch("/kyc/:id/request-reupload", requireAdminLevel("INDIA","STATE"),            asyncHandler(requestReuploadHandler));

// ── KYC — Phase 6B (Verification) ────────────────────────
router.patch("/kyc/:id/verify-pan",     requireAdminLevel("INDIA","STATE"), asyncHandler(verifyPANHandler));
router.patch("/kyc/:id/verify-aadhaar", requireAdminLevel("INDIA","STATE"), asyncHandler(verifyAadhaarHandler));
router.patch("/kyc/:id/verify-bank",    requireAdminLevel("INDIA","STATE"), asyncHandler(verifyBankHandler));

// ── Finance ──────────────────────────────────────────────
router.get("/finance/summary",          requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getFinanceSummary));
router.get("/finance/analytics/revenue-trend", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getRevenueTrend));
router.get("/finance/analytics/states",         requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getStatePerformance));
router.get("/finance/analytics/top-salons",     requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getTopSalons));
router.get("/finance/wallets",          requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listWallets));
router.get("/finance/wallets/:salonId", requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(getWalletDetail));
router.get("/finance/transactions",     requireAdminLevel("INDIA","STATE","DISTRICT"), asyncHandler(listTransactions));
router.get  ("/finance/ledger/:salonId",  requireAdminLevel("INDIA","STATE"),            asyncHandler(getSalonLedger));
router.patch("/finance/wallets/:id/freeze", requireAdminLevel("INDIA"),                   asyncHandler(freezeWallet));

// ── 404 ───────────────────────────────────────────────────
router.use((req, res) => {
  res.status(404).json({ success: false, message: "Admin route not found" });
});

export default router;