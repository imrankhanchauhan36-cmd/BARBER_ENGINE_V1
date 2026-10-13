/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyRazorpayWebhookSignatureFoundation.mjs
 *
 * RAZORPAY WEBHOOK HMAC — pure, local, focused test, additive,
 * 2026-10-12. Verifies the EXISTING, unmodified
 * verifyRazorpayWebhookSignature() (services/Razorpay.service.js) —
 * no behavior change, no bypass, no weakening of the real check.
 *
 * CONTRACT, confirmed by reading services/Razorpay.service.js:141-157
 * directly (quoted verbatim in that file's own comment):
 *   "Razorpay webhook signature = hex HMAC-SHA256(rawBody, webhookSecret),
 *   sent in X-Razorpay-Signature. The secret is the one set on the
 *   webhook in the Razorpay dashboard (RAZORPAY_WEBHOOK_SECRET) — NOT
 *   the API key secret. `rawBody` must be the exact bytes received.
 *   Constant-time compare."
 * Exact behavior read from the function body itself:
 *   - secret = process.env.RAZORPAY_WEBHOOK_SECRET (read at CALL time,
 *     not import time — so a test can change it between calls).
 *   - returns false (never throws) if: no secret, no signature, or
 *     rawBody is undefined/null.
 *   - expected = createHmac("sha256", secret).update(rawBody or
 *     String(rawBody)).digest("hex").
 *   - compares via Buffer equality: a.length === b.length (checked
 *     FIRST, since crypto.timingSafeEqual throws on a length
 *     mismatch rather than returning false) && timingSafeEqual(a,b).
 *
 * SAFE/LOCAL BY CONSTRUCTION: zero network, zero MongoDB, zero import
 * of dotenv/.env — the ONLY secret value used anywhere in this file is
 * a value this script generates itself with crypto.randomBytes. The
 * real RAZORPAY_WEBHOOK_SECRET (confirmed in the prior readiness audit
 * to not even be configured in the real .env) is never read, needed,
 * or referenced.
 *
 * Run:  cd backend && node scripts/unit/verifyRazorpayWebhookSignatureFoundation.mjs
 */

import crypto from "crypto";

// services/Razorpay.service.js throws at IMPORT time if
// RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are unset, and unconditionally
// constructs a `new Razorpay({key_id, key_secret})` SDK instance —
// object construction only, no I/O, no network call. These two
// placeholder values exist ONLY to satisfy that import-time guard so
// this file's actual target function (verifyRazorpayWebhookSignature,
// which never touches the SDK instance or these two vars at all) can
// be imported — they are never used to make any request anywhere in
// this script, and are never the real configured values (dotenv/.env
// is never loaded by this script).
process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_not_real";
process.env.RAZORPAY_KEY_SECRET = "placeholder_not_real";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const run = async () => {
  const { verifyRazorpayWebhookSignature } = await import("../../services/Razorpay.service.js");

  // A fresh, locally-generated secret — never the real
  // RAZORPAY_WEBHOOK_SECRET (which isn't even set in the real .env —
  // confirmed in the prior readiness audit). This is the ONLY place
  // this env var is touched by this script, and only with a value
  // this script itself invented.
  const testSecret = crypto.randomBytes(32).toString("hex");
  const rawBody = Buffer.from(JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_TESTDETERMINISTIC123", order_id: "order_TESTDETERMINISTIC456", amount: 54860, currency: "INR", status: "captured" } } },
  }));
  const validSignature = crypto.createHmac("sha256", testSecret).update(rawBody).digest("hex");

  try {
    // ════════════════════════════════════════════════════════════
    // 1. Valid signature, exact raw body, correct secret → true.
    // ════════════════════════════════════════════════════════════
    process.env.RAZORPAY_WEBHOOK_SECRET = testSecret;
    check("1. Valid HMAC-SHA256(rawBody, secret) hex signature is accepted", verifyRazorpayWebhookSignature({ rawBody, signature: validSignature }) === true);

    // ════════════════════════════════════════════════════════════
    // 2. Tampered raw body — same signature, one byte changed in the
    //    body — confirms the signature is bound to the EXACT bytes,
    //    not just a loosely-related payload.
    // ════════════════════════════════════════════════════════════
    const tamperedBody = Buffer.from(rawBody.toString().replace("54860", "54861")); // amount tampered
    check("2. Tampered raw body (amount changed, same signature) is REJECTED", verifyRazorpayWebhookSignature({ rawBody: tamperedBody, signature: validSignature }) === false);

    // ════════════════════════════════════════════════════════════
    // 3. Wrong secret — signature computed with a DIFFERENT secret
    //    than what's currently set on process.env at verify time.
    // ════════════════════════════════════════════════════════════
    const wrongSecret = crypto.randomBytes(32).toString("hex");
    const signatureFromWrongSecret = crypto.createHmac("sha256", wrongSecret).update(rawBody).digest("hex");
    check("3. Signature computed with the WRONG secret is REJECTED", verifyRazorpayWebhookSignature({ rawBody, signature: signatureFromWrongSecret }) === false);

    // ════════════════════════════════════════════════════════════
    // 4. Malformed / missing signature — several shapes, none of
    //    which may ever throw (every case must return false cleanly).
    // ════════════════════════════════════════════════════════════
    check("4a. Missing signature (undefined) is REJECTED, not thrown", verifyRazorpayWebhookSignature({ rawBody, signature: undefined }) === false);
    check("4b. Empty-string signature is REJECTED, not thrown", verifyRazorpayWebhookSignature({ rawBody, signature: "" }) === false);

    let threwOnShortSignature = false;
    let shortSigResult;
    try { shortSigResult = verifyRazorpayWebhookSignature({ rawBody, signature: "deadbeef" }); }
    catch { threwOnShortSignature = true; }
    check("4c. Garbage, wrong-length signature is REJECTED without throwing (length-mismatch guard before timingSafeEqual)", !threwOnShortSignature && shortSigResult === false, { threwOnShortSignature, shortSigResult });

    // Same length as a real hex-64 signature, but wrong content —
    // exercises the actual timingSafeEqual comparison path, not just
    // the length-mismatch short-circuit above.
    const sameLengthWrongContent = validSignature.slice(0, -1) + (validSignature.slice(-1) === "0" ? "1" : "0");
    check("4d. Same-length (hex-64) but wrong-content signature is REJECTED via the real constant-time comparison", verifyRazorpayWebhookSignature({ rawBody, signature: sameLengthWrongContent }) === false);

    // ════════════════════════════════════════════════════════════
    // 5. Missing rawBody — undefined/null must be rejected cleanly,
    //    even with an otherwise-valid signature string.
    // ════════════════════════════════════════════════════════════
    check("5a. Missing rawBody (undefined) is REJECTED, not thrown", verifyRazorpayWebhookSignature({ rawBody: undefined, signature: validSignature }) === false);
    check("5b. Null rawBody is REJECTED, not thrown", verifyRazorpayWebhookSignature({ rawBody: null, signature: validSignature }) === false);

    // ════════════════════════════════════════════════════════════
    // 6. Secret missing entirely at verify time (e.g. unconfigured
    //    environment — the REAL .env's actual current state, per the
    //    prior readiness audit) — must reject even a signature that
    //    WOULD be valid if the secret were still set.
    // ════════════════════════════════════════════════════════════
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    check("6. With RAZORPAY_WEBHOOK_SECRET unset (the real .env's actual current state), even a previously-valid signature is REJECTED, not silently accepted", verifyRazorpayWebhookSignature({ rawBody, signature: validSignature }) === false);

    // ════════════════════════════════════════════════════════════
    // 7. Exact-bytes contract — a Buffer and a String containing the
    //    identical bytes must verify identically (confirms the
    //    documented "rawBody must be the exact bytes received", not
    //    a re-serialized/re-parsed object).
    // ════════════════════════════════════════════════════════════
    process.env.RAZORPAY_WEBHOOK_SECRET = testSecret;
    const stringRawBody = rawBody.toString();
    const signatureOverString = crypto.createHmac("sha256", testSecret).update(stringRawBody).digest("hex");
    check("7. Buffer rawBody and an identical String rawBody each verify correctly against their own matching signature", verifyRazorpayWebhookSignature({ rawBody, signature: validSignature }) === true && verifyRazorpayWebhookSignature({ rawBody: stringRawBody, signature: signatureOverString }) === true);

  } finally {
    delete process.env.RAZORPAY_WEBHOOK_SECRET; // leave no trace in this process's env either
  }

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY WEBHOOK SIGNATURE (LOCAL HMAC ONLY — NO NETWORK): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err);
  process.exit(1);
});
