# Outbox — Email Job Scheduler

A production-shaped email scheduler: React/TS dashboard → Express/TS API → Postgres (source of truth) → BullMQ/Redis (delayed job scheduling) → Nodemailer/Ethereal (send) → Elasticsearch (search) → Slack (rate-limit alerts).

```
frontend/   React + TS + Vite + Tailwind dashboard
backend/    Express + TS API, BullMQ worker, Prisma/Postgres, Elasticsearch, Slack + Google OAuth
docker-compose.yml   Postgres, Redis, Elasticsearch
```

## 1. Prerequisites

- Node.js 20+
- Docker Desktop (for Postgres/Redis/Elasticsearch) — or point `DATABASE_URL` / `REDIS_HOST` / `ELASTICSEARCH_NODE` at your own instances

## 2. Start infrastructure

```bash
docker compose up -d
```

This starts Postgres (`5432`), Redis with AOF persistence enabled (`6379`), and a single-node Elasticsearch (`9200`).

## 3. Backend

```bash
cd backend
cp .env.example .env      # fill in OAuth credentials, see section 6
npm install
npm run prisma:migrate    # creates tables from prisma/schema.prisma
npm run dev                # API on :4000
```

In a second terminal, start the worker (separate process, so scaling send throughput doesn't mean scaling the API):

```bash
cd backend
npm run worker:dev
```

Bull Board (live queue dashboard) is served at **http://localhost:4000/admin/queues**.

## 4. Frontend

```bash
cd frontend
cp .env.example .env      # VITE_API_URL, defaults to http://localhost:4000
npm install
npm run dev                # dashboard on :5173
```

## 5. Trying it end-to-end

1. Open http://localhost:5173 → **Login with Google** (needs credentials, see below).
2. A new user automatically gets one ready-to-send **Ethereal** sender (`nodemailer.createTestAccount()` under the hood — no real email account needed).
3. Click **Compose**, add recipients (type one, or **Upload List** a CSV/TXT of leads), write a subject/body, set delay + hourly limit, pick a send time via the clock icon, and hit **Send**.
4. Watch the job move through Bull Board, then show up under **Sent** once the worker processes it. Every send logs a real Ethereal preview URL you can open to see the actual email.

## 6. OAuth setup (required for login/Slack — not included, per assignment scope)

The code paths are real (`passport-google-oauth20`, Slack OAuth v2 + `chat.postMessage`/incoming webhook) but need your own app credentials — these can't be fabricated.

**Google** — [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → OAuth Client ID (Web application):
- Authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
- Paste `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` into `backend/.env`

**Slack** — [api.slack.com/apps](https://api.slack.com/apps) → Create App → OAuth & Permissions:
- Redirect URL: `http://localhost:4000/api/slack/callback`
- Bot Token Scopes: `chat:write`, `incoming-webhook`
- Paste `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` into `backend/.env`

Until these are set, the relevant endpoints return `503` with a clear message instead of crashing, and the frontend shows an inline error rather than a blank page.

---

## Architecture notes

### Why Postgres + BullMQ, not just BullMQ

Postgres is the source of truth for every scheduled email (`ScheduledEmail` table); BullMQ/Redis only holds the *scheduling mechanism* (delayed jobs). This split is what makes restart-safety and idempotency straightforward:

- **No cron.** Every recipient becomes one row with a `scheduledAt` and one BullMQ job added with `delay = scheduledAt - now` (`backend/src/routes/emails.ts`). Redis fires the job at that timestamp — no polling loop, no cron process.
- **Idempotency.** Each job's id is deterministic: `email-${scheduledEmailId}` (`backend/src/queues/emailQueue.ts`). BullMQ treats adding a job with an id that already exists as a no-op, so double-submitting a schedule request, or re-running reconciliation below, can never enqueue (or send) the same email twice. The worker also checks `status === "sent"` before sending as a second guard.
- **Restart safety.** Redis's AOF persistence (enabled in `docker-compose.yml`) means delayed jobs already survive a plain process/container restart on their own. On top of that, `backend/src/services/reconcile.ts` runs at both API and worker startup: it scans Postgres for any `scheduled` / `rate_limited_delayed` row that has no matching BullMQ job (covering the edge case where Redis itself was wiped) and re-enqueues it with the same deterministic job id — so it's safe to run on every boot.

### Concurrency, delay, and rate limiting

- **Worker concurrency** — `WORKER_CONCURRENCY` env var (default 5), passed straight to `new Worker(..., { concurrency })`. Each concurrent job is one recipient send.
- **Minimum delay between sends** — `MIN_DELAY_BETWEEN_EMAILS_MS` env var (default **2000ms**), enforced globally via BullMQ's built-in worker `limiter: { max: 1, duration }`, so sends across *all* senders/batches are throttled to that floor regardless of concurrency. This mimics provider-level throttling independent of any one campaign's settings.
- **Per-sender hourly cap** — each compose batch also carries its own `hourlyLimit` (falls back to `MAX_EMAILS_PER_HOUR_PER_SENDER` if unset). This is enforced in `backend/src/services/rateLimiter.ts` with a **Redis `INCR` + `PEXPIRE` inside a single Lua script**, keyed by `ratelimit:sender:{senderId}:{YYYYMMDDHH}`. Doing the check-and-increment atomically in one round trip is what makes it safe across multiple worker processes/instances — a plain "GET count, compare, then INCR" from Node would race under concurrency and let the count overshoot.
- **What happens at the cap** — the job is **never dropped or failed**. The worker processor calls `job.moveToDelayed(nextHourTimestamp, token)` and throws BullMQ's `DelayedError`, which reschedules that exact job into the next UTC hour window (with a small random jitter so a burst doesn't all fire at :00:00 sharp) while keeping its place in the queue. The row's status flips to `rate_limited_delayed` so the dashboard reflects it. For a 1000+ email burst against one sender, this means the first `hourlyLimit` go out this hour and the rest cascade one hour window at a time until they clear — no manual intervention needed.

### Slack notifications

`backend/src/services/slack.ts` implements a real OAuth v2 flow (`/api/slack/connect` → Slack → `/api/slack/callback`, token exchange via `oauth.v2.access`) and stores the resulting bot token / incoming webhook per user in `SlackIntegration`. The worker calls `notifySlackRateLimitHit` the moment a sender's hourly cap is hit (deduped via a Redis `SET NX` flag so a 1000-email burst hitting the cap in the same second sends **one** Slack message per sender per hour window, not a flood). If the user never connected Slack, `notifySlackRateLimitHit` is a no-op — it looks up the integration, finds nothing, and returns; no crash, no log spam. Reconnecting later works immediately since the lookup happens per-call, not at boot.

### Search

Elasticsearch is treated as a secondary index, not a dependency the app can go down over: `ensureEmailIndex()` swallows connection failures at startup and every index/search call is wrapped so a missing/unreachable ES degrades search results (`{ degraded: true }`) without touching scheduling or sending. Emails are bulk-indexed on schedule creation and re-indexed on status transitions (`sent`/`failed`).

### Trade-offs / what's simplified for this assignment

- Email/password login is shown in the UI (per the Figma) but intentionally disabled — only Google OAuth is wired up, since a second real auth system wasn't in scope.
- The compose editor is a lightweight `contentEditable` + `document.execCommand` toolbar rather than a full rich-text library, to avoid an extra heavy dependency for formatting that isn't validated by the API.
- Attachments are inlined as `<img>` tags in the HTML body (via `FileReader` → data URL) rather than true SMTP MIME attachments — sufficient for the Ethereal demo flow without adding multipart handling.
