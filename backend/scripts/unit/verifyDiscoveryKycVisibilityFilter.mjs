/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyDiscoveryKycVisibilityFilter.mjs
 *
 * ZEMISH "Admin approval blocked by KYC" fix — discovery visibility
 * follow-up. Admin can now approve a salon while the owner's mandatory
 * PAN+Bank KYC is still pending (see verifyAssistedOnboardingSubmitGate.
 * mjs), and the booking guard already blocks such a salon from being
 * bookable (see verifySalonReadyKycGuard.mjs). This file proves the
 * same salon is also excluded from every customer-facing discovery
 * query in controllers/discovery.controller.js — approval.status alone
 * must never again be sufficient for a salon to surface to customers.
 *
 * Why SOURCE-TEXT checks instead of calling the real functions:
 * discovery.controller.js imports services/slotEngine.service.js,
 * which imports config/redis.js and opens a REAL Redis connection as a
 * module-load side effect — confirmed by reading slotEngine.service.
 * js's own imports before writing this test. The exact same hazard
 * already found and worked around for salon.onboarding.controller.js
 * and fieldAgentOnboarding.service.js (see those files' own test
 * headers) — importing discovery.controller.js here would violate the
 * "no real DB/Redis in an offline test" constraint. This file instead
 * proves the WIRING contract by reading the real source file on disk:
 * which query sites carry the new field, in what literal form, and
 * that every pre-existing filter/geo/ranking/pagination/search
 * mechanism around each site is still intact and unmodified.
 *
 * Covers, across all 5 customer-facing endpoints in the file:
 *   1. getSalons — the single shared `filter` object gets the new
 *      field once; every one of its 4 internal consumers ($text search
 *      match, $geoNear's `query: filter`, the fallback
 *      countDocuments(filter), and the fallback find(filter)) inherit
 *      it by reference, not by separate duplication. All of getSalons'
 *      other optional filters (cityRef, category, tier, ac,
 *      specializations, capabilities, isFeatured, isOpenNow, search,
 *      serviceCategory), its $geoNear/pagination/sort machinery, and
 *      its search-recall logic are all still present, unmodified.
 *   2. getSalonById — the owner existence-gate findOne() gets the new
 *      field; its .select() projection and chair/media enrichment are
 *      unmodified.
 *   3. getSalonServices — the salon existence-gate findOne() gets the
 *      new field; the actual service-listing query/filter
 *      (applicableFor/category) is untouched.
 *   4. getTrendingServices — the $lookup pipeline's $match gets the
 *      new field; isShopOpen/isForceClosed/$sort/$facet/pagination are
 *      unmodified.
 *   5. getRecommendedServices — BOTH the Step A ($geoNear candidate
 *      salons) and Step C ($lookup match) queries get the new field
 *      (exactly 2 occurrences in this function); Step B's
 *      personalization aggregation (Booking.aggregate) is untouched.
 *   6. File-wide: exactly 6 occurrences of the new field total (one
 *      per site above) — proves no site was missed and none
 *      duplicated. getCategories (which never queries Salon at all)
 *      has zero occurrences — proves the field wasn't over-applied to
 *      an unrelated, non-salon endpoint.
 *   7. Filter-VALUE semantics (not just presence): the field is
 *      written as the literal boolean `true` (strict equality), which
 *      is independently verified against a minimal, hand-written
 *      dot-path/strict-equality matcher mirroring MongoDB's own
 *      {field: true} filter semantics — proving a KYC-pending salon
 *      (field false or missing) would be excluded and a KYC-verified
 *      salon (field true) would remain eligible, without relying on a
 *      live MongoDB query planner.
 *
 * Run:  cd backend && node scripts/unit/verifyDiscoveryKycVisibilityFilter.mjs
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "../..");

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, detail) => {
  if (cond) { pass++; rows.push(`✅ ${name}`); }
  else { fail++; rows.push(`❌ ${name}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`); }
};

const read = (rel) => readFileSync(path.join(backendRoot, rel), "utf8");

