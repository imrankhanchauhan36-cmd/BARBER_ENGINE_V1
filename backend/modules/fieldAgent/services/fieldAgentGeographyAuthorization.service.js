/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fieldAgentGeographyAuthorization.service.js
 *
 * Field Agent Geography Phase C — the single shared authorization
 * helper every Field-Agent-exposing admin read endpoint uses. Reuses
 * Phase A (FieldAgentGeographyAssignment model + its own
 * fieldAgentGeography.service.js) as the sole source of truth. This
 * file adds no new geography data and no new CRUD — only read-only
 * authorization comparisons on top of what Phase A already owns. Not
 * a competing geography service; Phase A's model/service are
 * unmodified by this file.
 *
 * Only an ACTIVE assignment ever grants access — ENDED/historical
 * assignments never do (enforced by filtering status:"ACTIVE" here,
 * and by Phase A's getActiveFieldAgentGeography already doing the
 * same internally).
 *
 * FAIL CLOSED, always: a STATE/DISTRICT admin whose own req.user is
 * missing stateRef/districtRef, a Field Agent with no ACTIVE
 * assignment at all, or an unrecognized adminLevel, are all treated
 * as "no access" — never as "no restriction". INDIA is the only
 * level that ever bypasses this file entirely.
 */

import FieldAgentGeographyAssignment from "../models/FieldAgentGeographyAssignment.js";
import { getActiveFieldAgentGeography } from "./fieldAgentGeography.service.js";
import { Errors } from "../../../utils/response.js";

const ADMIN_LEVEL = Object.freeze({ INDIA: "INDIA", STATE: "STATE", DISTRICT: "DISTRICT" });

/**
 * Bulk form — for list/roster/analytics endpoints that need to scope
 * an entire query population at once.
 *
 * Returns:
 *   - null        => INDIA: no restriction, caller must not filter.
 *   - ObjectId[]   => the exact set of FieldAgent _ids this admin may
 *                     see — POSSIBLY EMPTY. An empty array must still
 *                     be used as the filter (matches zero documents),
 *                     never treated as "no filter".
 */
export const resolveAuthorizedFieldAgentIds = async (admin) => {
  const level = admin?.adminLevel;
  if (level === ADMIN_LEVEL.INDIA) return null;

  const filter = { status: "ACTIVE" };
  if (level === ADMIN_LEVEL.STATE) {
    if (!admin?.stateRef) return [];
    filter.stateRef = admin.stateRef;
  } else if (level === ADMIN_LEVEL.DISTRICT) {
    if (!admin?.districtRef) return [];
    filter.districtRef = admin.districtRef;
  } else {
    return [];
  }

  const rows = await FieldAgentGeographyAssignment.find(filter).select("fieldAgentRef").lean();
  return rows.map((r) => r.fieldAgentRef);
};

/**
 * Single-entity form — for detail/summary/salons/earnings/wallet/
 * payouts endpoints. Throws Errors.forbidden() when the admin is not
 * authorized for this specific Field Agent; resolves (void, no
 * return value) when authorized. INDIA always resolves without a DB
 * read.
 */
export const assertAdminCanAccessFieldAgent = async ({ admin, fieldAgentId }) => {
  const level = admin?.adminLevel;
  if (level === ADMIN_LEVEL.INDIA) return;

  if (level !== ADMIN_LEVEL.STATE && level !== ADMIN_LEVEL.DISTRICT) {
    throw Errors.forbidden("Outside your authorized scope");
  }

  const geography = await getActiveFieldAgentGeography(fieldAgentId);
  if (!geography) {
    throw Errors.forbidden("Outside your authorized scope");
  }

  if (level === ADMIN_LEVEL.STATE) {
    if (!admin?.stateRef || String(geography.stateRef) !== String(admin.stateRef)) {
      throw Errors.forbidden("Outside your authorized scope");
    }
    return;
  }

  // DISTRICT — a state-only assignment (districtRef null) never
  // matches, by construction of the comparison below.
  if (!admin?.districtRef || String(geography.districtRef) !== String(admin.districtRef)) {
    throw Errors.forbidden("Outside your authorized scope");
  }
};
