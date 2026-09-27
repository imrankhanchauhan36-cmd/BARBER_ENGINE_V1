/**
 * BARBER ENGINE V1
 * backend/modules/finance/dto/revenue.dto.js
 *
 * P0 Revenue Calculation Engine — Step 1. Shapes
 * RevenueCalculationService.calculateRevenue()'s internal result into the
 * exact "Split Engine Output" field names the LOCKED spec documents
 * (serviceAmount / convenienceFee / gstAmount / customerPaid /
 * salonCredit / zemishRevenue / gstLiability / policyVersion) — the
 * external contract a future controller/Settlement Engine consumes.
 *
 * Pure mapping only. No DB access, no calculation logic (that stays in
 * RevenueCalculationService, the single source of truth for the numbers
 * themselves), no side effects.
 */

/**
 * @param {import("../services/RevenueCalculationService.js").RevenueCalculationResult} result
 * @returns the LOCKED "Split Engine Output" shape (amounts in paise)
 */
export const toRevenueCalculationDTO = (result) => ({
  serviceAmount: result.serviceAmountInPaise,
  convenienceFee: result.platformFeeInPaise,
  gstAmount: result.gstAmountInPaise,
  customerPaid: result.customerPaidInPaise,

  salonCredit: result.salonCreditInPaise,
  zemishRevenue: result.zemishRevenueInPaise,
  gstLiability: result.gstAmountInPaise,

  policyVersion: result.policyVersion,
});

/**
 * Shapes a calculateRevenue() result into the exact field names
 * modules/finance/models/RevenueSplit.js expects for persistence.
 * Still performs no DB write — a future caller passes this straight to
 * `RevenueSplit.create({ bookingId, ...toRevenueSplitDocumentDTO(result) })`.
 *
 * @param {import("../services/RevenueCalculationService.js").RevenueCalculationResult} result
 */
export const toRevenueSplitDocumentDTO = (result) => ({
  serviceAmountInPaise: result.serviceAmountInPaise,
  platformFeeInPaise: result.platformFeeInPaise,
  gstRatePercent: result.gstRatePercent,
  gstAmountInPaise: result.gstAmountInPaise,
  customerPaidInPaise: result.customerPaidInPaise,
  salonCreditInPaise: result.salonCreditInPaise,
  zemishRevenueInPaise: result.zemishRevenueInPaise,
  policyVersion: result.policyVersion,
});

/**
 * P0 Revenue Calculation Engine — Step 2. Shapes a RevenueSettings
 * document for the admin panel: paise -> rupees for display, same
 * one-way conversion convention already used by
 * modules/fieldAgent/dto/revenueConfig.dto.js (requests convert
 * rupees -> paise at the controller/validator boundary, never here).
 */
const paiseToRupees = (paise) => (paise == null ? null : Math.round(paise) / 100);

export const toRevenueSettingsAdminDTO = (version) => {
  if (!version) return null;
  return {
    id: version._id,
    platformFee: paiseToRupees(version.platformFeeInPaise),
    gstRate: version.gstRate ?? null,
    gstEnabled: !!version.gstEnabled,
    minimumPayout: paiseToRupees(version.minimumPayoutInPaise),
    autoPayoutEnabled: !!version.autoPayoutEnabled,
    version: version.version,
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

export const toRevenueSettingsAdminListDTO = (versions) => versions.map(toRevenueSettingsAdminDTO);
