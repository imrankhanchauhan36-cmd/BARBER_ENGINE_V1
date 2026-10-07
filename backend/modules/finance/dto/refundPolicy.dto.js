/**
 * BARBER ENGINE V1
 * backend/modules/finance/dto/refundPolicy.dto.js
 *
 * Global Refund & Cancellation Policy. Pure mapping only. No DB
 * access, no business logic, no side effects. Rules are already in
 * minutes/percent — no paise<->rupees conversion needed here.
 *
 * cancellationPercent is the CANCELLATION/RETENTION percentage (what
 * is forfeited), NOT the customer refund percentage — see
 * RefundPolicyVersion.js's own header.
 */

export const toRefundPolicyAdminDTO = (version) => {
  if (!version) return null;
  return {
    id: version._id,
    version: version.version,
    rules: (version.rules || []).map((r) => ({
      minMinutes: r.minMinutes,
      maxMinutes: r.maxMinutes,
      cancellationPercent: r.cancellationPercent,
    })),
    status: version.status,
    createdBy: version.createdBy ?? null,
    publishedBy: version.publishedBy ?? null,
    retiredBy: version.retiredBy ?? null,
    publishedAt: version.publishedAt ?? null,
    retiredAt: version.retiredAt ?? null,
    createdAt: version.createdAt ?? null,
    updatedAt: version.updatedAt ?? null,
  };
};

export const toRefundPolicyAdminListDTO = (versions) => versions.map(toRefundPolicyAdminDTO);
