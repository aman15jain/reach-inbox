# Outbox — Email Job Scheduler

A production-shaped email scheduler: React/TS dashboard → Express/TS API → PostgreSQL (source of truth) → BullMQ/Redis (delayed job scheduling) → Nodemailer/Ethereal (send) → Elasticsearch (search index) → Slack (rate-limit alerts).

```
frontend/   React + TS + Vite + Tailwind dashboard
backend/    Express + TS API, BullMQ worker, Prisma/Postgres, Elasticsearch, Slack + Google OAuth
docker-compose.yml   Postgres, Redis, Elasticsearch
```

---

## 1. How to Run the Project

### 1.1 Backend

**Install dependencies**

```bash
cd backend
npm install
```

**Configure environment variables**

```bash
cp .env.example .env
```

Then edit `backend/.env`. At minimum for local dev you need `DATABASE_URL`, `REDIS_HOST`/`REDIS_PORT`, and a `JWT_SECRET`. Google/Slack login won't work until you also add real OAuth credentials:

- **Google** — [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → OAuth Client ID (Web application) → Authorized redirect URI `http://localhost:4000/api/auth/google/callback` → paste `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Slack** — [api.slack.com/apps](https://api.slack.com/apps) → Create App → OAuth & Permissions → Redirect URL `http://localhost:4000/api/slack/callback`, Bot Token Scopes `chat:write` + `incoming-webhook` → paste `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.

Until those are set, `/api/auth/google` and `/api/slack/connect` return `503` with a clear message instead of crashing (`isGoogleOAuthConfigured` / `isSlackOAuthConfigured` in `backend/src/config/env.ts`), and the frontend shows an inline error instead of a blank page.

**Start PostgreSQL**

Either via Docker:

```bash
docker compose up -d postgres
```

or point `DATABASE_URL` in `.env` at any Postgres instance you already have running (local install, Render, Neon, etc.).

**Start Redis**

Either via Docker:

```bash
docker compose up -d redis
```

or point `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` (and `REDIS_TLS=true` if the provider requires TLS, e.g. a managed free Redis like Upstash) at any Redis-compatible instance.

**Run Prisma migrations**

```bash
npm run prisma:migrate
```

This applies `backend/prisma/schema.prisma` against `DATABASE_URL` and creates the tables (`User`, `Sender`, `ScheduledEmail`, `SlackIntegration`).

**Local development — two separate processes**

```bash
npm run dev          # Express API on :4000, auto-restarts on file changes
```

```bash
npm run worker:dev   # BullMQ worker, separate terminal, auto-restarts on file changes
```

These are the commands to use for local development. They run the API and the worker as two independent processes, which is the architecture this project is built around (see §3 and §8).

**Combined production-style command**

```bash
npm run build        # tsc compiles src/ -> dist/
npm run start:all     # runs dist/startAll.js
```

`start:all` is **not** a local-dev command — it's what a single-process production deployment (e.g. one free Render Web Service, see `backend/src/startAll.ts`) uses to run the compiled API and the compiled worker together, as two real `node` child processes under one parent, since that environment only gives you one process to run. Locally, prefer `npm run dev` + `npm run worker:dev` in two terminals — that's what you're actually developing against day to day.

Bull Board (live BullMQ queue dashboard) is served at **http://localhost:4000/admin/queues** by the API process either way.

### 1.2 Frontend

**Install dependencies**

```bash
cd frontend
npm install
```

**Configure environment variables**

```bash
cp .env.example .env
```

`frontend/.env` needs exactly one variable: `VITE_API_URL` (defaults to `http://localhost:4000`) — the base URL the dashboard calls for every backend request.

**Start the frontend**

```bash
npm run dev
```

**Expected local URLs**

| | URL |
|---|---|
| Frontend (dashboard) | http://localhost:5173 |
| Backend API | http://localhost:4000 |
| Bull Board | http://localhost:4000/admin/queues |

---

## 2. Ethereal Email Setup

This project sends real SMTP mail through [Ethereal Email](https://ethereal.email/) — a fake SMTP service made for testing: messages are actually accepted and stored over real SMTP, but they're never delivered to a real inbox. Every send returns a preview URL where you can open the message exactly as it would have rendered.

**How Ethereal accounts are created — no static credentials at all.** Unlike a normal SMTP integration, this project does **not** read Ethereal host/port/user/password from environment variables, and none exist in `.env.example`. Instead, `backend/src/services/mailer.ts` calls `nodemailer.createTestAccount()`, which hits Ethereal's API and generates a brand-new inbox (host, port, user, password) on the spot. This happens automatically **once per sender**:

- When a user signs in with Google for the first time, `backend/src/passport/google.ts` creates their `User` row and immediately calls `createEtherealAccount()` to provision one `Sender` for them, with its own unique Ethereal SMTP credentials stored in the `Sender` table (`smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`).
- `POST /api/senders` (`backend/src/routes/senders.ts`) does the same thing on demand for any additional sender a user creates.

**No setup or credentials are required from you** — this works out of the box, locally or in any deployment, with zero configuration. There is nothing to obtain manually from ethereal.email; the app obtains a fresh account for you automatically.

**Viewing a sent email:** `backend/src/services/mailer.ts` calls `nodemailer.getTestMessageUrl(info)` right after sending and stores it on the row as `ScheduledEmail.previewUrl`. That URL is returned from `GET /api/emails/sent` — open it in a browser to see the actual rendered email (subject, body, any inlined images).

**Limitation:** these are test emails only. Nothing is ever delivered to a real recipient's inbox, regardless of what address you put in "To" — Ethereal exists specifically so you can verify the sending pipeline works without spamming real addresses.

---

## 3. Architecture Overview

### A. Scheduling

1. The frontend's Compose flow (`ComposeModal.tsx`) collects a sender, subject, HTML body, a recipient list, a start time, a per-batch delay, and an hourly limit, then calls `POST /api/emails/schedule`.
2. `backend/src/routes/emails.ts` computes one `scheduledAt` per recipient — `startTime + index * delayBetweenEmailsMs` — and bulk-inserts one `ScheduledEmail` row per recipient into **PostgreSQL** via `prisma.scheduledEmail.createMany`.
3. For every row it adds one **BullMQ** job to the `email-send` queue (`emailQueue.addBulk`, `backend/src/queues/emailQueue.ts`) with `delay = scheduledAt - now`. **Redis** holds that delayed job and fires it at the right time — there is no cron job, no polling loop, and no `setInterval` anywhere in this codebase.
4. When a job becomes due, the **BullMQ worker** (`backend/src/workers/emailWorker.ts`) picks it up, re-reads the `ScheduledEmail` row (plus its `Sender`) from Postgres, and calls `sendEmail()` (`backend/src/services/mailer.ts`), which sends real SMTP mail through that sender's Ethereal account.
5. The row's `status` is updated to `sent` (with `sentAt` and `previewUrl`) or `failed` (with the error message), and the same document is written to **Elasticsearch** for search (see §4).

### B. Persistence / Restart Recovery

**What's persisted in PostgreSQL** — every scheduled email is a durable row (`ScheduledEmail`: recipient, subject, body, sender, batch id, scheduled time, status, attempts, error, sent time, Ethereal preview URL, and the BullMQ job id it's tied to), plus `User`, `Sender` (including its per-sender Ethereal SMTP credentials), and `SlackIntegration`. Postgres is the source of truth; BullMQ/Redis only holds the *scheduling mechanism* (the delayed jobs themselves), not any data that can't be reconstructed from Postgres.

**After a restart:**

- Redis's AOF persistence (`docker-compose.yml`: `redis-server --appendonly yes`) means BullMQ's delayed jobs already survive a plain process or container restart on their own — nothing needs to re-fire them.
- On top of that, both entrypoints (`backend/src/server.ts` and `backend/src/workers/runWorker.ts`) call `reconcileScheduledEmails()` (`backend/src/services/reconcile.ts`) at startup. It:
  1. Queries every `ScheduledEmail` row with status `scheduled`, `processing`, or `rate_limited_delayed`.
  2. For each one, calls `emailQueue.getJob(emailJobId(id))` to check whether a BullMQ job for it still exists in Redis.
  3. If the job is missing (e.g. Redis was wiped or replaced), it re-enqueues it with `enqueueEmailJob(id, scheduledAt - now)` — using the exact same deterministic job id, so this can never create a duplicate.
  4. Any row still marked `processing` (meaning the worker crashed mid-send) is reset to `scheduled` before being re-enqueued, so it's retried cleanly instead of stuck forever.
- **Idempotency:** every job's id is deterministic — `` `email-${scheduledEmailId}` `` (`emailJobId()` in `backend/src/queues/emailQueue.ts`). BullMQ treats adding a job whose id already exists as a no-op, so re-running reconciliation, or a double-submitted schedule request, can never enqueue the same email twice. The worker also refuses to send if the row's `status` is already `sent`, as a second, independent guard.

### C. Rate Limiting

- **Hourly per-sender limit.** Each compose batch carries its own `hourlyLimit` (falling back to `MAX_EMAILS_PER_HOUR_PER_SENDER` if not set). Before every send, the worker calls `tryConsumeHourlySlot(senderId, hourlyLimit)` (`backend/src/services/rateLimiter.ts`).
- **How Redis enforces it.** That function runs a single **Redis Lua script** (`EVAL`) that atomically increments a counter keyed `` `ratelimit:sender:{senderId}:{YYYYMMDDHH}` `` (a UTC-hour bucket, `PEXPIRE`d to one hour on first use), and — in that same atomic step — compares the new count to `hourlyLimit`; if it's over, it decrements back and returns "rejected." Doing the check-and-increment as one Redis round trip is what makes it safe under concurrency: several worker slots (or several service instances) racing to send for the same sender at once can't all read "under limit" and all send anyway.
- **What happens at the limit.** The job is **never dropped or marked failed**. The worker sets the row's status to `rate_limited_delayed`, bumps `scheduledAt` to the start of the next UTC hour (plus a small random jitter, so a burst doesn't all refire at exactly `:00:00`), and calls BullMQ's `job.moveToDelayed(nextHourTimestamp, token)` (throwing `DelayedError` as BullMQ requires) — this reschedules the **same job**, preserving its place in the queue, rather than creating a new one. So yes: rate-limited emails are rescheduled into the next available hour window, not dropped.
- **Slack notification.** The first time a given sender hits its cap in a given hour, `markHourlyLimitNotified(senderId)` (a Redis `SET ... NX PX 3600000`) wins the race and the worker calls `notifySlackRateLimitHit()` (`backend/src/services/slack.ts`) with a message naming the sender and the next retry window. Every other job that gets rate-limited in that same sender+hour finds the flag already set and skips notifying again — so a 1000-email burst hitting the cap produces **one** Slack message, not a flood. If the user never connected Slack, the function looks up their `SlackIntegration`, finds nothing, and returns — no crash, no notification, and no code path change needed once they connect later.

