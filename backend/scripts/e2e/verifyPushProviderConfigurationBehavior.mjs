/**
 * BARBER_ENGINE_V1
 * backend/scripts/e2e/verifyPushProviderConfigurationBehavior.mjs
 *
 * Centralized notification system, Phase 2 — proves
 * modules/notifications/providers/PushProvider.js's "honest outcome,
 * never a fake success" behavior across every provider-configuration
 * state that can be exercised WITHOUT real Firebase/Expo credentials
 * and WITHOUT ever reaching a real network endpoint:
 *
 *   1. PUSH_PROVIDER="none" (the default) — explicit, structurally
 *      honest no-op.
 *   2. PUSH_PROVIDER="fcm" with no Firebase env vars configured —
 *      PUSH_PROVIDER_NOT_CONFIGURED, never a fabricated success.
 *   3. A recipient with zero registered device tokens, regardless of
 *      provider — NO_DEVICE_TOKEN, not a crash.
 *   4. PUSH_PROVIDER="expo" with only non-Expo-shaped token strings
 *      registered — NO_VALID_EXPO_TOKEN. Confirmed by direct code
 *      read: Expo.isExpoPushToken() is a pure string-format check, so
 *      this path never calls expo.sendPushNotificationsAsync() at
 *      all — no network reach, nothing sent.
 *
 * Does NOT exercise a real provider acceptance or a real device
 * receiving anything — that requires real credentials this
 * environment does not have (see this phase's own report). The
 * network guard below is a second, independent safety net proving
 * none of these four checks ever attempts an outbound call, not just
 * an assumption from reading the source.
 *
 * Run (only after explicit approval — not run as part of writing this file):
 *   cd backend && node scripts/e2e/verifyPushProviderConfigurationBehavior.mjs
 */

import net from "net";

let pass = 0, fail = 0;
const rows = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; rows.push(`  ✅ ${name}`); }
  else { fail++; rows.push(`  ❌ ${name}${extra !== undefined ? `  (got: ${JSON.stringify(extra)})` : ""}`); }
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0", "::"]);
let networkGuardInstalled = false;
let blockedAttempts = [];

const installNetworkGuard = () => {
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    let host = null;
    if (typeof args[0] === "object" && args[0] !== null) {
      host = args[0].host ?? args[0].address ?? null;
    } else if (typeof args[1] === "string") {
      host = args[1];
    }
    const isLoopback = host === null || LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
    if (!isLoopback) {
      blockedAttempts.push(host);
      throw new Error(`NETWORK GUARD: blocked outbound connection attempt to non-loopback host "${host}"`);
    }
    return originalConnect.apply(this, args);
  };
  networkGuardInstalled = true;
};

