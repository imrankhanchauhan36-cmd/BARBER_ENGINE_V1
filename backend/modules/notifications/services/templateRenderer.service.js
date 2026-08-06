/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/services/templateRenderer.service.js
 *
 * Notification Engine — Phase 2 (Template Renderer)
 *
 * Input: templateKey + variables. Output: { title, body } for the
 * requested channel, or null if nothing could be rendered — the
 * caller (NotificationService) is responsible for falling back to
 * its own literal text in that case. Never throws.
 *
 * Safe string substitution only — a single regex replace, no eval(),
 * no Function(), no dynamic code execution.
 */

import NotificationTemplate from "../models/NotificationTemplate.js";
import { NOTIFICATION_CHANNEL } from "../../../constants/notification.constants.js";
import logger from "../../../utils/logger.js";

//////////////////////////////////////////////////////////////
// IN-PROCESS MEMORY CACHE
//
// No Redis, no external cache. One Map entry per templateKey,
// caching BOTH hits and misses (a not-yet-seeded key would otherwise
// hit MongoDB on every single notification, since no seed data
// exists yet).
//
// Positive entries (found: true) live for the process lifetime — no
// TTL, unchanged from Phase 2. Negative entries (found: false) expire
// after NEGATIVE_CACHE_TTL_MS so that a template created later (by a
// future admin tool) is picked up within a bounded window instead of
// requiring a process restart.
//
// Each hit entry carries the template's `version` (Phase 1 field)
// alongside its content so a LATER phase can add version-aware
// invalidation (e.g. `if (cached.version !== freshVersion) refetch`,
// or an admin action calling clearTemplateCache(key)) without
// restructuring this renderer. No such comparison happens yet.
//////////////////////////////////////////////////////////////

const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const templateCache = new Map();
// entry shape:
//   { found: true,  channels, version, cachedAt } — template row exists, cached indefinitely
//   { found: false, cachedAt }                     — no active row for this key, expires after NEGATIVE_CACHE_TTL_MS

// Reserved for a later phase's invalidation logic — not called by
// anything yet, kept here so the cache's shape doesn't need to change
// when that logic is added.
export const clearTemplateCache = (templateKey) => {
  if (templateKey) {
    templateCache.delete(templateKey.toUpperCase());
  } else {
    templateCache.clear();
  }
};

//////////////////////////////////////////////////////////////
// SAFE STRING INTERPOLATION
// {{variableName}} → variables.variableName, or "" if missing/null.
// No eval, no Function(), no dynamic code — plain regex replace.
//////////////////////////////////////////////////////////////

const interpolate = (str, variables = {}) => {
  if (!str) return str ?? null;
  return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key) => {
    const value = variables[key];
    return value === undefined || value === null ? "" : String(value);
  });
};

//////////////////////////////////////////////////////////////
// RENDER
//////////////////////////////////////////////////////////////

/**
 * @param {string} templateKey
 * @param {object} [variables]
 * @param {string} [channel] - NOTIFICATION_CHANNEL value, defaults to IN_APP
 * @param {object} [context] - optional caller-identifying info for the
 *   not-found warning log only (e.g. { recipientType, recipientId }).
 *   Never affects rendering.
 * @returns {Promise<{title:string|null, body:string|null}|null>}
 *   null means "nothing to render" — caller must fall back.
 */
export const renderTemplate = async (
  templateKey,
  variables = {},
  channel = NOTIFICATION_CHANNEL.IN_APP,
  context = {}
) => {
  if (!templateKey) return null;
  const key = templateKey.toUpperCase();

  let entry = templateCache.get(key); // Memory Cache

  // Negative entries expire after NEGATIVE_CACHE_TTL_MS — positive
  // entries never expire here (unchanged). An expired negative entry
  // is treated exactly like a fresh miss below.
  if (entry && !entry.found && (Date.now() - entry.cachedAt) > NEGATIVE_CACHE_TTL_MS) {
    entry = null;
  }

  if (!entry) {
    // Cache Miss → MongoDB
    let template = null;
    try {
      template = await NotificationTemplate.findOne({
        templateKey: key,
        isActive:    true,
        isDeleted:   false,
      }).lean();
    } catch (dbErr) {
      // Never let a DB hiccup break notification delivery — treat
      // exactly like "not found" for this call, but don't cache the
      // failure (a transient DB error shouldn't be remembered forever).
      logger.warn("[templateRenderer] template lookup failed — using fallback", {
        templateKey: key, channel, error: dbErr.message, ...context,
      });
      return null;
    }

    entry = template
      ? { found: true, channels: template.channels, version: template.version, cachedAt: Date.now() }
      : { found: false, cachedAt: Date.now() };

    templateCache.set(key, entry); // Update Cache
  }

  if (!entry.found) {
    logger.warn("[templateRenderer] templateKey not found — using fallback", {
      templateKey: key, channel, ...context,
    });
    return null;
  }

  const content = entry.channels?.[channel];
  if (!content || (!content.title && !content.body)) {
    logger.warn("[templateRenderer] no content for channel — using fallback", {
      templateKey: key, channel, ...context,
    });
    return null;
  }

  return {
    title: interpolate(content.title, variables),
    body:  interpolate(content.body, variables),
  };
};
