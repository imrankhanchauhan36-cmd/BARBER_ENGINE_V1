//////////////////////////////////////////////////////////////
// CHAIR AVAILABILITY ENGINE — RESPONSE DTOs (PHASE 1)
//
// Shapes what the API actually returns — keeps Mongoose internals
// (__v, raw ObjectId refs without population, etc.) out of the
// owner-facing response, and gives every endpoint one consistent
// shape regardless of which service function produced the doc.
//////////////////////////////////////////////////////////////

// Normalizes any Mongo id-shaped value to a plain string, whether
// it arrived raw (ObjectId, from a `.lean()`/non-populated query)
// or populated (a ref expanded into a { _id, ... } doc). Every
// id-like field below funnels through this one function instead of
// each re-deriving its own populated-vs-raw check.
const toIdString = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

/**
 * @param {object} block  Lean ChairAvailabilityOverride doc.
 *   `chairId` may be a raw ObjectId OR a populated { _id, name, position }
 *   object depending on the query — handled either way. `salonId`,
 *   `createdBy`, and `updatedBy` are not populated by any current
 *   query, but are handled the same defensive way in case a future
 *   query adds `.populate()` for them.
 */
export const toChairAvailabilityDTO = (block) => {
  if (!block) return null;

  const chairIsPopulated = block.chairId && typeof block.chairId === "object" && "name" in block.chairId;

  return {
    id:        toIdString(block._id),
    salonId:   toIdString(block.salonId),
    chair: chairIsPopulated
      ? { id: toIdString(block.chairId), name: block.chairId.name, position: block.chairId.position ?? null }
      : { id: toIdString(block.chairId), name: null,                position: null },
    date:      block.date,
    startTime: block.startTime,
    endTime:   block.endTime,
    type:      block.type,
    reason:    block.reason ?? null,
    status:    block.status,
    createdBy: toIdString(block.createdBy),
    updatedBy: toIdString(block.updatedBy),
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
};

export const toChairAvailabilityListDTO = (blocks = []) => blocks.map(toChairAvailabilityDTO);