// Same bracket-matching extractor already used by
// verifyAssistedOnboardingSubmitGate.mjs — good enough for these
// specific, well-formed `export const <name> = async (...) => { ... }`
// declarations, not a general-purpose JS parser.
const extractFunctionBody = (source, exportName) => {
  const anchor = `export const ${exportName} =`;
  const start = source.indexOf(anchor);
  if (start === -1) return null;
  const arrowIdx = source.indexOf("=>", start);
  if (arrowIdx === -1) return null;
  const braceStart = source.indexOf("{", arrowIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceStart, i + 1);
    }
  }
  return null;
};

const KYC_FIELD = `"business.isKycVerifiedForDiscovery": true`;
const APPROVED_FIELD = `"approval.status": "APPROVED"`;
// getTrendingServices / getRecommendedServices $match/$geoNear blocks
// use extra column-alignment spaces around the colon, e.g.
// `"approval.status":     "APPROVED",` — matched separately below.
const APPROVED_FIELD_ALIGNED = /"approval\.status":\s*"APPROVED"/;
const KYC_FIELD_ANY_SPACING = /"business\.isKycVerifiedForDiscovery":\s*true/;

const countOccurrences = (haystack, needle) => (haystack.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

const run = () => {
  const src = read("controllers/discovery.controller.js");

  // ── 0. File-wide sanity: exactly 6 sites carry the new field ──
  check(
    "File-wide: exactly 6 occurrences of the KYC visibility field (one per customer-facing query site, none missed, none duplicated)",
    countOccurrences(src, KYC_FIELD) === 6,
    countOccurrences(src, KYC_FIELD)
  );

  // ── 1. getSalons ──
  const getSalonsBody = extractFunctionBody(src, "getSalons");
  check("getSalons exists and was read", !!getSalonsBody);

  {
    const filterDeclStart = getSalonsBody.indexOf("const filter = {");
    const approvedIdx = getSalonsBody.indexOf(APPROVED_FIELD, filterDeclStart);
    const kycIdx = getSalonsBody.indexOf(KYC_FIELD, filterDeclStart);
    const isDeletedIdx = getSalonsBody.indexOf("isDeleted:", kycIdx);
    check(
      "getSalons: base `filter` object declares approval.status, then the new KYC field, then isDeleted — all three present in the base filter, in order",
      filterDeclStart !== -1 && approvedIdx !== -1 && kycIdx !== -1 && isDeletedIdx !== -1 &&
        approvedIdx < kycIdx && kycIdx < isDeletedIdx &&
        (kycIdx - approvedIdx) < 500 // same object literal, not some unrelated later match
    );
  }

  // The 4 internal consumers all inherit via the SAME `filter`
  // reference, not a re-declared/duplicated object — proves the single
  // edit above cascades everywhere getSalons uses `filter`.
  check("getSalons: $text search path still spreads the shared `filter` object (...filter, $text: ...)", /\.\.\.filter,\s*\n?\s*\$text:/.test(getSalonsBody));
  check("getSalons: $geoNear path still passes the shared `filter` object as its query (query: filter,)", /query:\s*filter,/.test(getSalonsBody));
  check("getSalons: fallback path still uses Salon.countDocuments(filter)", /Salon\.countDocuments\(filter\)/.test(getSalonsBody));
  check("getSalons: fallback path still uses Salon.find(filter)", /Salon\.find\(filter\)/.test(getSalonsBody));

  // Preserved — every other optional filter, geo/ranking/pagination,
  // and search-recall mechanism untouched by this change.
  check("getSalons: cityRef filter preserved", /location\.territory\.cityRef/.test(getSalonsBody));
  check("getSalons: category filter preserved", /basicInfo\.category/.test(getSalonsBody));
  check("getSalons: tier filter preserved", /basicInfo\.tier/.test(getSalonsBody));
  check("getSalons: amenities/ac filter preserved", /basicInfo\.amenities\.hasAC/.test(getSalonsBody));
  check("getSalons: specializations multi-value filter preserved", /specializations/.test(getSalonsBody));
  check("getSalons: capabilities filter preserved", /filter\["capabilities"\]/.test(getSalonsBody));
  check("getSalons: isFeatured filter preserved", /filter\["isFeatured"\]/.test(getSalonsBody));
  check("getSalons: isOpenNow filter (isShopOpen + isForceClosed $or) preserved", /business\.isShopOpen.*=\s*true|"business\.isShopOpen"\]\s*=\s*true/.test(getSalonsBody) && /isForceClosed/.test(getSalonsBody));
  check("getSalons: combined salon+service search (Path A/B union into filter._id) preserved", /searchMatchedIds/.test(getSalonsBody));
  check("getSalons: serviceCategory → Category → Service → salonIds chain preserved", /matchingServices/.test(getSalonsBody));
  check("getSalons: $geoNear geo-search block preserved", /\$geoNear/.test(getSalonsBody));
  check("getSalons: pagination (safePage/safeLimit/skip) preserved", /safePage/.test(getSalonsBody) && /safeLimit/.test(getSalonsBody) && /\bskip\b/.test(getSalonsBody));
  check("getSalons: fallback newest-first sort preserved", /sort\(\{\s*createdAt:\s*-1\s*\}\)/.test(getSalonsBody));

  // ── 2. getSalonById ──
  const getSalonByIdBody = extractFunctionBody(src, "getSalonById");
  check("getSalonById exists and was read", !!getSalonByIdBody);
  check("getSalonById: existence-gate findOne includes approval.status APPROVED", !!getSalonByIdBody && APPROVED_FIELD_ALIGNED.test(getSalonByIdBody));
  check("getSalonById: existence-gate findOne includes the new KYC visibility field", !!getSalonByIdBody && KYC_FIELD_ANY_SPACING.test(getSalonByIdBody));
  check("getSalonById: isDeleted check preserved", !!getSalonByIdBody && /isDeleted:\s*\{\s*\$ne:\s*true\s*\}/.test(getSalonByIdBody));
  check("getSalonById: chair + media enrichment preserved", !!getSalonByIdBody && /Chair\.find/.test(getSalonByIdBody) && /SalonMedia\.find/.test(getSalonByIdBody));

  // ── 3. getSalonServices ──
  const getSalonServicesBody = extractFunctionBody(src, "getSalonServices");
  check("getSalonServices exists and was read", !!getSalonServicesBody);
  check("getSalonServices: existence-gate findOne includes approval.status APPROVED", !!getSalonServicesBody && APPROVED_FIELD_ALIGNED.test(getSalonServicesBody));
  check("getSalonServices: existence-gate findOne includes the new KYC visibility field", !!getSalonServicesBody && KYC_FIELD_ANY_SPACING.test(getSalonServicesBody));
  check("getSalonServices: applicableFor (MEN/WOMEN/BOTH) tab filter preserved", !!getSalonServicesBody && /applicableFor/.test(getSalonServicesBody));
  check("getSalonServices: category filter preserved", !!getSalonServicesBody && /serviceFilter\.category/.test(getSalonServicesBody));

  // ── 4. getTrendingServices ──
  const getTrendingServicesBody = extractFunctionBody(src, "getTrendingServices");
  check("getTrendingServices exists and was read", !!getTrendingServicesBody);
  check("getTrendingServices: $lookup pipeline $match includes approval.status APPROVED", !!getTrendingServicesBody && APPROVED_FIELD_ALIGNED.test(getTrendingServicesBody));
  check("getTrendingServices: $lookup pipeline $match includes the new KYC visibility field", !!getTrendingServicesBody && KYC_FIELD_ANY_SPACING.test(getTrendingServicesBody));
  check("getTrendingServices: isShopOpen + isForceClosed $or preserved", !!getTrendingServicesBody && /business\.isShopOpen.*true/.test(getTrendingServicesBody) && /isForceClosed/.test(getTrendingServicesBody));
  check("getTrendingServices: bookingCount/rating ranking $sort preserved", !!getTrendingServicesBody && /bookingCountSafe:\s*-1,\s*salonRatingAvg:\s*-1/.test(getTrendingServicesBody));
  check("getTrendingServices: $facet pagination ($skip/$limit/totalCount) preserved", !!getTrendingServicesBody && /\$facet/.test(getTrendingServicesBody) && /totalCount/.test(getTrendingServicesBody));

  // ── 5. getRecommendedServices — TWO sites in this one function ──
  const getRecommendedServicesBody = extractFunctionBody(src, "getRecommendedServices");
  check("getRecommendedServices exists and was read", !!getRecommendedServicesBody);
  check(
    "getRecommendedServices: exactly 2 occurrences of the KYC visibility field (Step A geoNear candidates + Step C $lookup match)",
    !!getRecommendedServicesBody && countOccurrences(getRecommendedServicesBody, KYC_FIELD) === 2,
    getRecommendedServicesBody && countOccurrences(getRecommendedServicesBody, KYC_FIELD)
  );
  check(
    "getRecommendedServices: exactly 2 occurrences of approval.status APPROVED (one per site, paired with the KYC field each time)",
    !!getRecommendedServicesBody && (getRecommendedServicesBody.match(/"approval\.status":\s*"APPROVED"/g) || []).length === 2
  );
  check("getRecommendedServices: Step A $geoNear candidate-salon search preserved", !!getRecommendedServicesBody && /\$geoNear/.test(getRecommendedServicesBody) && /MAX_CANDIDATE_SALONS/.test(getRecommendedServicesBody));
  check("getRecommendedServices: Step B personalization (Booking.aggregate / topCategories) preserved, untouched by this change", !!getRecommendedServicesBody && /Booking\.aggregate/.test(getRecommendedServicesBody) && /topCategories/.test(getRecommendedServicesBody));
  check("getRecommendedServices: Step C ranking ($sort bookingCountSafe/salonRatingAvg) preserved", !!getRecommendedServicesBody && /bookingCountSafe:\s*-1,\s*salonRatingAvg:\s*-1/.test(getRecommendedServicesBody));
  check("getRecommendedServices: recommendationReason attachment (BOOKING_HISTORY/NEARBY/TRENDING) preserved", !!getRecommendedServicesBody && /recommendationReason/.test(getRecommendedServicesBody));

  // ── 6. getCategories — never touches Salon; must have zero
  // occurrences, proving the field wasn't over-applied to an
  // unrelated, non-salon endpoint ──
  const getCategoriesBody = extractFunctionBody(src, "getCategories");
  check("getCategories exists and was read", !!getCategoriesBody);
  check("getCategories: does not reference Salon or the KYC visibility field at all (never queries salons)", !!getCategoriesBody && !/\bSalon\./.test(getCategoriesBody) && !getCategoriesBody.includes(KYC_FIELD));

  // ── 7. Filter-VALUE semantics — the field is literal boolean `true`
  // (strict equality), verified against a minimal matcher mirroring
  // MongoDB's own {field: true} semantics, independent of any live
  // query planner. Proves a KYC-pending salon (false/missing) is
  // excluded and a KYC-verified salon (true) remains eligible. ──
  const mongoEqualsTrueFilterMatches = (doc, dotPath) => {
    const value = dotPath.split(".").reduce((o, k) => (o == null ? o : o[k]), doc);
    return value === true; // MongoDB {field: true} is strict equality — false/undefined/null all fail to match
  };
  check(
    "7a. KYC-verified salon (business.isKycVerifiedForDiscovery: true) matches the filter semantics — remains eligible",
    mongoEqualsTrueFilterMatches({ business: { isKycVerifiedForDiscovery: true } }, "business.isKycVerifiedForDiscovery") === true
  );
  check(
    "7b. KYC-pending salon (business.isKycVerifiedForDiscovery: false) does NOT match — excluded",
    mongoEqualsTrueFilterMatches({ business: { isKycVerifiedForDiscovery: false } }, "business.isKycVerifiedForDiscovery") === false
  );
  check(
    "7c. Salon with the field entirely missing (pre-Phase-1-backfill / never synced) does NOT match — fails closed, excluded",
    mongoEqualsTrueFilterMatches({ business: {} }, "business.isKycVerifiedForDiscovery") === false
  );
  check(
    "7d. The literal source value is exactly boolean true, not a weaker form like {$ne:false} or {$exists:true} that would also match missing/other-falsy values",
    /"business\.isKycVerifiedForDiscovery":\s*true,/.test(src) && !/"business\.isKycVerifiedForDiscovery":\s*\{/.test(src)
  );

  console.log(rows.join("\n"));
  console.log(`\nDISCOVERY KYC VISIBILITY FILTER WIRING: ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run();
