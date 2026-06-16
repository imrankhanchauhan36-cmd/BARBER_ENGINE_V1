import PayoutRequest from "../models/PayoutRequest.js";
import SalonEarnings from "../models/SalonEarnings.js";

export const approvePayout = async (req, res) => {
  try {
    const payout = await PayoutRequest.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: "Payout request not found",
      });
    }

    // 🔒 DAY-19 HARD LOCK: double approval block
    if (payout.status !== "REQUESTED") {
      return res.status(409).json({
        success: false,
        message: "Payout already processed",
      });
    }

    const wallet = await SalonEarnings.findOne({
      salonId: payout.salonId,
    });

    // 🔒 WALLET SAFETY
    if (!wallet || wallet.balance < payout.amount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient wallet balance",
      });
    }

    // 🔒 SINGLE DEBIT POINT
    wallet.balance -= payout.amount;
    await wallet.save();

    // 🧾 DAY-20 AUDIT FIELDS (NEW)
    payout.approvedBy = req.adminId || null; // admin ID from auth
    payout.approvedAt = new Date();

    // 🔒 FINAL STATE
    payout.status = "PAID";
    await payout.save();

    return res.json({
      success: true,
      payoutId: payout._id,
      remainingBalance: wallet.balance,
      message: "Payout approved safely",
    });
  } catch (err) {
    console.error("APPROVE PAYOUT ERROR:", err);
    return res.status(500).json({ success: false });
  }
};

// ❌ DAY-20 me bhi isko touch nahi karna
export const rejectPayout = async (req, res) => {
  try {
    const payout = await PayoutRequest.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({
        success: false,
        message: "Payout request not found",
      });
    }

    if (payout.status !== "REQUESTED") {
      return res.status(400).json({
        success: false,
        message: "Payout already processed",
      });
    }

    payout.status = "REJECTED";
    await payout.save();

    return res.json({
      success: true,
      message: "Payout rejected",
    });
  } catch (err) {
    console.error("REJECT PAYOUT ERROR:", err);
    return res.status(500).json({ success: false });
  }
};