const run = async () => {
  const { MongoMemoryReplSet } = await import("mongodb-memory-server");
  const mongoose = (await import("mongoose")).default;

  process.env.JWT_ACCESS_SECRET = "ze2e-push-provider-test-secret-not-used-for-auth";
  process.env.SKIP_REDIS_AUTOCONNECT = "true";
  delete process.env.REDIS_URL;
  // Explicit, defensive: confirm this run truly has no Firebase/Expo
  // credentials — a false pass here would mean the environment, not
  // the code, made check 2 misleading.
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  delete process.env.EXPO_ACCESS_TOKEN;

  const mem = await MongoMemoryReplSet.create({ replSet: { count: 1 } });

  try {
    await mongoose.connect(mem.getUri(), { dbName: "push_provider_configuration_behavior" });
    delete process.env.MONGODB_URI;

    installNetworkGuard();

    const User = (await import("../../models/User.js")).default;
    const DeviceToken = (await import("../../modules/notifications/models/DeviceToken.js")).default;

    const owner = await User.create({ name: "ZE2E_PUSH_PROVIDER_OWNER", phone: "9000000001", role: "OWNER", accountStatus: "ACTIVE" });

    // ── 1. PUSH_PROVIDER="none" (default) — honest no-op ────────────
    delete process.env.PUSH_PROVIDER;
    const PushProviderNone = (await import(`../../modules/notifications/providers/PushProvider.js?t=${Date.now()}1`)).default;
    await DeviceToken.create({ recipientType: "SALON", recipientId: owner._id, token: "ExponentPushToken[ze2e-none-test]", platform: "ANDROID", provider: "EXPO", isValid: true });
    const noneResult = await PushProviderNone.send({ recipientId: owner._id, recipientType: "SALON", title: "Test", message: "Test message" });
    check("1a. PUSH_PROVIDER=none returns success:true, dev:true — honest, structurally-complete no-op", noneResult.success === true && noneResult.dev === true && noneResult.provider === "none", noneResult);
    check("1b. PUSH_PROVIDER=none never claims a real messageId", noneResult.messageId === null, noneResult);

    // ── 2. PUSH_PROVIDER="fcm" with NO credentials — honest failure ─
    process.env.PUSH_PROVIDER = "fcm";
    const PushProviderFcm = (await import(`../../modules/notifications/providers/PushProvider.js?t=${Date.now()}2`)).default;
    const fcmResult = await PushProviderFcm.send({ recipientId: owner._id, recipientType: "SALON", title: "Test", message: "Test message" });
    check("2a. PUSH_PROVIDER=fcm with no Firebase env vars → success:false", fcmResult.success === false, fcmResult);
    check("2b. The error is specifically PUSH_PROVIDER_NOT_CONFIGURED, never a fabricated success", fcmResult.error === "PUSH_PROVIDER_NOT_CONFIGURED", fcmResult);

    // ── 3. Zero registered device tokens, regardless of provider ────
    const recipientWithNoTokens = new mongoose.Types.ObjectId();
    const noTokenResult = await PushProviderFcm.send({ recipientId: recipientWithNoTokens, recipientType: "SALON", title: "Test", message: "Test message" });
    check("3. A recipient with zero device tokens → NO_DEVICE_TOKEN, not a crash, regardless of provider mode", noTokenResult.success === false && noTokenResult.error === "NO_DEVICE_TOKEN", noTokenResult);

    // ── 4. PUSH_PROVIDER="expo" with only invalid-shaped tokens ──────
    process.env.PUSH_PROVIDER = "expo";
    const PushProviderExpo = (await import(`../../modules/notifications/providers/PushProvider.js?t=${Date.now()}3`)).default;
    const invalidTokenOwner = await User.create({ name: "ZE2E_INVALID_TOKEN_OWNER", phone: "9000000002", role: "OWNER", accountStatus: "ACTIVE" });
    await DeviceToken.create({ recipientType: "SALON", recipientId: invalidTokenOwner._id, token: "not-a-real-expo-push-token", platform: "ANDROID", provider: "EXPO", isValid: true });
    const invalidExpoResult = await PushProviderExpo.send({ recipientId: invalidTokenOwner._id, recipientType: "SALON", title: "Test", message: "Test message" });
    check("4. PUSH_PROVIDER=expo with only a non-Expo-shaped token → NO_VALID_EXPO_TOKEN, never attempts a send", invalidExpoResult.success === false && invalidExpoResult.error === "NO_VALID_EXPO_TOKEN", invalidExpoResult);

    // ── Network guard sanity — proves none of the above reached out ─
    check("5. Network guard was installed before any provider was exercised", networkGuardInstalled === true, networkGuardInstalled);
    check("6. Network guard recorded ZERO blocked non-loopback attempts — confirms no real network call was ever attempted by any of the 4 cases above", blockedAttempts.length === 0, blockedAttempts);

  } finally {
    await mongoose.disconnect();
    await mem.stop();
  }
};

run()
  .then(() => {
    console.log(rows.join("\n"));
    console.log(`\nPUSH PROVIDER CONFIGURATION BEHAVIOR: ${fail === 0 ? "ALL PASS" : "FAILURES PRESENT"} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.log(rows.join("\n"));
    console.error("\nFATAL (script-level, not an assertion failure):", err.message);
    process.exit(1);
  });
