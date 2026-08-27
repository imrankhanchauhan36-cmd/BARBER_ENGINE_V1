/**
 * BARBER ENGINE V1
 * backend/modules/support/services/routingResolution.service.js
 *
 * Phase E.2 — Deterministic Routing Resolution Engine.
 *
 * Read-only. Never imports SupportTicket, never writes to the
 * database, never touches routingSnapshot on a ticket document — it
 * only accepts a routingSnapshot-shaped value as input and returns a
 * routing decision. Does not assign an agent, does not reference
 * Queue/Team/Agent models (none exist yet) — targetQueueRef/
 * targetTeamRef are carried through as opaque ObjectIds only, exactly
 * as SupportCoverage/SupportRoutingRule (Phase E.1) already type them.
 *
 * Two independent lookups, kept separate per the approved Phase E
 * architecture:
 *   - selectWinningRule()      -> which SupportRoutingRule applies (policy)
 *   - resolveCoverageForTicket() -> which SupportCoverage serves it (who),
 *     via the AREA -> CITY -> DISTRICT -> STATE -> COUNTRY -> Central
 *     Support walk-up (Phase E §6).
 *
 * Every filtering/selection function below is pure (no I/O) and takes
 * already-fetched, plain-object rows — this is what makes the engine
 * unit-testable without a live MongoDB connection: tests feed fixture
 * arrays; resolveRouting() (the only async, DB-touching export) wires
 * the same pure functions to real SupportRoutingRule/SupportCoverage
 * queries.
 */

import SupportCoverage from "../models/SupportCoverage.js";
import SupportRoutingRule from "../models/SupportRoutingRule.js";
import { SCOPE_LEVEL } from "../constants/support.constants.js";

// Structural, fixed walk order — mirrors the 5-level hierarchy itself
// (Phase E §6: the walk order is not admin-configurable; whether a
// given coverage row continues past its own level is documented as
// carried-through-but-not-yet-actionable, see fallbackBehavior note
// on buildRoutingDecision below).
const WALK_ORDER = [
  SCOPE_LEVEL.AREA,
  SCOPE_LEVEL.CITY,
  SCOPE_LEVEL.DISTRICT,
  SCOPE_LEVEL.STATE,
  SCOPE_LEVEL.COUNTRY,
];

const LEVEL_FIELD = {
  [SCOPE_LEVEL.COUNTRY]: "countryRef",
  [SCOPE_LEVEL.STATE]: "stateRef",
  [SCOPE_LEVEL.DISTRICT]: "districtRef",
  [SCOPE_LEVEL.CITY]: "cityRef",
  [SCOPE_LEVEL.AREA]: "areaRef",
};

// area(5) is the most specific rule-geography match, country(1) the
// least; a rule with no geo fields populated at all matches every
// geography with specificity 0 (lowest possible, always beaten by any
// geographically-scoped rule).
const RULE_GEO_SPECIFICITY = {
  areaRef: 5,
  cityRef: 4,
  districtRef: 3,
  stateRef: 2,
  countryRef: 1,
};
const RULE_GEO_FIELDS = ["areaRef", "cityRef", "districtRef", "stateRef", "countryRef"];

function isEffective(row, now) {
  if (row.effectiveFrom && now < new Date(row.effectiveFrom)) return false;
  if (row.effectiveTo && now > new Date(row.effectiveTo)) return false;
  return true;
}

// Empty/absent array = wildcard (matches anything); otherwise the
// ticket's value must appear in the row's array. String() comparison
// so both real ObjectIds and plain string fixtures compare correctly.
function arrayDimensionMatches(rowValues, ticketValue) {
  if (!Array.isArray(rowValues) || rowValues.length === 0) return true;
  if (ticketValue === undefined || ticketValue === null) return false;
  return rowValues.some((v) => String(v) === String(ticketValue));
}

