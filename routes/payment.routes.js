import express from "express";
import { mockPayment } from "../controllers/payment.controller.js";

const router = express.Router();

// 💳 Mock payment (DEV only)
router.post("/mock", mockPayment);

export default router;
