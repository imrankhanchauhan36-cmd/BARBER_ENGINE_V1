import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Booking from "../models/Chair.js";

/**
 * ADMIN – TOTAL PLATFORM REVENUE
 */
export const getAdminRevenueReport = async (req, res) => {
  try {
    const txns = await Transaction.find({ status: "PAID" });

    const totalAmount = txns.reduce((s, t) => s + t.amount, 0);
    const totalCommission = txns.reduce((s, t) => s + t.commission, 0);
    const totalPayout = txns.reduce((s, t) => s + t.payoutAmount, 0);

    return res.json({
      success: true,
      revenue: {
        totalAmount,
        totalCommission,
        totalPayout,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Revenue report failed",
    });
  }
};

/**
 * SALON – WALLET / EARNINGS
 */
export const getSalonEarningsReport = async (req, res) => {
  try {
    const wallet = await SalonEarnings.findOne({
      salonId: req.params.salonId,
    });

    return res.json({
      success: true,
      salonId: req.params.salonId,
      balance: wallet ? wallet.balance : 0,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Salon earnings fetch failed",
    });
  }
};

/**
 * BOOKINGS – DATE RANGE
 */
export const getBookingsReport = async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: "from & to dates required",
      });
    }

    const bookings = await Booking.find({
      bookingDate: {
        $gte: new Date(from),
        $lte: new Date(to),
      },
    });

    return res.json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Bookings report failed",
    });
  }
};
