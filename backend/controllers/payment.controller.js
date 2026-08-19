import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  verifyRazorpaySignature,
} from "../services/Razorpay.service.js";

//////////////////////////////////////////////////////////////
// 1. CREATE ORDER
// POST /api/payment/create-order
//
// SECURITY FIX: amount is NEVER trusted from the frontend.
// We look up the booking's stored totalAmountInPaise instead —
// otherwise a user could send { "amount": 1 } and pay ₹1 for a
// ₹1000 booking.
//
// Body:
// {
//   "bookingId": "64a1b2c3d4e5f6a7b8c9d0e1"
// }
//
// Returns:
// {
//   "success": true,
//   "orderId": "order_OFh27vVXrGEz3k",
//   "amount":  99900,   // paise
//   "currency": "INR"
// }
//////////////////////////////////////////////////////////////

export const createOrder = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId || !mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: "Valid bookingId is required",
      });
    }

    const booking = await Booking.findById(bookingId, {
      totalAmountInPaise: 1,
      userRef: 1,
      status: 1,
    }).lean();

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Ensure the booking belongs to the requesting user
    if (req.user?._id && String(booking.userRef) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to pay for this booking",
      });
    }

    if (!booking.totalAmountInPaise || booking.totalAmountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Booking has an invalid amount",
      });
    }

    const order = await createRazorpayOrder({
      amountInPaise: booking.totalAmountInPaise,
      receipt: `booking_${bookingId}`,
      notes: { bookingId },
    });

    return res.json({
      success: true,
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
    });
  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Order creation failed",
    });
  }
};

//////////////////////////////////////////////////////////////
// 2. VERIFY PAYMENT
// POST /api/payment/verify
//
// Lightweight signature check only — does NOT touch booking,
// wallet, or ledger. Booking confirmation still happens via
// the existing /v1/bookings/user/confirm route, which already
// runs this same verification internally.
//
// Useful for: Postman testing, and an optional frontend
// pre-check before calling confirmBooking().
//
// Body:
// {
//   "orderId":   "order_OFh27vVXrGEz3k",
//   "paymentId": "pay_OFh27vVXrGEz3k",
//   "signature": "abc123...hex"
// }
//////////////////////////////////////////////////////////////

export const verifyPayment = async (req, res) => {
  try {
    const { orderId, paymentId, signature } = req.body;

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({
        success: false,
        message: "orderId, paymentId and signature are all required",
      });
    }

    const isValid = verifyRazorpaySignature({ orderId, paymentId, signature });

    if (!isValid) {
      return res.status(400).json({
        success: false,
        verified: false,
        message: "Invalid payment signature",
      });
    }

    return res.json({
      success: true,
      verified: true,
      message: "Payment signature verified",
    });
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Payment verification failed",
    });
  }
};

//////////////////////////////////////////////////////////////
// 3. GET PAYMENT STATUS
// GET /api/payment/status/:paymentId
//
// Admin / troubleshooting use — fetches live status from Razorpay.
//////////////////////////////////////////////////////////////

export const getPaymentStatus = async (req, res) => {
  try {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "paymentId is required",
      });
    }

    const payment = await fetchRazorpayPayment(paymentId);

    return res.json({
      success: true,
      paymentId:  payment.id,
      status:     payment.status, // created | authorized | captured | failed | refunded
      amount:     payment.amount,
      method:     payment.method,
      captured:   payment.captured,
      email:      payment.email,
      contact:    payment.contact,
      created_at: payment.created_at,
    });
  } catch (error) {
    console.error("GET PAYMENT STATUS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Could not fetch payment status",
    });
  }
};

//////////////////////////////////////////////////////////////
// MOCK PAYMENT CONTROLLER
// Dev / Testing purpose only
// Simulates successful payment like Zomato before booking
// — kept as-is, do not delete.
//////////////////////////////////////////////////////////////

export const mockPayment = async (req, res) => {
  // Same production gate as mockVerifyTopup (controllers/wallet.controller.js) —
  // a mock/fake-success payment endpoint must never be reachable in production.
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ success: false, message: "Not found" });
  }

  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount",
      });
    }

    // 🔒 Always success (mock)
    return res.json({
      success: true,
      paymentConfirmed: true,
      paymentRef: "MOCK_PAY_" + Date.now(),
      amount,
    });
  } catch (error) {
    console.error("MOCK PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Mock payment failed",
    });
  }
};