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
export const canVerifyBank  = (l) => ["INDIA", "STATE"].includes(l) // matches PATCH /admin/kyc/:id/verify-bank
export const canVerifyPAN     = (l) => ["INDIA", "STATE"].includes(l) // matches PATCH /admin/kyc/:id/verify-pan
export const canVerifyAadhaar = (l) => ["INDIA", "STATE"].includes(l) // matches PATCH /admin/kyc/:id/verify-aadhaar
export const canManageStaff = (l) => ["INDIA", "STATE"].includes(l)
export const canResolveDispute = (l) => ["INDIA", "STATE"].includes(l) // no backend endpoint yet — reserved for when /admin/disputes exists
export const canAssignDispute  = (l) => ["INDIA", "STATE"].includes(l) // no backend endpoint yet — reserved for when /admin/disputes exists
export const canManageSalon = (l) => ["INDIA", "STATE", "DISTRICT"].includes(l)
export const canExport      = (l) => ["INDIA", "STATE"].includes(l)
export const canViewPII     = (l) => ["INDIA", "STATE"].includes(l)
export const canTransferStaff = (l) => ["INDIA"].includes(l)
export const canSetCommission = (l) => ["INDIA"].includes(l)
export const canFreezeWallet  = (l) => ["INDIA"].includes(l) // matches PATCH /admin/finance/wallets/:id/freeze
export const canViewPayouts   = (l) => ["INDIA", "STATE"].includes(l) // matches GET /payouts/admin/list|summary|detail
export const canApprovePayout = (l) => ["INDIA", "STATE"].includes(l) // matches PATCH /payouts/admin/approve/:id
export const canRejectPayout  = (l) => ["INDIA", "STATE"].includes(l) // matches PATCH /payouts/admin/reject/:id
export const canBroadcastNotification    = (l) => ["INDIA"].includes(l) // no backend endpoint yet — reserved for admin notification broadcast system
export const canSendTargetedNotification = (l) => ["INDIA", "STATE"].includes(l) // no backend endpoint yet — reserved for admin notification broadcast system
export const canExportNotifications      = (l) => ["INDIA"].includes(l) // no backend endpoint yet — reserved for admin notification broadcast system