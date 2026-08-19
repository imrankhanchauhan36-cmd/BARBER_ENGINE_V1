import Transaction from "../models/Transaction.js";
import SalonEarnings from "../models/SalonEarnings.js";
import Booking from "../models/Chair.js";
import Salon from "../models/Salon.js";

/**
 * Resolves the set of salon IDs an ADMIN is authorized to see.
 * Same convention already used in admin.controller.js / adminUser.controller.js /
 * adminStaff.controller.js / modules/kyc/controllers/adminKyc.controller.js:
 *   INDIA    → no restriction (returns null)
 *   STATE    → salons whose location.territory.stateRef matches admin.stateRef
 *   DISTRICT → salons whose location.territory.districtRef matches admin.districtRef
 *
 * Returns null for "no filter needed" so callers can spread it into a
 * Mongo query only when it's actually present.
 */
const resolveAuthorizedSalonIds = async (admin) => {
  if (admin.adminLevel === "INDIA") return null;

  const salonFilter = { isDeleted: { $ne: true } };
  if (admin.adminLevel === "STATE") {
    salonFilter["location.territory.stateRef"] = admin.stateRef;
  } else if (admin.adminLevel === "DISTRICT") {
    salonFilter["location.territory.districtRef"] = admin.districtRef;
  } else {
    // Unrecognized/unset adminLevel — fail closed, not open.
    return [];
  }

  const salons = await Salon.find(salonFilter).select("_id").lean();
  return salons.map((s) => s._id.toString());
};

/**
 * ADMIN – TOTAL PLATFORM REVENUE
 */
export const getAdminRevenueReport = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) {
      return res.status(403).json({ success: false, message: "Admin scope not configured" });
    }

    const salonIds = await resolveAuthorizedSalonIds(admin);

    const filter = { status: "PAID" };
    if (salonIds !== null) filter.salonId = { $in: salonIds };

    const txns = await Transaction.find(filter);

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
 *
 * OWNER: only their own salon.
 * ADMIN: only a salon inside their authorized territory.
 * Any other role never reaches this controller (route-level requireRole).
 */
export const getSalonEarningsReport = async (req, res) => {
  try {
    const requester = req.user;
    const { salonId } = req.params;

    const salon = await Salon.findOne({ _id: salonId, isDeleted: { $ne: true } })
      .select("ownerId location.territory.stateRef location.territory.districtRef")
      .lean();

    if (!salon) {
      return res.status(404).json({ success: false, message: "Salon not found" });
    }

    if (requester.role === "OWNER") {
      if (salon.ownerId?.toString() !== requester._id.toString()) {
        return res.status(403).json({ success: false, message: "Not your salon" });
      }
    } else if (requester.role === "ADMIN") {
      if (!requester.adminLevel) {
        return res.status(403).json({ success: false, message: "Admin scope not configured" });
      }
      if (requester.adminLevel === "STATE") {
        if (salon.location?.territory?.stateRef?.toString() !== requester.stateRef?.toString()) {
          return res.status(403).json({ success: false, message: "Out of your state scope" });
        }
      } else if (requester.adminLevel === "DISTRICT") {
        if (salon.location?.territory?.districtRef?.toString() !== requester.districtRef?.toString()) {
          return res.status(403).json({ success: false, message: "Out of your district scope" });
        }
      } else if (requester.adminLevel !== "INDIA") {
        return res.status(403).json({ success: false, message: "Admin scope not configured" });
      }
    } else {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const wallet = await SalonEarnings.findOne({ salonId });

    return res.json({
      success: true,
      salonId,
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
 * ADMIN only (route-level requireRole/requireAdminLevel); STATE/DISTRICT
 * admins are further constrained here to their own authorized salons.
 */
export const getBookingsReport = async (req, res) => {
  try {
    const admin = req.user;
    if (!admin?.adminLevel) {
      return res.status(403).json({ success: false, message: "Admin scope not configured" });
    }

    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        success: false,
        message: "from & to dates required",
      });
    }

    const salonIds = await resolveAuthorizedSalonIds(admin);

    const filter = {
      bookingDate: {
        $gte: new Date(from),
        $lte: new Date(to),
      },
    };
    if (salonIds !== null) filter.salonId = { $in: salonIds };

    const bookings = await Booking.find(filter);

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
