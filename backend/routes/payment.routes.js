import express from "express";
import {
    createOrder,
    getPaymentStatus,
    mockPayment,
    verifyPayment,
} from "../controllers/payment.controller.js";

const router = express.Router();

router.post("/create-order", createOrder);

router.post("/verify", verifyPayment);

router.get("/status/:paymentId", getPaymentStatus);

router.post("/mock", mockPayment);

export default router;