### D. Concurrency

- **Worker concurrency** is configured via `WORKER_CONCURRENCY` (`backend/src/config/env.ts`) and passed straight into `new Worker(EMAIL_QUEUE_NAME, processor, { concurrency, ... })` in `backend/src/workers/emailWorker.ts`. This is how many jobs the worker will process in parallel at once.
- **Minimum delay between sends** is a *separate* control from concurrency: the same `Worker` is also given `limiter: { max: 1, duration: MIN_DELAY_BETWEEN_EMAILS_MS }`, BullMQ's built-in rate limiter, which caps how often a *new* job is allowed to **start**, globally, regardless of how many concurrent slots are free. So `WORKER_CONCURRENCY` controls parallelism, and `MIN_DELAY_BETWEEN_EMAILS_MS` controls throttling — together they mimic provider-side throttling on top of whatever concurrency you configure.
- **Preventing sends beyond the per-sender hourly limit under concurrency** is what §C's atomic Redis Lua script is for: with concurrency > 1, multiple jobs for the same sender can enter the processor function at effectively the same instant, so the limit check has to be atomic at the Redis level, not a plain "read count in Node, compare, then increment" — that would race and let the count overshoot. The Lua script closes that race by making the increment-and-compare a single indivisible Redis operation.

---

## 4. Features Implemented

