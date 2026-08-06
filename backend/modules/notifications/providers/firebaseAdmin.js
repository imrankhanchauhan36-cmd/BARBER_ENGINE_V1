/**
 * BARBER_ENGINE_V1
 * backend/modules/notifications/providers/firebaseAdmin.js
 *
 * Notification Engine — Phase 5 (Firebase Admin SDK singleton)
 *
 * Modern modular Firebase Admin API only (firebase-admin/app,
 * firebase-admin/messaging) — no deprecated namespaced admin.* API.
 *
 * Singleton, lazy initialization: the Firebase app is created at most
 * ONCE per process, and only on the first actual attempt to send a
 * push (not at module import time) — so importing this file, or
 * running with PUSH_PROVIDER=none (the default), never requires
 * Firebase credentials to be configured at all.
 *
 * Credentials come ONLY from environment variables:
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (with literal "\n" sequences, as env vars
 *                           can't hold real newlines — unescaped below)
 * No hardcoded credentials anywhere in this file.
 */

import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import logger from "../../../utils/logger.js";

let messagingInstance = null;

const buildCredential = () => {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return cert({
    projectId,
    clientEmail,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  });
};

/**
 * Returns the shared Messaging instance, or null if Firebase
 * credentials aren't configured (or are malformed) — callers must
 * treat null as "not configured" and report it as such. Never
 * throws: cert() can throw synchronously on a malformed private key
 * (verified — not hypothetical), so the whole init sequence,
 * including credential construction, is inside one try/catch, not
 * just initializeApp() itself.
 */
export const getFirebaseMessaging = () => {
  if (messagingInstance) return messagingInstance;

  try {
    // getApps().length guard — the standard idiom to guarantee the
    // Firebase app is never initialized more than once per process,
    // even across multiple import sites of this module.
    if (!getApps().length) {
      const credential = buildCredential();
      if (!credential) return null;

      initializeApp({ credential });
    }

    messagingInstance = getMessaging();
    return messagingInstance;
  } catch (err) {
    logger.error("[firebaseAdmin] Firebase initialization failed", { error: err.message });
    return null;
  }
};
