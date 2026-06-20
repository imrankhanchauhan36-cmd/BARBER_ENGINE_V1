import express from "express";
import {
  getDashboardAnalytics,
  getCustomersList,
  getCustomerDetail,
  getCustomerHistory,
} from "../controllers/customer.controller.js";

const router = express.Router();

router.get("/analytics",       getDashboardAnalytics);
router.get("/",                getCustomersList);
router.get("/:userId",         getCustomerDetail);
router.get("/:userId/history", getCustomerHistory);

export default router;
