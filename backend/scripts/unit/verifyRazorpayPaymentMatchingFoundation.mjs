/**
 * BARBER_ENGINE_V1
 * backend/scripts/unit/verifyRazorpayPaymentMatchingFoundation.mjs
 *
 * PAYMENT VERIFICATION & WEBHOOK IDEMPOTENCY TEST SUITE — PART B
 * (Order/payment matching), pure, local, additive, 2026-10-12.
 *
 * Exercises the EXISTING, unmodified `evaluateCapturedPayment()`
 * (services/Razorpay.service.js:95-115) directly — the pure function
 * that decides whether a payment fetched from Razorpay actually
 * belongs to, and pays for, a given booking's order. This is the
 * "appropriate isolated test layer" for order/payment/amount/currency
 * matching: the function takes a plain `payment` object and returns a
 * plain verdict — it never touches the SDK, the network, or the
 * database, so testing it directly (rather than through an HTTP
 * confirm call) proves the matching logic itself with zero moving
 * parts. The gateway-fetch boundary this function's CALLERS use
 * (fetchRazorpayPayment / fetchRazorpayOrder) is exercised separately,
 * with stubs, in the e2e suites of this same batch — never here.
 *
 * SAFE/LOCAL BY CONSTRUCTION: zero network, zero MongoDB. The two
 * placeholder env vars below exist ONLY to satisfy Razorpay.service.js's
 * import-time constructor guard (object construction only, no I/O) —
 * evaluateCapturedPayment itself never reads them or touches the SDK
 * instance.
 *
 * Run:  cd backend && node scripts/unit/verifyRazorpayPaymentMatchingFoundation.mjs
 */

