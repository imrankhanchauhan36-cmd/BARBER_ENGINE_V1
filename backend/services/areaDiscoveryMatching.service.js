/**
 * BARBER ENGINE V1
 * backend/services/areaDiscoveryMatching.service.js
 *
 * AREA-2.5.2 — approved deterministic matching contract. Pure,
 * read-only (its only I/O is the Area query itself; it writes
 * nothing). Never persists a result, never modifies
 * AreaDiscoveryCandidate.matchedAreaRef, never creates or modifies an
 * Area, never performs GPS/proximity matching.
 *
 * Candidate geography (cityRef/districtRef/stateRef) is treated as
 * authoritative — every Area considered is pre-scoped by cityRef in
 * the query itself, so an ancestor mismatch is never fetched, never
 * scored, and can never be overridden by text similarity. This is
 * why OUT_OF_SCOPE never appears as an output of this function: it is
 * enforced structurally by the query, not classified after the fact.
 */

import Area from "../models/Area.js";
import { normalizeForIdentity, tokenizeForTextMatch } from "./areaDiscoveryNormalization.service.js";

export const MAX_LOW_MATCHES_RETURNED = 5;

/**
 * matchCandidateAgainstAreas({ cityRef, districtRef, stateRef, normalizedCandidateName, rawObservedNames })
 * -> { classification, matches, reason }
 *
 * classification: "HIGH" | "MEDIUM" | "LOW" | "NO_MATCH"
 * matches: [{ areaId, areaName, signal, overlapCount }]
 */
export const matchCandidateAgainstAreas = async ({ cityRef, districtRef, stateRef, normalizedCandidateName }) => {
  const identity = normalizeForIdentity(normalizedCandidateName);

  const areaFilter = {
    cityRef,
    districtRef,
    stateRef,
    isActive: true,
    isDeleted: false,
  };

  // ── IDENTITY TIER ────────────────────────────────────────────────
  // Runs first, across all Areas in the candidate's City. If found,
  // the text-tier scorer is never invoked — this is what structurally
  // guarantees a text-only result can never produce HIGH.
  const exactArea = await Area.findOne({ ...areaFilter, normalizedName: identity }).select("_id name").lean();
  if (exactArea) {
    return {
      classification: "HIGH",
      matches: [{ areaId: String(exactArea._id), areaName: exactArea.name, signal: "EXACT", overlapCount: null }],
      reason: "Exact byte-identical normalized identity match within the candidate's City.",
    };
  }

  // ── TEXT TIER ────────────────────────────────────────────────────
  const candidateTokens = tokenizeForTextMatch(normalizedCandidateName);
  if (candidateTokens.size === 0) {
    return { classification: "NO_MATCH", matches: [], reason: "Candidate has no meaningful tokens after normalization/stripping." };
  }

  const areasInCity = await Area.find(areaFilter).select("_id name normalizedName").lean();
  if (areasInCity.length === 0) {
    return { classification: "NO_MATCH", matches: [], reason: "No Areas exist yet in the candidate's City." };
  }

  const scored = [];
  for (const area of areasInCity) {
    const areaTokens = tokenizeForTextMatch(area.normalizedName);
    let overlapCount = 0;
    for (const t of candidateTokens) if (areaTokens.has(t)) overlapCount += 1;
    if (overlapCount === 0) continue;
    scored.push({
      areaId: String(area._id),
      areaName: area.name,
      overlapCount,
      candidateTokenCount: candidateTokens.size,
      areaTokenCount: areaTokens.size,
    });
  }

  if (scored.length === 0) {
    return { classification: "NO_MATCH", matches: [], reason: "No Area in this City shares any meaningful token with the candidate." };
  }

  const maxOverlap = Math.max(...scored.map((s) => s.overlapCount));
  const topScorers = scored.filter((s) => s.overlapCount === maxOverlap);

  const toMatch = (s) => ({ areaId: s.areaId, areaName: s.areaName, signal: "TEXT", overlapCount: s.overlapCount });
  const sortForDisplay = (list) =>
    [...list].sort((a, b) => (b.overlapCount - a.overlapCount) || a.areaId.localeCompare(b.areaId));

  if (topScorers.length > 1) {
    return {
      classification: "LOW",
      matches: sortForDisplay(scored).slice(0, MAX_LOW_MATCHES_RETURNED).map(toMatch),
      reason: `Ambiguous — ${topScorers.length} Areas tie at the highest overlap (${maxOverlap} token(s)).`,
    };
  }

  const best = topScorers[0];
  const fullyContains = best.overlapCount === best.candidateTokenCount || best.overlapCount === best.areaTokenCount;

  if (best.overlapCount >= 2 && fullyContains) {
    return {
      classification: "MEDIUM",
      matches: [toMatch(best)],
      reason: `Unique best match with ${best.overlapCount} overlapping token(s), fully containing one side's identity.`,
    };
  }

  return {
    classification: "LOW",
    matches: sortForDisplay(scored).slice(0, MAX_LOW_MATCHES_RETURNED).map(toMatch),
    reason: best.overlapCount < 2
      ? "Unique best match has only a single overlapping token — insufficient to reach MEDIUM."
      : "Unique best match overlaps on multiple tokens but does not fully contain either side's identity.",
  };
};
