import AdminAuditLog from "../models/AdminAuditLog.js";

export const logAdminAction = async ({
  adminId,
  action,
  targetType,
  targetId,
  meta = {},
}) => {
  try {
    await AdminAuditLog.create({
      adminId,
      action,
      targetType,
      targetId,
      meta,
    });
  } catch (err) {
    console.error("Audit log failed:", err.message);
  }
};
