/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/controllers/fieldAgentGeo.controller.js
 *
 * Minimal, read-only, PUBLIC geo reference data for the Field Agent
 * APPLICANT flow's requestedZone.stateRef picker. Added because no
 * existing geo endpoint is reachable by a public/FIELD_AGENT caller —
 * every other State/District/City/Area route (routes/state.routes.js,
 * district.routes.js, city.routes.js, location.routes.js,
 * master.routes.js) is gated by requireRole("ADMIN") (state/master
 * additionally require requireAdminLevel("INDIA")), confirmed by
 * direct inspection during the Field Agent applicant frontend phase.
 *
 * Exposes ONLY {_id, name} for active, non-deleted states — no
 * district/city/area, no admin-only fields (primaryAdminRef, audit
 * fields, etc.), no write operation. The existing State model and
 * every existing State route are untouched by this file.
 *
 * The `name` exclusion below is a read-only query filter, not a data
 * change: a handful of leftover ZTEST_-prefixed fixture State
 * documents from an earlier, unrelated E2E suite (e.g.
 * "ZTEST_AREA221_STATE_INACTIVE") are `isActive:true,isDeleted:false`
 * and would otherwise leak into this PUBLIC endpoint's response —
 * confirmed live during implementation. `serviceable`/`launchStatus`
 * can't be used to distinguish them from real states because the
 * whole platform is currently pre-launch (every real state also has
 * serviceable:false right now). ZTEST_ is this repo's established
 * fixture-naming convention (see backend/scripts/verifyUserIdentityUniqueness.js
 * and this session's own E2E scripts) — no fixture data is touched or
 * deleted, only excluded from this one read.
 */

import State from "../../../models/State.js";

export const getFieldAgentGeoStates = async (req, res) => {
  try {
    const states = await State.find({
      isActive: true,
      isDeleted: false,
      name: { $not: /^ZTEST_/i },
    })
      .select("name")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      message: "States fetched successfully",
      data: states.map((s) => ({ _id: s._id, name: s.name })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch states" });
  }
};
