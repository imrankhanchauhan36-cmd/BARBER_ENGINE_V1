/**
 * BARBER ENGINE V1
 * admin-panel/src/config/adminRoles.js
 * Centralized Admin Role Permissions — Single Source of Truth
 * Keep this in sync with backend requireAdminLevel() middleware
 */

// ─── Role Hierarchy ───────────────────────────────────────
export const ADMIN_LEVELS = {
  INDIA:    "INDIA",
  STATE:    "STATE",
  DISTRICT: "DISTRICT",
}

// ─── Permission Helpers ───────────────────────────────────
// These MUST match backend requireAdminLevel() calls in admin.routes.js

export const canApproveKYC  = (l) => ["INDIA", "STATE"].includes(l)
export const canRejectKYC   = (l) => ["INDIA", "STATE"].includes(l)
export const canManageStaff = (l) => ["INDIA", "STATE"].includes(l)
export const canManageSalon = (l) => ["INDIA", "STATE", "DISTRICT"].includes(l)
export const canExport      = (l) => ["INDIA", "STATE"].includes(l)
export const canViewPII     = (l) => ["INDIA", "STATE"].includes(l)
export const canTransferStaff = (l) => ["INDIA"].includes(l)
export const canSetCommission = (l) => ["INDIA"].includes(l)