import RatingAggregate from "../models/RatingAggregate.js";
import ServiceRating, { RATING_TYPE } from "../models/ServiceRating.js";

//////////////////////////////////////////////////////////////
// 📖 SERVICE OVERVIEW — Rating & Review Engine, Phase 2
//
// Read helpers for the summary/list APIs, plus the recovery path
// (constitution rule 9: aggregates are derived and must be fully
// recoverable from raw ServiceRating rows — never trusted blindly).
// RatingAggregate rows themselves are only ever WRITTEN by
// jobs/ratingOutbox.job.js — nothing here mutates them except
// recomputeAggregate's explicit, on-demand recovery path.
//////////////////////////////////////////////////////////////

const EMPTY_SUMMARY = {
  count: 0,
  average: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

function toSummary(aggregateDoc) {
  if (!aggregateDoc) return EMPTY_SUMMARY;

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const dist = aggregateDoc.distribution;
  if (dist) {
    for (const star of [1, 2, 3, 4, 5]) {
      distribution[star] = (dist instanceof Map ? dist.get(String(star)) : dist[star]) || 0;
    }
  }

  return {
    count: aggregateDoc.count || 0,
    average: aggregateDoc.count ? Number((aggregateDoc.total / aggregateDoc.count).toFixed(1)) : 0,
    distribution,
  };
}

export async function getSummary({ salonId, type, targetId }) {
  const doc = await RatingAggregate.findOne({ salonId, type, targetId }).lean();
  return toSummary(doc);
}

export async function getSalonSummary(salonId) {
  return getSummary({ salonId, type: RATING_TYPE.SALON, targetId: salonId });
}

export async function getServiceSummary({ salonId, serviceId }) {
  return getSummary({ salonId, type: RATING_TYPE.SERVICE, targetId: serviceId });
}

export async function getProfessionalSummary({ salonId, professionalId }) {
  return getSummary({ salonId, type: RATING_TYPE.PROFESSIONAL, targetId: professionalId });
}

//////////////////////////////////////////////////////////////
// 🔧 RECOVERY — recompute one aggregate document directly from raw,
// non-hidden ServiceRating rows. Never called automatically; exposed
// for an explicit admin/ops action when an aggregate is suspected
// corrupted (constitution rule 9).
//////////////////////////////////////////////////////////////

export async function recomputeAggregate({ salonId, type, targetId }) {
  const rows = await ServiceRating.find({ salonId, type, targetId, isHidden: false })
    .select("stars")
    .lean();

  const distribution = new Map([["1", 0], ["2", 0], ["3", 0], ["4", 0], ["5", 0]]);
  let total = 0;

  for (const row of rows) {
    total += row.stars;
    const key = String(row.stars);
    distribution.set(key, (distribution.get(key) || 0) + 1);
  }

  const updated = await RatingAggregate.findOneAndUpdate(
    { salonId, type, targetId },
    {
      $set: {
        count: rows.length,
        total,
        distribution,
      },
    },
    { upsert: true, new: true }
  );

  return toSummary(updated);
}
