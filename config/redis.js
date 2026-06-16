import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.warn("⚠️ Redis max retries reached, giving up");
        return false;
      }
      return Math.min(retries * 100, 3000);
    },
    connectTimeout: 10000,
    keepAlive: 5000,
  },
});

redis.on("error",       (err) => console.warn("⚠️ Redis Error:", err.message));
redis.on("connect",     ()    => console.log("🧠 Redis Connected"));
redis.on("ready",       ()    => console.log("⚡ Redis Ready for Operations"));
redis.on("reconnecting",()    => console.log("🔄 Redis Reconnecting..."));
redis.on("end",         ()    => console.warn("🔴 Redis Connection Closed"));

try {
  await redis.connect();
} catch (err) {
  console.warn("⚠️ Redis unavailable, continuing without cache");
}

export const isRedisReady = () => redis.isReady;

process.on("SIGINT", async () => {
  try {
    await redis.quit();
    console.log("🔴 Redis connection closed cleanly");
  } catch (_) {}
  process.exit(0);
});

export default redis;