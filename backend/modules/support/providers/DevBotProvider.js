/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/DevBotProvider.js
 *
 * Phase H — Bot Support. DEV/TEST ONLY — deterministic, rule-based.
 * NO real AI/LLM API, NO external credentials, NO network call at all.
 * Exact sibling in spirit to the dev adapters already built for Email/
 * WhatsApp/Call (a safe, fully offline stand-in for a real provider
 * that would be added later, in a separately-approved phase, without
 * this file or its callers needing to change beyond the resolver's own
 * registration).
 *
 * Pure functions — no DB access, no Mongoose import. The caller
 * (supportBot.service.js) is responsible for fetching candidate
 * SupportCategory documents and passing them in; this keeps the
 * provider fully swappable for a real API call later (a real provider
 * would receive the exact same plain-object inputs).
 *
 * Deterministic by construction: the same input always produces the
 * same output — no randomness, no hidden state.
 */

// Small, explicit keyword -> businessDomain map, used only to score
// candidate categories against the customer's text. Never a source of
// truth on its own — a candidate must ALSO exist as a real,
// active SupportCategory (fetched by the caller) to ever be selected.
const DOMAIN_KEYWORDS = {
  PAYMENT: ["payment", "paid", "pay", "charged", "deduct", "deducted", "money", "amount", "transaction"],
  BOOKING: ["booking", "book", "appointment", "slot", "schedule", "confirm", "confirmed"],
  SALON: ["salon", "shop", "store", "location"],
  SERVICE: ["service", "haircut", "hair", "styling", "treatment"],
  WALLET: ["wallet", "balance", "credit"],
  PAYOUT: ["payout", "settlement", "earning"],
  USER: ["account", "profile", "login", "password"],
};

function scoreText(text) {
  const lower = String(text || "").toLowerCase();
  const scores = {};
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const hits = keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > 0) scores[domain] = hits;
  }
  return scores;
}

const DevBotProvider = Object.freeze({
  name: "DEV_RULE_BASED",

  /**
   * @param {object} payload
   * @param {string} payload.text - the customer's message (untrusted data)
   * @param {Array<{code:string, name:string, businessDomain:string|null}>} payload.categoryOptions
   * @param {Array<{senderType:string, body:string}>} [payload.context] - bounded, CUSTOMER_VISIBLE-only recent history; unused by this deterministic provider, accepted so the plumbing matches what a real provider would need
   * @returns {Promise<import("./BotProvider.contract.js").BotClassifyResult>}
   */
  classify: async ({ text, categoryOptions = [], context = [] }) => {
    const domainScores = scoreText(text);
    const totalHits = Object.values(domainScores).reduce((a, b) => a + b, 0);

    if (totalHits === 0) {
      // No confident signal at all — never guess a category.
      return { success: true, categoryCode: null, confidence: 0, error: null };
    }

    // Best-scoring domain, ties broken by first-seen order (deterministic).
    const bestDomain = Object.entries(domainScores).sort((a, b) => b[1] - a[1])[0][0];
    const bestDomainHits = domainScores[bestDomain];

    // Only a real, active category for that domain counts as a match —
    // never invent a category code that doesn't exist.
    const matchedCategory = categoryOptions.find((c) => c.businessDomain === bestDomain);
    if (!matchedCategory) {
      return { success: true, categoryCode: null, confidence: 0, error: null };
    }

    // Deterministic confidence heuristic: more distinct keyword hits
    // and no competing domain -> higher confidence. Capped well below
    // 1.0 — a rule-based matcher should never claim full certainty.
    const distinctDomainsMatched = Object.keys(domainScores).length;
    const confidence = distinctDomainsMatched === 1 ? Math.min(0.6 + bestDomainHits * 0.1, 0.9) : 0.4;

    return { success: true, categoryCode: matchedCategory.code, confidence, error: null };
  },

  /**
   * @param {object} payload
   * @param {"REPLY"|"CLARIFY"} payload.mode
   * @param {string|null} [payload.categoryName]
   * @returns {Promise<import("./BotProvider.contract.js").BotReplyResult>}
   *
   * NOTE: this phase's bot never states a "verified fact" — resolveTicketVerification()
   * hard-requires an AGENT/SUPPORT_ADMIN actor (existing, unmodified
   * authorization rule), which a bot is not. A query needing a real
   * fact is escalated instead (see supportBot.service.js) — a
   * deliberate, approved reduction of scope, not a missing feature.
   */
  generateReply: async ({ mode, categoryName = null }) => {
    if (mode === "CLARIFY") {
      const reply = categoryName
        ? `Thanks for reaching out about ${categoryName.toLowerCase()}. Could you share a few more details (e.g. your booking ID or the approximate date/time) so we can look into this?`
        : "Thanks for reaching out. Could you share a few more details so we can help you faster?";
      return { success: true, reply, error: null };
    }

    const reply = "Thanks for the details. A member of our support team will follow up if anything further is needed.";
    return { success: true, reply, error: null };
  },
});

export default DevBotProvider;
