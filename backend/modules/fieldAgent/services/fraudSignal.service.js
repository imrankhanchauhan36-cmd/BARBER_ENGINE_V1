/**
 * BARBER ENGINE V1
 * backend/modules/fieldAgent/services/fraudSignal.service.js
 *
 * FA-7.1 — the sole write entry point for FraudSignal. Contains NO
 * detection logic (no query against AcquisitionReferral/AcquisitionClaim
 * or any other frozen collection) — this is a generic, idempotent
 * "record this observation" primitive that FA-7.2's future detectors
 * will call with an already-computed dedupeKey/evidence payload.
 *
 * CONCURRENCY: `recordSignal` never does a read-then-write existence
 * check — it always attempts the insert first and treats a duplicate-
 * key error on `dedupeKey` as a no-op, returning the ALREADY-PERSISTED
 * document rather than the caller's new payload. This is the same
 * "insert, and a duplicate key IS the correctness signal, not an
 * error to work around" idiom already proven for
 * CommercialTerritory{scopeKey,status} and AcquisitionClaim
 * {salonRef,status} — the unique index on `dedupeKey` is the actual
 * race authority; this function is just a safe wrapper around it. Two
 * concurrent calls with the identical dedupeKey (e.g. two detector
 * workers computing the same window) always converge on exactly one
 * persisted document, and neither caller sees an error.
 *
 * IDEMPOTENT RETRY: calling this again with the same dedupeKey but a
 * DIFFERENT evidence payload (e.g. a re-run detector recomputing
 * slightly different counts) still returns the ORIGINAL document,
 * unchanged — FraudSignal is immutable (see the model's own header),
 * so a "retry" can never silently overwrite previously-recorded
 * evidence with a newer computation.
 */

import FraudSignal from "../models/FraudSignal.js";

export const recordSignal = async ({
  signalType,
  subjectType,
  subjectRef,
  fieldAgentRef,
  severity,
  evidence,
  sourceEventRef,
  dedupeKey,
}) => {
  try {
    return await FraudSignal.create({
      signalType,
      subjectType,
      subjectRef,
      fieldAgentRef,
      severity,
      evidence,
      sourceEventRef,
      dedupeKey,
    });
  } catch (err) {
    const isDuplicateDedupeKey = err.code === 11000 && err.keyPattern?.dedupeKey;
    if (isDuplicateDedupeKey) {
      // Someone else (this same call, retried; or a concurrent
      // worker) already recorded this exact observation — return the
      // existing, immutable document rather than throwing.
      return FraudSignal.findOne({ dedupeKey });
    }
    throw err;
  }
};

export const getSignalByDedupeKey = (dedupeKey) => FraudSignal.findOne({ dedupeKey });
