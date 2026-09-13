/**
 * BARBER ENGINE V1
 * backend/services/areaDiscoveryNormalization.service.js
 *
 * AREA-2.5.2 — approved normalization + tokenization contract.
 * Pure functions, no I/O, no side effects.
 *
 * normalizeForIdentity is byte-identical to Area.js's own pre("save")
 * hook and AreaDiscoveryCandidate's identity normalization — this is
 * deliberate, not incidental: it is what makes EXACT-tier comparison
 * valid across the two collections. Do NOT use backend/utils/normalize.js
 * here — it implements a different algorithm (strips punctuation,
 * substitutes "&"->"and") and would silently diverge from the
 * canonical Area/candidate identity, which is exactly the failure
 * mode this phase's audit identified and rejected.
 *
 * tokenizeForTextMatch is a MATCHING SIGNAL ONLY. It never rewrites
 * or replaces the identity-normalized string — it derives a separate,
 * disposable token set purely for TEXT-tier scoring.
 */

// Closed, approved strip list — do not add to this without a separate
// approved contract change. "st"/"hospital"/"college"/"school"/"chowk"
// are deliberately KEPT (see AREA-2.5.2 clarification audit).
export const TEXT_MATCH_STRIP_WORDS = Object.freeze(["road", "rd", "marg", "street"]);

/**
 * Canonical identity normalization — reused verbatim from Area.js.
 * Used for the EXACT-tier comparison only.
 */
export const normalizeForIdentity = (name) => {
  return String(name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
};

/**
 * Text-tier tokenization — approved 4-step deterministic process:
 * 1. remove "." and "'" (noise characters, never separators)
 * 2. split on whitespace, comma, or hyphen
 * 3. drop empty tokens
 * 4. remove tokens present in TEXT_MATCH_STRIP_WORDS
 *
 * Returns a Set (duplicates collapsed) of the "meaningful tokens".
 * Operates on the identity-normalized string, never on raw input
 * directly, so tokenization behavior is a pure function of the same
 * canonical string used for exact-match comparison.
 */
export const tokenizeForTextMatch = (name) => {
  const identity = normalizeForIdentity(name);
  const withoutNoiseChars = identity.replace(/[.']/g, "");
  const rawTokens = withoutNoiseChars.split(/[\s,-]+/).filter((t) => t.length > 0);
  const strip = new Set(TEXT_MATCH_STRIP_WORDS);
  const meaningful = rawTokens.filter((t) => !strip.has(t));
  return new Set(meaningful);
};
