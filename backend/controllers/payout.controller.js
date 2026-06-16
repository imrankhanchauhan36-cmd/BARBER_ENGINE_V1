import PayoutRequest from "../models/PayoutRequest.js";
import SalonEarnings from "../models/SalonEarnings.js";

export const requestWithdrawal = async (req, res) => {
  try {
    const { salonId, amount } = req.body;

    if (!salonId || !amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid withdrawal request",
      });
    }

    const wallet = await SalonEarnings.findOne({ salonId });

    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
      });
    }

    const request = await PayoutRequest.create({
      salonId,
      amount,
    });

    return res.json({
      success: true,
      payoutRequestId: request._id,
      message: "Withdrawal request submitted",
    });
  } catch (err) {
    console.error("WITHDRAW ERROR:", err);
    return res.status(500).json({ success: false });
  }
};