### Backend

- Express REST API (`backend/src/app.ts`, `backend/src/routes/*.ts`)
- Google OAuth login via Passport, JWT-in-httpOnly-cookie session (`backend/src/passport/google.ts`, `backend/src/middleware/requireAuth.ts`)
- Email scheduling API, one row + one BullMQ job per recipient (`backend/src/routes/emails.ts`)
- BullMQ delayed jobs as the sole scheduling mechanism — no cron (`backend/src/queues/emailQueue.ts`)
- Redis as the BullMQ backing store and the rate-limit counter store (`backend/src/lib/redis.ts`)
- PostgreSQL persistence via Prisma (`backend/prisma/schema.prisma`)
- Restart/recovery reconciliation that re-enqueues missing jobs without duplicating them (`backend/src/services/reconcile.ts`)
- Hourly per-sender rate limiting, Redis-atomic, safe across concurrent workers (`backend/src/services/rateLimiter.ts`)
- Rate-limited emails rescheduled into the next hour window instead of dropped (`backend/src/workers/emailWorker.ts`)
- Configurable worker concurrency + minimum inter-send delay (`backend/src/workers/emailWorker.ts`)
- Email sending via Nodemailer over per-sender auto-provisioned Ethereal accounts (`backend/src/services/mailer.ts`)
- Slack OAuth v2 connect/disconnect flow (`backend/src/routes/slack.ts`, `backend/src/services/slack.ts`)
- Real Slack rate-limit notifications (incoming webhook, or `chat.postMessage` fallback), deduped per sender per hour
- Bull Board live queue dashboard mounted at `/admin/queues` (`backend/src/app.ts`)
- Elasticsearch indexing on schedule + on status change, with graceful degradation if ES is unreachable (`backend/src/services/elasticsearch.ts`) — the API endpoint (`GET /api/emails/search`) exists and works, though the current frontend UI doesn't call it (see the Search note under Frontend below)
- CSV/plain-text lead-list parsing (`POST /api/emails/upload-leads`, `backend/src/utils/csv.ts`)
- Multi-sender support, each with independently auto-provisioned Ethereal credentials (`backend/src/routes/senders.ts`)
- Combined API+worker production launcher for single-process deployment (`backend/src/startAll.ts`) — see §8

