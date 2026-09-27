/**
 * BARBER ENGINE V1
 * backend/modules/finance/dto/territoryRevenue.dto.js
 *
 * STEP 5.1 — Territory Revenue Settings Engine. Shapes a
 * TerritoryRevenueSettings document for the admin panel: paise ->
 * rupees for display, same one-way conversion convention already used
 * by modules/finance/dto/revenue.dto.js's toRevenueSettingsAdminDTO
 * (requests convert rupees -> paise at the validator/controller
 * boundary, never here).
 *
 * Pure mapping only. No DB access, no business logic, no side effects.
 */

const paiseToRupees = (paise) => (paise == null ? null : Math.round(paise) / 100);

export const toTerritoryRevenueAdminDTO = (version) => {
  if (!version) return null;
  return {
    id: version._id,
    territoryCommissionPercent: version.territoryCommissionPercent ?? null,
    minimumPayout: paiseToRupees(version.minimumPayoutInPaise),
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

export const toTerritoryRevenueAdminListDTO = (versions) => versions.map(toTerritoryRevenueAdminDTO);
