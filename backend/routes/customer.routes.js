import express from "express";
import { requireRole } from "../middlewares/role.middleware.js";
import {
  getDashboardAnalytics,
  getCustomersList,
  getCustomerDetail,
  getCustomerHistory,
} from "../controllers/customer.controller.js";

const router = express.Router();

// protect() is already applied at the app.js mount level
// (app.use("/api/customers", protect, onboardingBypass, customerRoutes)).
// requireRole("OWNER") makes the existing owner-only intent explicit at
// the route instead of relying solely on getOwnerSalonIds() resolving to
// an empty salon list for non-owners.
router.get("/analytics",       requireRole("OWNER"), getDashboardAnalytics);
router.get("/",                requireRole("OWNER"), getCustomersList);
router.get("/:userId",         requireRole("OWNER"), getCustomerDetail);
router.get("/:userId/history", requireRole("OWNER"), getCustomerHistory);

export default router;