### Frontend

- Google login (real OAuth redirect, no mock) — `frontend/src/pages/LoginPage.tsx`, `frontend/src/context/AuthContext.tsx`
- Dashboard shell with user info, logout, and tab navigation — `frontend/src/pages/DashboardPage.tsx`, `frontend/src/components/Sidebar.tsx`
- Compose email flow (subject, HTML body, sender selection) — `frontend/src/components/ComposeModal.tsx`
- Recipient management: manual entry (comma/space/Enter to add), removable pills, overflow "+N" — `frontend/src/components/RecipientsInput.tsx`
- CSV/TXT recipient upload with detected-count feedback (calls `POST /api/emails/upload-leads`) — same component
- Lightweight rich text email editor (`contentEditable` + `document.execCommand` toolbar: bold/italic/underline/lists/quote/strikethrough/undo/redo) — `frontend/src/components/RichTextEditor.tsx`
- "Send Later" scheduling popover with quick presets (Tomorrow, Tomorrow 10/11am, Tomorrow 3pm) and a full date-time picker — `frontend/src/components/SendLaterPopover.tsx`
- Scheduled emails table with loading skeleton and empty state — `frontend/src/components/EmailTable.tsx`
- Sent emails table (status `sent`/`failed`) with loading skeleton and empty state — same component
- Client-side search box that filters the currently-loaded Scheduled/Sent rows by recipient or subject — `frontend/src/components/TopBar.tsx` + `DashboardPage.tsx`. **Note:** this filters what's already on screen; it does not currently call the backend's Elasticsearch-backed `GET /api/emails/search` endpoint, which exists and works but isn't wired into the UI yet.
- Sender selection ("From" dropdown, populated from `GET /api/senders`) — `ComposeModal.tsx`
- Configurable delay between emails (seconds, converted to ms on submit) — `ComposeModal.tsx`
- Configurable hourly limit per batch — `ComposeModal.tsx`
- Slack Connect / Disconnect UI in the sidebar, with loading and error states — `frontend/src/components/SlackConnectPanel.tsx`
- Slack connection status ("Slack Connected" + workspace name, via `GET /api/slack/status`) — same component
- Rate-limit status display: reflected per-row as an amber "Rate limited" status badge on affected Scheduled rows (`frontend/src/components/ui/Badge.tsx`) — there is no separate aggregate rate-limit widget beyond that
- Post-OAuth-redirect banner (success/error) after returning from Slack's consent screen — `DashboardPage.tsx`
- Image attachment (inlined into the HTML body as a data-URL `<img>`, not a true SMTP MIME attachment) — `ComposeModal.tsx`
- Basic toasts/inline error banners for failed API calls throughout (compose validation, Slack connect failures, upload failures)

