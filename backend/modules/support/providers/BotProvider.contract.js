/**
 * BARBER ENGINE V1
 * backend/modules/support/providers/BotProvider.contract.js
 *
 * Phase H — Bot Support. Mirrors
 * modules/notifications/providers/NotificationProvider.contract.js's
 * own philosophy (normalized result, never throw for an expected
 * outcome, runtime shape assertion) — but a PARALLEL contract, not a
 * reuse of that one, since classify()/generateReply() are a
 * categorically different operation shape than send-to-channel.
 *
 * Every bot provider (DevBotProvider today; a real AI provider later,
 * in a separately-approved phase) must implement BOTH methods and
 * return these normalized shapes — never throw. NOT_CONFIGURED is a
 * first-class, expected outcome, not an error path.
 *
 * @typedef {Object} BotClassifyResult
 * @property {boolean} success
 * @property {string|null} categoryCode - a SupportCategory.code value, or null
 * @property {number|null} confidence - 0..1
 * @property {string|null} error - null iff success === true
 *
 * @typedef {Object} BotReplyResult
 * @property {boolean} success
 * @property {string|null} reply
 * @property {string|null} error - null iff success === true
 */

import { Errors } from "../../../utils/response.js";

const CLASSIFY_KEYS = ["success", "categoryCode", "confidence", "error"];
const REPLY_KEYS = ["success", "reply", "error"];

export const assertValidClassifyResult = (result) => {
  if (!result || typeof result !== "object") {
    throw Errors.internal("Bot provider returned an invalid classify() result shape");
  }
  for (const key of CLASSIFY_KEYS) {
    if (!(key in result)) {
      throw Errors.internal(`Bot provider classify() result missing required key "${key}"`);
    }
  }
};

export const assertValidReplyResult = (result) => {
  if (!result || typeof result !== "object") {
    throw Errors.internal("Bot provider returned an invalid generateReply() result shape");
  }
  for (const key of REPLY_KEYS) {
    if (!(key in result)) {
      throw Errors.internal(`Bot provider generateReply() result missing required key "${key}"`);
    }
  }
};
