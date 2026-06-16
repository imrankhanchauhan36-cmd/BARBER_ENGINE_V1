/**
 * ==================================================
 * 🛡️ REQUIRE ADMIN LEVEL MIDDLEWARE (FINAL)
 *
 * Allows only specific admin levels to access a route
 * Example:
 *   requireAdminLevel("INDIA")
 *   requireAdminLevel("INDIA", "STATE")
 *
 * Protects against:
 * - Missing adminLevel
 * - Case mismatch bugs
 * - Unauthenticated access
 * ==================================================
 */

export const requireAdminLevel = (...allowedLevels) => {
  return (req, res, next) => {
    const admin = req.user;

    // ❗ Must be authenticated ADMIN
    if (!admin || admin.role !== "ADMIN") {
      return res.status(403).json({
        message: "Admin access required",
      });
    }

    // ❗ Fail-safe: adminLevel must exist
    if (!admin.adminLevel) {
      return res.status(403).json({
        message: "Admin level not configured",
      });
    }

    // ✅ Normalize for case-safe comparison
    const currentLevel = String(admin.adminLevel).toUpperCase();
    const normalizedAllowed = allowedLevels.map((lvl) =>
      String(lvl).toUpperCase()
    );

    if (!normalizedAllowed.includes(currentLevel)) {
      return res.status(403).json({
        message: "Insufficient admin privileges",
      });
    }

    next();
  };
};