// Returns the rule's geo-specificity (0-5) if every geo field it has
// populated matches the ticket's routingSnapshot, or null if any
// populated field mismatches (rule excluded entirely).
function ruleGeoSpecificity(rule, routingSnapshot) {
  let specificity = 0;
  for (const field of RULE_GEO_FIELDS) {
    const ruleValue = rule[field];
    if (!ruleValue) continue; // wildcard on this field
    const snapshotValue = routingSnapshot ? routingSnapshot[field] : null;
    if (!snapshotValue || String(ruleValue) !== String(snapshotValue)) return null;
    specificity = Math.max(specificity, RULE_GEO_SPECIFICITY[field]);
  }
  return specificity;
}

/**
 * Deterministic winner selection over an already-fetched list of
 * active SupportRoutingRule-shaped rows (Phase E §5 precedence:
 * geographic specificity, then rulePriority, then oldest createdAt).
 * Pure — no I/O, no ticket mutation.
 */
export function selectWinningRule(rules, ctx, now = new Date()) {
  const { routingSnapshot, categoryRef, priority, language, requesterType } = ctx;

  const candidates = [];
  for (const rule of rules || []) {
    if (rule.isActive === false) continue;
    if (rule.isDeleted) continue;
    if (!isEffective(rule, now)) continue;

    const geoSpecificity = ruleGeoSpecificity(rule, routingSnapshot);
    if (geoSpecificity === null) continue;

    if (!arrayDimensionMatches(rule.categoryRefs, categoryRef)) continue;
    if (!arrayDimensionMatches(rule.priorities, priority)) continue;
    if (!arrayDimensionMatches(rule.languages, language)) continue;
    if (!arrayDimensionMatches(rule.requesterTypes, requesterType)) continue;

    candidates.push({ rule, geoSpecificity });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (b.geoSpecificity !== a.geoSpecificity) return b.geoSpecificity - a.geoSpecificity;
    if (a.rule.rulePriority !== b.rule.rulePriority) return a.rule.rulePriority - b.rule.rulePriority;
    return new Date(a.rule.createdAt).getTime() - new Date(b.rule.createdAt).getTime();
  });

  return candidates[0].rule;
}

// Filters + picks the winner from an array of SupportCoverage-shaped
// rows already fetched for one (scopeLevel, refId) pair — mirrors the
// shape SupportCoverage.find({[field]:refId, scopeLevel, isActive:true,
// isDeleted:false}) would return. Pure — no I/O.
export function selectCoverageWinner(rows, ctx, now = new Date()) {
  const candidates = (rows || []).filter(
    (c) =>
      c.isActive !== false &&
      !c.isDeleted &&
      isEffective(c, now) &&
      arrayDimensionMatches(c.categoryRefs, ctx.categoryRef) &&
      arrayDimensionMatches(c.priorities, ctx.priority)
  );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.selectionPriority !== b.selectionPriority) return a.selectionPriority - b.selectionPriority;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  return candidates[0];
}

/**
 * AREA -> CITY -> DISTRICT -> STATE -> COUNTRY -> Central Support
 * walk-up (Phase E §6). `fetchRows(level, refId)` is dependency-
 * injected so this exact algorithm is unit-testable with an in-memory
 * fixture fetcher and, in production, backed by real indexed
 * SupportCoverage queries (see resolveRouting below) — no
 * reimplementation of the walk for tests.
 *
 * `refId` is null for the final Central Support call — the mandatory
 * safety net is intentionally NOT filtered by the ticket's own
 * countryRef (a ticket with no geography at all, routingSnapshot.
 * source === NONE, must still resolve here — Phase E §12: "must never
 * return unresolved when mandatory Central Support coverage exists").
 */
