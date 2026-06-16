import Salon from "../models/Salon.js";

/**
 * ==================================================
 * 🛡️ ADMIN SCOPE GUARD (ZOMATO / UC STYLE)
 * Enforces: ROLE + SCOPE
 *
 * INDIA admin  → all salons
 * STATE admin  → only same state salons
 * CITY admin   → only same city salons
 *
 * ❌ OTP NOT TOUCHED
 * ❌ ONBOARDING NOT TOUCHED
 * ==================================================
 */
export const requireAdminScopeForSalon = async (req, res, next) => {
  try {
    const admin = req.user;
    const salonId = req.params.id;

    // ❗ FAIL-SAFE — adminLevel must exist
    if (!admin?.adminLevel) {
      return res.status(403).json({
        message: "Admin scope not configured",
      });
    }

    // ✅ INDIA → full access
    if (admin.adminLevel === "INDIA") {
      return next();
    }

    // 🔍 Load only required fields (fast & safe)
    const salon = await Salon.findById(salonId)
      .select("stateRef cityRef")
      .lean();

    if (!salon) {
      return res.status(404).json({
        message: "Salon not found",
      });
    }

    // ✅ STATE scope check
    if (
      admin.adminLevel === "STATE" &&
      salon.stateRef?.toString() !== admin.stateRef?.toString()
    ) {
      return res.status(403).json({
        message: "Out of your state scope",
      });
    }

    // ✅ CITY scope check
    if (
      admin.adminLevel === "CITY" &&
      salon.cityRef?.toString() !== admin.cityRef?.toString()
    ) {
      return res.status(403).json({
        message: "Out of your city scope",
      });
    }

    next();
  } catch (error) {
    console.error("Admin scope check failed:", error);
    return res.status(500).json({
      message: "Scope check failed",
    });
  }
};