process.env.RAZORPAY_KEY_ID = "rzp_test_placeholder_not_real";
process.env.RAZORPAY_KEY_SECRET = "placeholder_not_real_secret";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const run = async () => {
  const { evaluateCapturedPayment } = await import("../../services/Razorpay.service.js");

  const baseline = {
    orderId: "order_REAL123",
    paymentId: "pay_REAL456",
    amountInPaise: 54860,
  };
  const validPayment = {
    id: baseline.paymentId,
    order_id: baseline.orderId,
    currency: "INR",
    amount: baseline.amountInPaise,
    status: "captured",
    amount_refunded: 0,
  };

  // ════════════════════════════════════════════════════════════
  // 1. VALID MATCHING CASE — every field agrees → ok:true.
  // ════════════════════════════════════════════════════════════
  const okVerdict = evaluateCapturedPayment({ payment: validPayment, ...baseline });
  check("1. Fully matching, captured, INR payment → { ok: true }", okVerdict.ok === true, okVerdict);

  // ════════════════════════════════════════════════════════════
  // 2. ORDER ID MISMATCH — payment.order_id does not match the
  //    order this booking's confirm attempt expects.
  // ════════════════════════════════════════════════════════════
  const wrongOrder = evaluateCapturedPayment({
    payment: { ...validPayment, order_id: "order_DIFFERENT789" },
    ...baseline,
  });
  check("2. payment.order_id mismatch → { ok: false, code: ORDER_MISMATCH }", wrongOrder.ok === false && wrongOrder.code === "ORDER_MISMATCH", wrongOrder);

  // ════════════════════════════════════════════════════════════
  // 3. PAYMENT ID MISMATCH — the fetched payment's own id does not
  //    match the paymentId submitted by the client (e.g. a stale or
  //    swapped paymentId).
  // ════════════════════════════════════════════════════════════
  const wrongPayment = evaluateCapturedPayment({
    payment: { ...validPayment, id: "pay_DIFFERENT999" },
    ...baseline,
  });
  check("3. payment.id mismatch → { ok: false, code: PAYMENT_MISMATCH }", wrongPayment.ok === false && wrongPayment.code === "PAYMENT_MISMATCH", wrongPayment);

  // ════════════════════════════════════════════════════════════
  // 4. AMOUNT MISMATCH — paid amount differs from the booking's own
  //    locked totalAmountInPaise (e.g. a cheaper, unrelated payment
  //    reused against a pricier booking).
  // ════════════════════════════════════════════════════════════
  const wrongAmount = evaluateCapturedPayment({
    payment: { ...validPayment, amount: baseline.amountInPaise - 1 },
    ...baseline,
  });
  check("4. payment.amount mismatch (even by 1 paise) → { ok: false, code: AMOUNT_MISMATCH }", wrongAmount.ok === false && wrongAmount.code === "AMOUNT_MISMATCH", wrongAmount);

  const overAmount = evaluateCapturedPayment({
    payment: { ...validPayment, amount: baseline.amountInPaise + 100000 },
    ...baseline,
  });
  check("4b. A LARGER paid amount is ALSO rejected, not accepted as a windfall (exact-match only)", overAmount.ok === false && overAmount.code === "AMOUNT_MISMATCH", overAmount);

  // ════════════════════════════════════════════════════════════
  // 5. CURRENCY MISMATCH — same numeric amount, wrong currency unit.
  // ════════════════════════════════════════════════════════════
  const wrongCurrency = evaluateCapturedPayment({
    payment: { ...validPayment, currency: "USD" },
    ...baseline,
  });
  check("5. payment.currency !== INR → { ok: false, code: CURRENCY_MISMATCH }", wrongCurrency.ok === false && wrongCurrency.code === "CURRENCY_MISMATCH", wrongCurrency);

  // ════════════════════════════════════════════════════════════
  // 6. NOT CAPTURED — order/payment/amount/currency all match, but
  //    the payment itself was never actually captured (authorized,
  //    created, or failed). Checked LAST relative to 1-5, confirming
  //    the matching checks run independently of capture status.
  // ════════════════════════════════════════════════════════════
  for (const status of ["authorized", "created", "failed"]) {
    const v = evaluateCapturedPayment({ payment: { ...validPayment, status }, ...baseline });
    check(`6. Matching payment with status:"${status}" (not captured) → { ok: false, code: NOT_CAPTURED }`, v.ok === false && v.code === "NOT_CAPTURED", v);
  }

  // ════════════════════════════════════════════════════════════
  // 7. ALREADY REFUNDED — fully matching AND captured, but
  //    amount_refunded > 0 (a captured payment that was subsequently
  //    refunded must never be accepted as fresh proof of payment).
  // ════════════════════════════════════════════════════════════
  const refunded = evaluateCapturedPayment({
    payment: { ...validPayment, amount_refunded: baseline.amountInPaise },
    ...baseline,
  });
  check("7. Captured but fully refunded (amount_refunded > 0) → { ok: false, code: PAYMENT_REFUNDED }", refunded.ok === false && refunded.code === "PAYMENT_REFUNDED", refunded);

  const partiallyRefunded = evaluateCapturedPayment({
    payment: { ...validPayment, amount_refunded: 1 },
    ...baseline,
  });
  check("7b. Captured but even PARTIALLY refunded (amount_refunded:1) → { ok: false, code: PAYMENT_REFUNDED }", partiallyRefunded.ok === false && partiallyRefunded.code === "PAYMENT_REFUNDED", partiallyRefunded);

  // ════════════════════════════════════════════════════════════
  // 8. MISSING / NULL PAYMENT — defensive shape the caller
  //    (fetchAndEvaluateCapturedPayment) could in principle pass
  //    through if Razorpay ever returned an empty body.
  // ════════════════════════════════════════════════════════════
  const nullPayment = evaluateCapturedPayment({ payment: null, ...baseline });
  check("8. payment: null → { ok: false, code: PAYMENT_MISMATCH }, never throws", nullPayment.ok === false && nullPayment.code === "PAYMENT_MISMATCH", nullPayment);

  console.log(rows.join("\n"));
  console.log(`\nRAZORPAY PAYMENT MATCHING (PURE evaluateCapturedPayment — NO NETWORK): ${fail === 0 ? "ALL PASS" : "SOME FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
};

run().catch((err) => {
  console.error("TEST SCRIPT CRASHED:", err?.message || err);
  process.exit(1);
});