export async function resolveCoverageForTicket(routingSnapshot, ctx, fetchRows, now = new Date()) {
  for (const level of WALK_ORDER) {
    const refId = routingSnapshot ? routingSnapshot[LEVEL_FIELD[level]] : null;
    if (!refId) continue;

    const rows = await fetchRows(level, refId);
    const winner = selectCoverageWinner(rows, ctx, now);
    if (winner) {
      return { coverage: winner, matchedLevel: level, isCentralSupportFallback: false };
    }
  }

  const centralRows = await fetchRows(SCOPE_LEVEL.COUNTRY, null);
  const central = selectCoverageWinner(centralRows, ctx, now);
  if (central) {
    return { coverage: central, matchedLevel: SCOPE_LEVEL.COUNTRY, isCentralSupportFallback: true };
  }

  // Only reachable if no active COUNTRY-level row exists at all — a
  // configuration gap the schema layer deliberately does not enforce
  // against (Phase E.1: "at least one row exists" is a service/
  // configuration-layer guarantee, not a Mongo constraint). The engine
  // cannot invent a target that was never configured.
  return null;
}

/**
 * Combines the independently-resolved rule and coverage results into
 * one decision. Coverage answers "who serves this geography by
 * default"; a matched Rule's own targetQueueRef/targetTeamRef, when
 * present, is treated as a deliberate admin policy override and takes
 * precedence — this exact tie-break was not pinned down in the frozen
 * Phase E spec and is called out as an open decision in the Phase E.2
 * report, not silently assumed.
 *
 * fallbackBehavior on the matched coverage row is passed through
 * as-is but has NO effect on this resolution — it has nothing to
 * react to yet (no capacity/availability signal exists before
 * Phase F's Team/Agent work), so today it is inert data, not logic.
 */
export function buildRoutingDecision({ matchedRule, coverageResult, now = new Date() }) {
  const ruleTargetQueueRef = matchedRule ? matchedRule.targetQueueRef ?? null : null;
  const ruleTargetTeamRef = matchedRule ? matchedRule.targetTeamRef ?? null : null;
  const coverage = coverageResult ? coverageResult.coverage : null;
  const coverageTargetQueueRef = coverage ? coverage.targetQueueRef ?? null : null;
  const coverageTargetTeamRef = coverage ? coverage.targetTeamRef ?? null : null;

  return {
    matchedRuleId: matchedRule ? matchedRule._id ?? null : null,
    matchedCoverageId: coverage ? coverage._id ?? null : null,
    matchedScopeLevel: coverageResult ? coverageResult.matchedLevel : null,
    isCentralSupportFallback: Boolean(coverageResult && coverageResult.isCentralSupportFallback),
    coverageFallbackBehavior: coverage ? coverage.fallbackBehavior ?? null : null,
    targetQueueRef: ruleTargetQueueRef ?? coverageTargetQueueRef,
    targetTeamRef: ruleTargetTeamRef ?? coverageTargetTeamRef,
    resolved: Boolean(coverageResult),
    resolvedAt: now,
  };
}

/**
 * The only DB-touching export. Fetches active rules (one indexed
 * scan, {isActive,rulePriority}) and, for coverage, up to 6 sequential
 * indexed point-lookups (one per geography level actually present on
 * the ticket, plus the Central Support safety net) — each hits its
 * own dedicated sparse compound index from Phase E.1, never a
 * collection scan. Never touches SupportTicket.
 */
export async function resolveRouting({ routingSnapshot, categoryRef, priority, language, requesterType }, now = new Date()) {
  const ctx = { routingSnapshot, categoryRef, priority, language, requesterType };

  const fetchCoverageRows = async (level, refId) => {
    const filter = { scopeLevel: level, isActive: true, isDeleted: false };
    if (refId) filter[LEVEL_FIELD[level]] = refId;
    return SupportCoverage.find(filter).lean();
  };

  const [rules, coverageResult] = await Promise.all([
    SupportRoutingRule.find({ isActive: true, isDeleted: false }).sort({ rulePriority: 1 }).lean(),
    resolveCoverageForTicket(routingSnapshot, { categoryRef, priority }, fetchCoverageRows, now),
  ]);

  const matchedRule = selectWinningRule(rules, ctx, now);

  return buildRoutingDecision({ matchedRule, coverageResult, now });
}