---

## 5. Technology Stack

| Layer | Technology |
|---|---|
| Frontend framework | React 18 + TypeScript |
| Frontend build tool | Vite |
| Frontend styling | Tailwind CSS |
| Frontend data/state | TanStack Query (React Query), React Router |
| Backend framework | Express + TypeScript, on Node.js |
| Backend ORM | Prisma |
| Database | PostgreSQL |
| Job queue | BullMQ |
| Queue/rate-limit store | Redis (via `ioredis`) |
| Queue dashboard | Bull Board |
| Email sending | Nodemailer |
| Email testing sandbox | Ethereal Email |
| Search index | Elasticsearch (`@elastic/elasticsearch`) |
| Auth | Google OAuth 2.0 (Passport), JWT session cookie |
| Team notifications | Slack OAuth v2 + Web API (incoming webhook / `chat.postMessage`) |
| Local infra | Docker / Docker Compose (Postgres, Redis, Elasticsearch) |

Technologies deliberately **not** used: no cron / `node-cron` / `setInterval`-based scheduling anywhere (BullMQ delayed jobs are the only scheduling mechanism, per the assignment's hard constraint).

---

## 6. Environment Variables

Only variables actually read by the source code are listed — nothing here is aspirational or unused. See `backend/src/config/env.ts` (backend) and `frontend/src/vite-env.d.ts` / `frontend/src/api/client.ts` (frontend) for the exact read sites. No real secrets are included below — every value shown is a placeholder.

### Backend (`backend/.env`)

| Variable | Used for | Example / placeholder |
|---|---|---|
| `PORT` | Port Express listens on. Render sets this automatically — don't hardcode it. | `4000` |
| `NODE_ENV` | Standard Node environment flag. | `development` |
| `FRONTEND_URL` | CORS origin allow-list; OAuth redirect targets after login. | `http://localhost:5173` |
| `BACKEND_URL` | Builds the Google/Slack OAuth callback URLs. | `http://localhost:4000` |
| `JWT_SECRET` | Signs the auth session cookie and the short-lived Slack OAuth `state` token. | `replace-with-a-long-random-string` |
| `COOKIE_SECURE` | Sets the `Secure` flag on the auth cookie. | `false` (local), `true` (behind HTTPS) |
| `DATABASE_URL` | Prisma/PostgreSQL connection string. | `postgresql://outbox:outbox@localhost:5432/outbox?schema=public` |
| `REDIS_HOST` | Redis host for BullMQ + rate limiting. | `localhost` |
| `REDIS_PORT` | Redis port. | `6379` |
| `REDIS_PASSWORD` | Redis auth password, if required. | *(empty locally)* |
| `REDIS_TLS` | Enables TLS on the Redis connection (needed for managed free Redis like Upstash). | `false` |
| `ELASTICSEARCH_NODE` | Elasticsearch endpoint for indexing/search. Optional — the app degrades gracefully if unreachable. | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | Index name used for emails. | `emails` |
| `WORKER_CONCURRENCY` | BullMQ worker concurrent job slots. | `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Global floor between the start of any two sends. | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly send cap per sender (a batch can override it). | `200` |
| `GOOGLE_CLIENT_ID` | Google OAuth client id. | `your-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. | `your-google-client-secret` |
| `SLACK_CLIENT_ID` | Slack app client id. | `your-slack-client-id` |
| `SLACK_CLIENT_SECRET` | Slack app client secret. | `your-slack-client-secret` |

### Frontend (`frontend/.env`)

| Variable | Used for | Example / placeholder |
|---|---|---|
| `VITE_API_URL` | Base URL the dashboard calls for every backend API request. | `http://localhost:4000` |

**Not present, and intentionally not documented as if they were:** `ETHEREAL_HOST` / `ETHEREAL_PORT` / `ETHEREAL_USER` / `ETHEREAL_PASS`. This codebase doesn't read them — see §2 for why (Ethereal accounts are auto-provisioned per sender at runtime, not configured statically).

---

## 7. Architecture Diagram

```
                         React Frontend
                               |
                               v
                         Express API  <---------------------+
                               |                             |
                               v                             |
                         PostgreSQL  <-----------+           |
                        (source of truth)        |           |
                               |                  |           |
                               v                  |           |
                        BullMQ + Redis            | reconcile |
                     (delayed job queue)  ---------+ (startup: re-enqueues
                               |                     missing jobs from
                               v                     Postgres into BullMQ)
                            Worker
                               |
                great limit ---+--- under limit
                     |                |
                     v                v
              Rate limiter      Nodemailer / Ethereal
             (Redis, atomic         (real SMTP send,
           INCR+compare per          preview URL)
           sender+hour window)
                     |
                great limit hit
                     |
                     v
                   Slack
          (rate-limit notification,
         deduped once per sender/hour)
```

Every arrow is a real dependency in the code, not illustrative: Express talks to Postgres via Prisma; the schedule API writes to Postgres *and* adds BullMQ jobs to Redis in the same request; the worker reads Postgres, checks Redis for the rate limit, sends via Nodemailer/Ethereal, then writes the result back to Postgres (and Elasticsearch); reconciliation runs at boot and reads Postgres to repair BullMQ/Redis state; Slack is only called from the rate-limiter path in the worker.

---

## 8. Development vs Production

**Local development** is two (or three, with the frontend) independent processes, each restarting independently on file changes:

```bash
npm run dev          # backend/  — Express API
npm run worker:dev   # backend/  — BullMQ worker
npm run dev           # frontend/ — Vite dashboard
```

This mirrors how the system is actually meant to run: the API and the worker are separate concerns that can be scaled, restarted, and deployed independently of each other.

**The current production/deployment setup does not preserve that separation** — it's a free-tier compromise, not the target architecture. `npm run start:all` (`backend/src/startAll.ts`) exists specifically because a free single Render Web Service only gives you one process to run, with no separate Background Worker product available. `start:all` spawns the compiled API and the compiled worker as two real, independent `node` child processes under one parent, forwards shutdown signals to both, and takes both down together if either crashes — which is as safe as this constraint can be made, but it still means the worker's failure/restart is now coupled to the API's, and they compete for the same container's resources. **This is explicitly not how the project would be deployed given a real background-worker product to deploy onto** — the correct target architecture keeps the API and the worker as separate deployable services sharing the same Postgres and Redis, exactly as local development already does. Full deployment steps and caveats are in §10.

---

## 9. Verification / Testing

There's no automated test suite in this repository; verify the running system directly:

| Check | How |
|---|---|
| Backend health endpoint | `curl http://localhost:4000/api/health` → `{"ok":true}` |
| Frontend loads | Open http://localhost:5173 — the login page should render |
| Google login works | Click "Login with Google" on the login page (needs real credentials in `backend/.env`, §1.1) — you should land on `/dashboard` with your name/avatar in the sidebar |
| Email scheduling works | Compose → add a recipient → Send/Send Later → `POST /api/emails/schedule` should return `{ batchId, scheduled: N }`, and the row(s) should appear under **Scheduled** |
| Worker processes jobs | Watch the worker's terminal/log for `[worker] job email-... completed`, or watch the job move through Bull Board at `/admin/queues` |
| Ethereal preview is generated | Once a row's status flips to **Sent**, `GET /api/emails/sent` includes a `previewUrl` — open it in a browser to see the actual rendered email |
| Rate limit works | Schedule more recipients for one sender than its hourly limit in the same hour — the excess rows should immediately show status `rate_limited_delayed` instead of `sent` |
| Rate-limited emails are rescheduled | Check that sender+recipient row's `scheduledAt` — it should have moved to the start of the next UTC hour, not disappeared |
| Slack notification appears | Connect Slack (sidebar → Connect Slack, needs real credentials in `backend/.env`, §1.1), then repeat the rate-limit test above — a message should land in the configured Slack channel/webhook the moment the cap is hit |

---

## 10. Render Deployment (Free Tier)

Render's free tier gives you exactly one thing: a single **Web Service** process bound to a dynamic `$PORT`. There's no free **Background Worker** product, so the BullMQ worker runs *inside* that one web service via `npm run start:all` instead of as its own Render resource (§8).

### 10.1 What you need

| Piece | Free option | Notes |
|---|---|---|
| PostgreSQL | Render's own **PostgreSQL** resource (free instance) | First-party, easiest path |
| Redis | **Not available free on Render.** Use [Upstash](https://upstash.com) (free tier) or Redis Cloud's free 30MB tier | Render only sells Redis/Key-Value on paid plans |
| Elasticsearch | **No managed offering on Render at all**, free or paid | The app already treats ES as optional (§4, §6) — point it at a free external host (e.g. [Bonsai.io](https://bonsai.io)'s sandbox tier) or leave it unreachable and accept degraded search |

### 10.2 PostgreSQL

Render dashboard → **New → PostgreSQL** → free instance → copy its connection string into `DATABASE_URL`.

### 10.3 Redis

Create a free database on Upstash (or Redis Cloud) → map its host/port/password to `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`, and set `REDIS_TLS=true` (Upstash requires TLS; `backend/src/lib/redis.ts` only enables it when this flag is set, so local/Docker Redis is unaffected).

### 10.4 Elasticsearch

Optional. Set `ELASTICSEARCH_NODE` to a free external host if you want live search; otherwise leave it as-is — `ensureEmailIndex()` already catches the connection failure at boot and the app runs normally with search degraded.

### 10.5 Backend Web Service configuration

Render dashboard → **New → Web Service** → connect this repo →

- **Root Directory:** `backend`
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start:all`
- **Health Check Path:** `/api/health`

Render injects `PORT` automatically; nothing to change for that (§6).

### 10.6 Environment variables to set on Render

Every variable from the §6 backend table, plus:

```
BACKEND_URL       https://<your-service>.onrender.com
FRONTEND_URL      wherever you host the dashboard
NODE_ENV          production
COOKIE_SECURE     true
REDIS_TLS         true   (if using Upstash/managed Redis)
```

### 10.7 Update OAuth redirect URIs for production

- **Google** — Cloud Console → your OAuth Client → Authorized redirect URIs → add `https://<your-service>.onrender.com/api/auth/google/callback`.
- **Slack** — Slack API dashboard → your app → OAuth & Permissions → Redirect URLs → add `https://<your-service>.onrender.com/api/slack/callback`.

Both are derived from `BACKEND_URL` at runtime — no code change needed either way.

### 10.8 Limitations of this deployment

- **No independent scaling or restart** for the worker — it lives and dies with the API process, by design (`startAll.ts`), and competes with it for the same container's resources.
- **Render free services spin down on idle**, which stops the worker too — a BullMQ job delayed for an hour from now won't fire until something wakes the service back up.
- **No free managed Redis or Elasticsearch on Render itself** — both routed to external free services, adding moving parts (and, for Redis, a hard dependency the app can't run without).
- **Graceful shutdown is best-effort** — the launcher forwards `SIGTERM` and waits up to 8s, but Render's own shutdown grace period ultimately decides whether an in-flight send finishes.

**Honestly: this is not how it'd be run in real production.** A proper deployment keeps the API and the worker as separate services (a paid Background Worker, separate ECS tasks/Kubernetes deployments — anything that scales, restarts, and fails independently) sharing the same Postgres and Redis. Co-locating them here is a free-tier constraint, made as safe as it can be — real BullMQ, real Redis, real child processes, signal forwarding, crash-takes-both-down — but it's a deployment compromise, not the target architecture.

---

## Design notes / trade-offs

- Email/password login is shown in the UI (per the Figma) but intentionally disabled — only Google OAuth is wired up, since a second real auth system wasn't in scope.
- The compose editor is a lightweight `contentEditable` + `document.execCommand` toolbar rather than a full rich-text library, to avoid an extra heavy dependency for formatting that isn't validated by the API.
- Attachments are inlined as `<img>` tags in the HTML body (via `FileReader` → data URL) rather than true SMTP MIME attachments — sufficient for the Ethereal demo flow without adding multipart handling.
