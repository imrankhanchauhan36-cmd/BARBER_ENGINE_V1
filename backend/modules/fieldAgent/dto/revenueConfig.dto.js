/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/dto/revenueConfig.dto.js
 *
 * FA-P3-A — Revenue Configuration Engine, Phase 1. Shapes the
 * underlying CommercialPolicyVersion / CommercialPolicyOverride /
 * Area documents into the flat field names this ticket specifies
 * (acquisitionReward, recoveryPercentage, minimumPayout,
 * autoPayoutEnabled) — amounts converted paise -> rupees for
 * admin-panel display, never the reverse (requests convert
 * rupees -> paise at the controller boundary, see the validator).
 */

const paiseToRupees = (paise) => (paise == null ? null : Math.round(paise) / 100);

export const toRevenueSettingsDTO = (version) => {
  if (!version) {
    return {
      acquisitionReward: null,
      recoveryPercentage: null,
      minimumPayout: null,
      autoPayoutEnabled: false,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    acquisitionReward: paiseToRupees(version.acquisitionEarningTargetInPaise),
    recoveryPercentage: version.acquisitionAgentCommissionPercent ?? null,
    minimumPayout: paiseToRupees(version.minimumPayoutInPaise),
    autoPayoutEnabled: !!version.autoPayoutEnabled,
    updatedBy: version.publishedBy ?? version.createdBy ?? null,
    createdAt: version.createdAt ?? null,
    updatedAt: version.updatedAt ?? null,
  };
};

export const toTerritoryRowDTO = ({ area, territoryPartnerCommissionPercent, isOverridden, overrideId }) => ({
  areaId: area._id,
  areaName: area.name,
  districtRef: area.districtRef,
  cityRef: area.cityRef,
  territoryPercent: territoryPartnerCommissionPercent,
  isOverridden,
  overrideId,
});

export const toTerritoryListDTO = ({ items, total, page, limit }) => ({
  items: items.map(toTerritoryRowDTO),
  total,
  page,
  limit,
});
