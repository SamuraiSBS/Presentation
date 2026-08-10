const Redis = require("ioredis");

const heartbeatKey = "studydeck:health:worker";
const maxAgeMs = 45_000;
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: 1 });

async function check() {
  const heartbeat = Number(await redis.get(heartbeatKey));
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > maxAgeMs) {
    throw new Error("worker heartbeat is stale");
  }
}

check()
  .then(() => redis.quit().then(() => process.exit(0)))
  .catch(() => redis.quit().catch(() => undefined).finally(() => process.exit(1)));
