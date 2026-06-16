import express from "express";
import { requestWithdrawal } from "../controllers/payout.controller.js";
import {
  approvePayout,
  rejectPayout,
} from "../controllers/adminPayout.controller.js";

const router = express.Router();

// Salon
router.post("/withdraw", requestWithdrawal);

// Admin
router.post("/admin/approve/:id", approvePayout);
router.post("/admin/reject/:id", rejectPayout);

export default router;
