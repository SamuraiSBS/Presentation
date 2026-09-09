const Redis = require("ioredis");
const { PrismaClient } = require("@prisma/client");

const heartbeatKey = "studydeck:health:worker";
const maxAgeMs = 45_000;
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: 1 });
const prisma = new PrismaClient({
  datasources: process.env.DATABASE_URL ? { db: { url: process.env.DATABASE_URL } } : undefined,
});

async function check() {
  const heartbeat = Number(await redis.get(heartbeatKey));
  if (!Number.isFinite(heartbeat) || Date.now() - heartbeat > maxAgeMs) {
    throw new Error("worker heartbeat is stale");
  }
  await prisma.$queryRawUnsafe("SELECT 1");
}

check()
  .then(async () => {
    await prisma.$disconnect();
    await redis.quit();
    process.exit(0);
  })
  .catch(async () => {
    await prisma.$disconnect().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(1);
  });
