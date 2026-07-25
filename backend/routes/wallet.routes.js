import express from "express";
import {
    createTopupOrder,
    getWalletBalance,
    getWalletTransactions,
    mockVerifyTopup,
    verifyTopup,
    walletTopupLimiter,
} from "../controllers/wallet.controller.js";
import { protect } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(protect);

router.get("/balance", getWalletBalance);
router.post("/add-money/create-order", walletTopupLimiter, createTopupOrder);
router.post("/add-money/verify", walletTopupLimiter, verifyTopup);

// Dev-only — see mockVerifyTopup for details. Route itself is safe
// to keep mounted even in prod since the controller 404s itself.
router.post("/add-money/mock-verify", walletTopupLimiter, mockVerifyTopup);

router.get("/transactions", getWalletTransactions);

export default router;