import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendUrl: required("FRONTEND_URL", "http://localhost:5173"),
  backendUrl: required("BACKEND_URL", "http://localhost:4000"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-me"),

  databaseUrl: required("DATABASE_URL"),

  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisTls: process.env.REDIS_TLS === "true",

  elasticsearchNode: process.env.ELASTICSEARCH_NODE ?? "http://localhost:9200",
  elasticsearchIndex: process.env.ELASTICSEARCH_INDEX ?? "emails",
  // Elastic Cloud Serverless requires API-key auth; the local/Docker ES
  // container runs with security disabled, so this stays optional.
  elasticsearchApiKey: process.env.ELASTICSEARCH_API_KEY || undefined,

  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  minDelayBetweenEmailsMs: Number(process.env.MIN_DELAY_BETWEEN_EMAILS_MS ?? 2000),
  maxEmailsPerHourPerSender: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 200),

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",

  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
};

export const isGoogleOAuthConfigured = Boolean(env.googleClientId && env.googleClientSecret);
export const isSlackOAuthConfigured = Boolean(env.slackClientId && env.slackClientSecret);
