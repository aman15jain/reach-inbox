import IORedis from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest: null on connections it manages.
// This single connection is shared by the queue, the worker, and the
// Redis-backed rate-limit counters so we don't leak sockets per module.
export const redis = new IORedis({
  host: env.redisHost,
  port: env.redisPort,
  password: env.redisPassword,
  maxRetriesPerRequest: null,
  // Managed free-tier Redis (e.g. Upstash) requires TLS; local/Docker Redis
  // doesn't speak it at all, so this stays opt-in via REDIS_TLS.
  tls: env.redisTls ? {} : undefined,
});

redis.on("error", (err) => {
  console.error("[redis] connection error", err.message);
});
