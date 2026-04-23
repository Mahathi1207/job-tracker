# Job Tracker — Complete Technical Study Guide

This document explains every part of the Job Tracker application from first principles.
It is written so you can paste it into an AI assistant and ask any question about how
the app works, why each decision was made, and what happens when you click any button.

---

## Table of Contents

1. [What Is This App?](#1-what-is-this-app)
2. [Why Localhost?](#2-why-localhost)
3. [How to Start the App](#3-how-to-start-the-app)
4. [The Big Picture — Architecture](#4-the-big-picture--architecture)
5. [How the Browser Talks to the App](#5-how-the-browser-talks-to-the-app)
6. [Every Service Explained](#6-every-service-explained)
7. [The Database — PostgreSQL](#7-the-database--postgresql)
8. [Redis — The Fast Memory Store](#8-redis--the-fast-memory-store)
9. [Kafka — The Message Bus](#9-kafka--the-message-bus)
10. [The Frontend — React App](#10-the-frontend--react-app)
11. [Complete User Journey — Every Click Explained](#11-complete-user-journey--every-click-explained)
12. [AI Features Explained](#12-ai-features-explained)
13. [Email Notifications Explained](#13-email-notifications-explained)
14. [Security — How Login Really Works](#14-security--how-login-really-works)
15. [Sharing the App — Cloudflare Tunnel](#15-sharing-the-app--cloudflare-tunnel)
16. [Tech Stack Summary](#16-tech-stack-summary)

---

## 1. What Is This App?

Job Tracker is a web application that helps job seekers organize their job applications.
Think of it like a Kanban board (similar to Trello) but specifically for job hunting.

**Core features:**
- Track job applications across 4 stages: Applied → Interviewing → Offer → Rejected
- Drag-and-drop cards between columns
- AI-generated interview prep and cover letters per job
- Follow-up reminders when applications go stale
- Daily email with new job openings matching your profile
- Resume board — separate Kanban per resume/job-type
- Admin panel for the owner to see all users and their activity
- CSV export of all applications
- ATS (Applicant Tracking System) keyword match score
- Analytics charts showing your application pipeline

**What makes it technically interesting:**
It is built as a **microservices architecture** — instead of one big program, there are
6 separate programs (services) each doing one job, all running together inside Docker
containers and communicating with each other.

---

## 2. Why Localhost?

When you open `http://localhost:3000` in your browser, here is what "localhost" means:

- `localhost` is a special hostname that always means "this same computer"
- It is equivalent to IP address `127.0.0.1`
- Port `3000` is a number that identifies which program on the computer to talk to
  (like an apartment number in a building)
- So `localhost:3000` means: "on this computer, talk to the program listening on port 3000"

The frontend (React app) runs on port 3000.
The API gateway runs on port 8000.
The auth service runs on port 8001.
The job service runs on port 8002.
The AI service runs on port 8003.
The notification service runs on port 8004.
PostgreSQL (database) runs on port 5432.
Redis (cache) runs on port 6379.
Kafka (message bus) runs on port 9092.

All of these run on your laptop inside **Docker containers**.

**Why Docker?**
Docker is like a shipping container for software. Just like a shipping container can hold
any cargo and fits on any ship, a Docker container holds a program and all its dependencies
and runs the same way on any computer. This is why the app works identically on your laptop
or on a server.

**Docker Compose** is the tool that starts all containers at once and makes them able to
talk to each other. The file `docker-compose.yml` describes all services, their ports,
and their environment variables.

When you run `docker compose up -d`:
- Docker reads `docker-compose.yml`
- Starts each service in its own container
- Creates a private network so containers can find each other by name
  (e.g., the job-service can reach the auth-service at `http://auth-service:8001`)
- The `-d` flag means "detached" — run in the background so you get your terminal back

**Why do friends need a different URL?**
`localhost` only works on your own machine. Your friends' browsers cannot reach your laptop's
`localhost`. To share the app, you use a tunneling service (Cloudflare) that creates a public
URL and forwards traffic through the internet to your laptop.

---

## 3. How to Start the App

**Every time you want to run the app:**

```
Step 1: Open Docker Desktop (the whale icon in your taskbar)
Step 2: Double-click "Start Job Tracker.bat" in the job-tracker folder
        OR run: docker compose up -d
Step 3: Run: .\cloudflared-windows-amd64.exe tunnel --url http://localhost:3000
Step 4: Share the trycloudflare.com URL with friends
```

**To stop the app:**
```
docker compose down        ← stops all containers, keeps database data
docker compose down -v     ← stops everything AND deletes all data (use only if broken)
```

**If Kafka crashes on startup** (stale Zookeeper error):
```
docker compose down -v
docker compose up -d
```
Note: `-v` deletes the database. All users need to re-register.

---

## 4. The Big Picture — Architecture

```
INTERNET
    │
    │ (Cloudflare tunnel forwards public URL to your laptop)
    ▼
YOUR LAPTOP (localhost)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  DOCKER NETWORK (private, containers talk by name)      │
│                                                         │
│  ┌─────────────┐    nginx serves React files            │
│  │  Frontend   │    Port 3000 → public                  │
│  │  (React)    │                                        │
│  └──────┬──────┘                                        │
│         │ /api/* requests                               │
│         ▼                                               │
│  ┌─────────────┐    Single entry point for all APIs     │
│  │ API Gateway │    Port 8000                           │
│  │             │    Rate limiting: 100 req/min per IP   │
│  └──────┬──────┘    Auth check on protected routes      │
│         │                                               │
│    routes by URL prefix                                 │
│    /auth/* → auth-service                               │
│    /jobs/* → job-service                                │
│    /ai/*   → ai-service                                 │
│    /notifications/* → notification-service              │
│         │                                               │
│  ┌──────┴────────────────────────────────┐             │
│  │                                       │             │
│  ▼                       ▼              ▼             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │  Auth    │  │  Job     │  │  AI      │  │ Notify   ││
│  │ Service  │  │ Service  │  │ Service  │  │ Service  ││
│  │ :8001    │  │ :8002    │  │ :8003    │  │ :8004    ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘│
│       │              │             │              │      │
│       └──────────────┴─────────────┴──────────────┘     │
│                              │                           │
│                    ┌─────────┴──────────┐               │
│                    │   PostgreSQL :5432  │               │
│                    │  (single database,  │               │
│                    │   multiple tables)  │               │
│                    └────────────────────┘               │
│                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Redis :6379 │  │ Kafka :9092 │  │ Zookeeper   │     │
│  │ Cache +     │  │ Job events  │  │ :2181       │     │
│  │ Blacklist   │  │ topic       │  │ (Kafka mgr) │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**Why microservices instead of one big program?**
Each service can be:
- Deployed independently (update AI service without restarting auth)
- Scaled independently (run 3 copies of job-service if needed)
- Written in different languages (all Python here, but could mix)
- Owned by different teams

The downside: more complexity (which you are learning here!).

---

## 5. How the Browser Talks to the App

**Every HTTP request goes through this path:**

```
Browser
  │
  │ GET/POST/PATCH/DELETE http://localhost:3000/api/jobs
  ▼
nginx (inside frontend container, port 3000)
  │
  │ nginx sees /api/ prefix → strips /api/ → forwards to api-gateway:8000
  ▼
API Gateway (port 8000)
  │
  │ 1. Checks rate limit in Redis (max 100 requests per minute per IP)
  │ 2. If route needs auth (/jobs/*, /ai/*, /resumes/*):
  │    checks Authorization header has "Bearer <token>"
  │ 3. Forwards request to correct downstream service
  ▼
Auth/Job/AI/Notification Service
  │
  │ Processes request, queries database, returns response
  ▼
API Gateway → nginx → Browser
```

**Why does the frontend use `/api/` prefix?**
The frontend (React app) is served by nginx on port 3000. The API gateway is on port 8000.
Instead of the browser making requests to two different ports (which causes CORS issues),
nginx acts as a proxy: any request to `/api/*` on port 3000 is forwarded to port 8000.
The browser only ever talks to port 3000.

**What is CORS?**
CORS (Cross-Origin Resource Sharing) is a browser security rule: a webpage from domain A
cannot make requests to domain B unless domain B explicitly allows it. By having nginx
proxy all requests through the same origin (localhost:3000), we avoid this problem entirely.

---

## 6. Every Service Explained

### 6.1 API Gateway (`services/api-gateway/main.py`)

**What it does:** Single entry point. Every API request goes through here first.

**Rate limiting:** Uses Redis to count requests per IP address in a 60-second sliding window.
If any IP makes more than 100 requests in 60 seconds, it gets a 429 error. This prevents abuse.

**Auth checking:** For protected routes, it checks that the Authorization header contains
"Bearer <something>". It does NOT verify the token itself — that is done by each downstream
service calling auth-service's `/auth/verify` endpoint.

**Routing rules:**
- `/auth/*` → forwards to `http://auth-service:8001/auth/*`
- `/jobs/*` → forwards to `http://job-service:8002/jobs/*` (requires auth header)
- `/ai/*` → forwards to `http://ai-service:8003/ai/*` (requires auth header)
- `/resumes/*` → forwards to `http://job-service:8002/resumes/*` (requires auth header)
- `/notifications/*` → forwards to `http://notification-service:8004/notifications/*`

**Technology:** Python + FastAPI + httpx (for forwarding requests)

---

### 6.2 Auth Service (`services/auth-service/main.py`)

**What it does:** Handles user identity — registration, login, and token verification.

**How registration works:**
1. User submits email + password
2. Password is hashed using bcrypt (one-way transformation — the real password is never stored)
3. User record is saved to `users` table in PostgreSQL
4. Returns the new user's data (not the password hash)

**How login works:**
1. User submits email + password
2. Service looks up user by email in database
3. Uses bcrypt to verify the submitted password matches the stored hash
4. If valid, creates a JWT (JSON Web Token) and returns it
5. If email not found → returns error code `EMAIL_NOT_FOUND`
6. If wrong password → returns error code `WRONG_PASSWORD`

**What is a JWT?**
A JWT (JSON Web Token) is a signed string that contains claims (like user ID and email).
It looks like: `xxxxx.yyyyy.zzzzz` (three base64 sections separated by dots).
- Header: algorithm used to sign
- Payload: user_id, email, expiry time (24 hours)
- Signature: cryptographic proof that the payload was signed by our server's secret key

The browser stores this token in `localStorage` and sends it in every subsequent request:
`Authorization: Bearer <token>`

Any service can verify the token by calling `/auth/verify` — if the signature is valid
and not expired, the user is authenticated.

**Token blacklisting (logout):**
JWTs cannot be "deleted" since they are stateless. To make logout work, when a user logs
out, the token is stored in Redis with a TTL equal to the token's remaining lifetime.
Any future request with that token checks Redis first — if it is blacklisted, access denied.

**Session revocation:**
The admin can force-logout any user by storing a `revoke_before:{user_id}` timestamp in
Redis. Any token issued before that timestamp is rejected, even if it has not expired yet.

**bcrypt and passlib:**
- bcrypt is the hashing algorithm — designed to be slow (prevents brute force attacks)
- passlib is the Python library that wraps bcrypt
- Important: we use `bcrypt==3.2.2` not 4.x because bcrypt 4 changed its API
  and is incompatible with passlib 1.7.4

**Demo account:**
A special demo account (`demo@jobtracker.com`) is seeded on startup.
Its password comes from the `DEMO_PASSWORD` environment variable (set in `.env`).
If `DEMO_PASSWORD` is empty, no demo account is created.

**Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Create account |
| POST | `/auth/login` | No | Login, get JWT |
| GET | `/auth/me` | JWT | Get my profile |
| POST | `/auth/logout` | JWT | Blacklist token |
| POST | `/auth/verify` | No | Validate a token (used by other services) |
| GET | `/auth/admin/users` | JWT (admin only) | List all users |
| POST | `/auth/admin/revoke/{user_id}` | JWT (admin only) | Force logout a user |

---

### 6.3 Job Service (`services/job-service/main.py`)

**What it does:** All CRUD (Create, Read, Update, Delete) operations on job applications
and resume boards. Also publishes events to Kafka when job status changes.

**How it authenticates:**
Every request includes a JWT from the browser. The job-service calls auth-service's
`/auth/verify` endpoint with that token. Auth-service returns `{valid: true, user_id: "...", email: "..."}`.
This is called **service-to-service communication** — one microservice calling another.

**Job data model (what is stored for each job):**
```
id           — unique identifier (UUID)
user_id      — which user owns this job
company      — company name
role         — job title
status       — applied | interviewing | offer | rejected
job_description — pasted JD text (used by AI features)
notes        — free text notes
applied_date — when the user actually applied (user-entered)
deadline     — application deadline
salary_min   — minimum salary
salary_max   — maximum salary
location     — job location
interview_at — scheduled interview datetime
resume_id    — which resume board this belongs to
created_at   — when the record was created
updated_at   — when the record was last modified (used for follow-up logic)
```

**Kanban status change → Kafka event:**
When status changes (e.g., applied → interviewing), job-service publishes a message to
the Kafka topic `job-events`. This message contains:
```json
{
  "event": "status_changed",
  "job_id": "...",
  "user_id": "...",
  "user_email": "...",
  "company": "Google",
  "role": "Software Engineer",
  "old_status": "applied",
  "new_status": "interviewing"
}
```
The notification-service receives this and sends an email. Job-service doesn't know or care
about notifications — it just publishes the event and moves on (loose coupling).

**Resume boards:**
Resume boards are stored in a separate `resumes` table. Each job can optionally belong to
a resume board via `resume_id`. This lets users manage separate Kanban boards for different
resumes or job types (e.g., "SDE Resume" vs "PM Resume").

**Follow-up logic:**
The dashboard checks if any job needs a follow-up. The rule:
- Status = "applied" AND `applied_date` is 14+ days ago AND `updated_at` is 14+ days ago
- Status = "interviewing" AND `applied_date` is 7+ days ago AND `updated_at` is 7+ days ago

The "Mark as followed up" button calls `POST /jobs/{id}/mark-followed-up` which updates
`updated_at` to now, resetting the 14/7 day clock.

**Admin stats endpoint:**
`GET /jobs/admin/stats` returns per-user job counts grouped by status. Only accessible
if the calling user's email is `demo@jobtracker.com`.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/jobs` | Create a new job |
| GET | `/jobs` | List all my jobs |
| GET | `/jobs/{id}` | Get one job |
| PATCH | `/jobs/{id}` | Update job fields |
| PATCH | `/jobs/{id}/status` | Change status (triggers Kafka event) |
| POST | `/jobs/{id}/mark-followed-up` | Reset the follow-up timer |
| DELETE | `/jobs/{id}` | Delete a job |
| GET | `/jobs/admin/stats` | Admin: per-user stats |
| POST | `/resumes` | Create a resume board |
| GET | `/resumes` | List my resume boards |
| DELETE | `/resumes/{id}` | Delete a resume board |

---

### 6.4 AI Service (`services/ai-service/main.py`)

**What it does:** Calls the Groq AI API (using llama-3.3-70b model) to generate
interview prep, cover letters, ATS scores, and job suggestions.

**Why Groq instead of Claude/OpenAI?**
Groq offers a free API tier with fast inference. The llama-3.3-70b model is a large,
capable open-source model that produces high quality structured JSON output.

**Redis caching:**
Every AI response is cached in Redis for 1 hour keyed by a SHA-256 hash of the input.
If two users ask for tips on the same job description, the second user gets the cached
response instantly without calling Groq again. This saves API costs and reduces latency.

**Interview prep (`POST /ai/interview-prep`):**
Input: job description + user context (role and company)
Output: 5 likely interview questions + 5 preparation tips
Returns JSON: `{"questions": [...], "tips": [...]}`
Shown when status is "applied" or "interviewing" only.

**Cover letter (`POST /ai/cover-letter`):**
Input: job description + user context
Output: full 3-paragraph cover letter + 3 key selling points
Returns JSON: `{"cover_letter": "...", "key_points": [...]}`
Shown for "applied", "interviewing", and "offer" statuses.
(Not shown for "rejected" — no need for a cover letter then.)

**ATS Score (`POST /ai/ats-score`):**
Input: resume text (pasted by user) + job description
Output: 0-100 match score, matched keywords, missing keywords
The resume text is saved to browser localStorage so you don't retype it each time.

**Job suggestions (`GET /ai/job-suggestions?keywords=...`):**
Calls the Adzuna jobs API with the resume board's keywords.
Filters results: only returns jobs where the title contains at least one keyword.
Cached in Redis until end of day.
If no Adzuna keys configured, falls back to Remotive API (remote jobs only).

**JSON parsing robustness:**
AI models sometimes return newline characters inside JSON strings (e.g., in cover letters).
A custom `parse_json_response` function walks character-by-character and escapes control
characters inside string values before parsing. This prevents 500 errors from the AI.

**Resume analysis (`POST /ai/analyze-resume`):**
Accepts PDF file upload, extracts text using pypdf, sends to Groq for analysis.
Returns: match percentage, missing keywords, present keywords, selection probability.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/interview-prep` | Generate interview questions and tips |
| POST | `/ai/cover-letter` | Generate cover letter |
| POST | `/ai/ats-score` | Score resume against job description |
| POST | `/ai/analyze-resume` | Analyze uploaded PDF resume |
| GET | `/ai/job-suggestions` | Get matching job openings from Adzuna |

---

### 6.5 Notification Service (`services/notification-service/main.py`)

**What it does:** Three separate responsibilities:
1. Listens to Kafka for job status change events → sends status-change emails
2. Runs a daily job at 9:00 AM (your timezone) → sends follow-up reminder emails
3. Runs a daily job at 9:05 AM → sends job suggestions emails

**Kafka consumer:**
The notification service runs a background async task that connects to Kafka and subscribes
to the `job-events` topic. It listens forever in a loop. When a message arrives:
- Checks if `new_status` is in the email templates (interviewing, offer, rejected)
- If yes, sends an HTML email to the user's email address
- Logs the notification to the `notification_logs` table

If Kafka is unavailable at startup, it retries up to 12 times with 5-second delays.

**Email sending (SMTP):**
Uses Python's built-in `smtplib` to connect to Gmail's SMTP server (`smtp.gmail.com:587`).
Uses STARTTLS encryption.
The sender email is `jobtracker.reminders1207@gmail.com`.
The app password (not the regular Gmail password) is stored in `.env` as `SMTP_PASSWORD`.

**Gmail App Passwords:**
Gmail requires "App Passwords" for SMTP access when 2-factor authentication is enabled.
An app password is a 16-character code (e.g., `tvqe xbro xhwp cstr`) that allows the
app to send email on behalf of the Gmail account without knowing the real password.

**APScheduler (daily jobs):**
APScheduler is a Python library that runs functions on a schedule.
Two jobs are configured:
- `send_followup_reminders`: runs at 09:00 in the configured timezone
- `send_job_suggestions`: runs at 09:05 in the configured timezone

The timezone is configured via `SCHEDULER_TIMEZONE` environment variable (default: `America/Chicago`).

**Follow-up reminders (daily):**
Queries the PostgreSQL database directly using raw SQL:
```sql
SELECT j.id, j.company, j.role, j.status, j.applied_date, u.email
FROM jobs j JOIN users u ON j.user_id = u.id
WHERE j.status IN ('applied', 'interviewing')
  AND j.applied_date <= CURRENT_DATE - INTERVAL '14 days'
  AND j.updated_at <= NOW() - INTERVAL '14 days'
```
Skips any job that already received a follow-up email today (checks `notification_logs`).

**Job suggestions (daily):**
For each user, gets their resume board keywords from the database.
Calls Adzuna API with those keywords.
Sends an HTML email with up to 5 matching job openings with links.

**Direct database access:**
The notification service connects to the same PostgreSQL database as other services.
It uses raw SQL to read from `jobs` and `users` tables (which belong to other services).
This is a pragmatic shortcut — in a larger production system, each service would have its
own database and communicate via APIs.

**Endpoints:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/notifications/health` | Health check |
| POST | `/notifications/test` | Send a test email |
| POST | `/notifications/trigger-followup` | Manually trigger follow-up check |
| POST | `/notifications/trigger-suggestions` | Manually trigger job suggestions |
| GET | `/notifications/logs` | Last 50 notification records |

---

## 7. The Database — PostgreSQL

**What is PostgreSQL?**
PostgreSQL (Postgres) is an open-source relational database. Data is stored in tables with
rows and columns, similar to a spreadsheet. Tables can be linked via foreign keys.

**Why one database for all services?**
In production microservices, each service typically owns its own database. Here, all
services share one Postgres instance for simplicity (portfolio project). The data is still
logically separated — each service only writes to its own tables.

**Database name:** `jobtracker`
**Host:** `postgres` (Docker container name, resolved within Docker network)
**Port:** `5432`
**User:** `admin` / **Password:** `secret`

**Tables:**

```sql
-- Created by auth-service
users (
    id UUID PRIMARY KEY,
    email VARCHAR UNIQUE,
    hashed_password VARCHAR,
    full_name VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP
)

-- Created by job-service
jobs (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    company VARCHAR,
    role VARCHAR,
    status VARCHAR,           -- applied|interviewing|offer|rejected
    job_description TEXT,
    notes TEXT,
    applied_date DATE,
    deadline DATE,
    salary_min INTEGER,
    salary_max INTEGER,
    location VARCHAR,
    interview_at TIMESTAMPTZ,
    resume_id UUID,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)

-- Created by job-service
resumes (
    id UUID PRIMARY KEY,
    user_id UUID,
    name VARCHAR,             -- board name (e.g., "SDE Resume")
    keywords VARCHAR,         -- search terms (e.g., "Python backend engineer")
    created_at TIMESTAMP
)

-- Created by notification-service
notification_logs (
    id UUID PRIMARY KEY,
    user_id VARCHAR,
    job_id VARCHAR,
    notification_type VARCHAR, -- interviewing|offer|rejected|follow_up
    recipient_email VARCHAR,
    sent_at TIMESTAMP,
    status VARCHAR            -- sent|failed
)
```

**How does the schema get created?**
Each service calls `Base.metadata.create_all(bind=engine)` on startup. SQLAlchemy reads
the Python model class definitions and creates the tables if they don't exist yet.

For new columns added after initial creation, `ALTER TABLE` migrations run in the service's
startup lifespan:
```python
conn.execute(text("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS location VARCHAR"))
```

**Data persistence:**
PostgreSQL data is stored in a Docker named volume `postgres_data`. This survives
`docker compose down` but is deleted by `docker compose down -v`.

**50 seed rows:**
The file `infra/postgres/init.sql` creates 50 demo job records on first database creation.
These are owned by the demo user (`a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`).

---

## 8. Redis — The Fast Memory Store

**What is Redis?**
Redis is an in-memory key-value store. Unlike a database that writes to disk, Redis
keeps everything in RAM — so reads and writes are extremely fast (microseconds).
Data has a TTL (Time To Live) — it expires automatically after a set time.

**Three separate uses in this app:**

**1. Rate limiting (API Gateway)**
Key pattern: `rl:{client_ip_address}`
Value: integer (request count)
TTL: 60 seconds
How: on each request, increment the counter. If count > 100, reject with 429.
First request in a window creates the key with a 60s TTL.

**2. JWT blacklist (Auth Service)**
Key pattern: `blacklist:{full_jwt_token_string}`
Value: "1" (just a marker)
TTL: remaining lifetime of the token (so Redis auto-cleans it)
How: when user logs out, token is stored here. Every verify check looks here first.

Session revocation key pattern: `revoke_before:{user_id}`
Value: Unix timestamp
TTL: 2 days
How: admin force-logout stores current timestamp. Any token with `iat` before this is rejected.

**3. AI response cache (AI Service)**
Key pattern: SHA-256 hash of `{route}:{job_description}:{user_context}`
Value: JSON string of the AI response
TTL: 3600 seconds (1 hour)

Job suggestion cache:
Key pattern: `suggestions:{country}:{hash of keywords+date}`
Value: JSON list of jobs
TTL: until end of day (cached per day so suggestions refresh daily)

---

## 9. Kafka — The Message Bus

**What is Kafka?**
Apache Kafka is a distributed message streaming platform. Think of it like a postal system:
- **Producer:** drops a letter in a mailbox (publishes a message to a topic)
- **Topic:** the mailbox / category of messages (e.g., `job-events`)
- **Consumer:** picks up letters from the mailbox (subscribes to a topic)
- Messages are persistent — they stay in the topic even after being consumed

**Why use Kafka instead of direct API calls?**
Alternative: when status changes, job-service could directly call notification-service.
Problem: this creates **tight coupling** — job-service would need to know about
notification-service, and if notification-service is down, job-service fails too.

With Kafka: job-service publishes an event and immediately continues. It doesn't know
or care who is listening. Notification-service consumes the event whenever it is ready.
Adding new consumers (e.g., a Slack integration) requires zero changes to job-service.

**Zookeeper:**
Zookeeper manages the Kafka broker cluster metadata (leader election, configuration).
It runs on port 2181. You never interact with it directly.

**The `job-events` topic:**
Published when: `PATCH /jobs/{id}/status` is called
Message format:
```json
{
  "event": "status_changed",
  "job_id": "uuid",
  "user_id": "uuid",
  "user_email": "user@example.com",
  "company": "Google",
  "role": "Software Engineer",
  "old_status": "applied",
  "new_status": "interviewing"
}
```

**Consumer group:**
The notification service uses group ID `notification-service-v1`.
Kafka tracks which messages have been consumed per group, so if the service restarts,
it continues from where it left off (no missed notifications).

**The stale Zookeeper problem:**
When Docker is killed ungracefully (e.g., force-stopping Docker Desktop), Zookeeper
retains a stale broker registration from the old session. When Kafka tries to start
again with a new session ID, Zookeeper refuses because the old ID is still registered.
Fix: `docker compose down -v` wipes all Kafka/Zookeeper state so they start fresh.

---

## 10. The Frontend — React App

**Technology stack:**
- **React 18** — UI library from Meta. Components are functions that return HTML-like JSX.
- **Vite** — Build tool. In development, serves files with hot-reload. In production, bundles everything into optimized static files.
- **Tailwind CSS** — Utility-first CSS. Instead of writing CSS files, you apply classes like `bg-blue-600 text-white rounded-lg`.
- **React Router v6** — Client-side routing. Navigating between pages doesn't reload the page; React swaps components.
- **dnd-kit** — Drag-and-drop library for the Kanban board.
- **Recharts** — Chart library for the Analytics page.
- **date-fns** — Date utility library for formatting and calculating differences.
- **axios** — HTTP client for making API requests.

**How it is served:**
In production (Docker), Vite builds static files (HTML + JS + CSS) into the `dist/` folder.
nginx serves these static files on port 3000. nginx also proxies `/api/*` to the gateway.
The React app is a **Single Page Application (SPA)** — one HTML page, React handles navigation.

**nginx cache headers:**
`index.html` is served with `Cache-Control: no-store` so browsers always fetch the latest version.
JS/CSS files have content hashes in their names (e.g., `index-B_WXI0B0.js`) so they
are cached aggressively (`max-age=31536000`) — the hash changes if content changes.

**Key files:**
```
frontend/src/
├── App.jsx              — routes definition, ProtectedRoute wrapping
├── contexts/
│   └── AuthContext.jsx  — global auth state (user, token, login, logout functions)
├── api/
│   └── axios.js         — axios instance with interceptors
├── components/
│   ├── Navbar.jsx       — top navigation bar (hamburger on mobile)
│   ├── KanbanBoard.jsx  — drag-and-drop board
│   ├── JobCard.jsx      — individual job card with follow-up button
│   ├── JobSuggestions.jsx — today's job openings table
│   ├── ResumeBoard.jsx  — per-resume Kanban view
│   └── ResumeAnalyzer.jsx — PDF upload and analysis
└── pages/
    ├── Login.jsx        — login form + fun "not registered" page
    ├── Register.jsx     — registration form
    ├── Dashboard.jsx    — main Kanban + filters + alerts
    ├── JobDetail.jsx    — single job page + AI assistant
    ├── Charts.jsx       — analytics charts
    └── Admin.jsx        — admin panel (demo account only)
```

**AuthContext:**
`AuthContext.jsx` provides global authentication state using React Context.
- Reads token from `localStorage` on app load
- Calls `/auth/me` to get user profile when token exists
- If `/auth/me` fails (expired/invalid token), calls `logout()` to clear state
- Provides `login()`, `logout()`, `register()` functions to all components

**Axios interceptors:**
`api/axios.js` configures two interceptors:
1. **Request interceptor:** automatically attaches `Authorization: Bearer <token>` to every request
2. **Response interceptor:** if any request gets a 401 AND we are NOT on the login page,
   removes the token from localStorage and redirects to `/login`
   (The login-page exception is crucial — otherwise failed login attempts redirect
   in a loop before the error state can be shown)

**ProtectedRoute:**
Wraps pages that require authentication. If not logged in (no token), redirects to `/login`.
While loading (checking if token is valid), shows a spinner.

---

## 11. Complete User Journey — Every Click Explained

### 11.1 Opening the App for the First Time

1. Browser opens `http://localhost:3000`
2. nginx serves `index.html`
3. Browser loads React JavaScript bundle
4. React Router checks the URL → `/` → redirects to `/dashboard`
5. ProtectedRoute checks AuthContext → no token → redirects to `/login`
6. Login page renders

---

### 11.2 Register

**User clicks "Register" and fills out the form:**

```
Frontend (Register.jsx)
    │ POST /api/auth/register { email, password, full_name }
    ▼
nginx → strips /api/ → forwards to API Gateway :8000
    │
    ▼
API Gateway
    │ No auth required for /auth/* routes
    │ Forwards to auth-service:8001
    ▼
Auth Service POST /auth/register
    │ Checks: is email already in users table?
    │ If yes → 400 "Email already registered"
    │ If no → hashes password with bcrypt → saves to users table → returns user data
    ▼
Frontend receives success → calls login() with same credentials → redirects to /dashboard
```

---

### 11.3 Login

**User enters email + password and clicks "Sign in":**

```
Frontend (Login.jsx)
    │ POST /api/auth/login (form-encoded: username=email&password=...)
    │ Note: OAuth2 standard requires "username" field even for email
    ▼
Auth Service POST /auth/login
    │ Looks up user by email
    │ If not found → 401 { detail: "EMAIL_NOT_FOUND" }
    │   → Frontend shows bouncing 👀 "You're not on the list" page
    │ If found → bcrypt.verify(submitted_password, stored_hash)
    │ If wrong password → 401 { detail: "WRONG_PASSWORD" }
    │   → Frontend shows "Wrong password. Give it another shot!"
    │ If correct → creates JWT { sub: user_id, email, exp: now+24h, iat: now }
    │ Returns { access_token: "xxx.yyy.zzz", token_type: "bearer" }
    ▼
Frontend stores token in localStorage
AuthContext reads token → calls GET /auth/me → gets user profile → stores in state
Redirects to /dashboard
```

**What is in the JWT payload (the `.yyyyy.` middle section, base64 decoded):**
```json
{
  "sub": "user-uuid-here",
  "email": "user@example.com",
  "exp": 1234567890,
  "iat": 1234567000
}
```
`sub` = subject (the user ID), `exp` = expiry timestamp, `iat` = issued-at timestamp

---

### 11.4 Dashboard Page

**On page load:**
```
Dashboard.jsx mounts
    │ Parallel requests:
    │   GET /api/jobs      → all my jobs (sorted by created_at desc)
    │   GET /api/resumes   → all my resume boards
    ▼
API Gateway
    │ Checks Authorization header → present? → forwards
    ▼
Job Service GET /jobs
    │ Calls auth-service /auth/verify with token
    │ If valid → queries jobs WHERE user_id = verified_user_id
    │ Returns array of job objects
    ▼
Dashboard renders:
    - Stats cards (applied count, interviewing count, offers, response rate)
    - Upcoming interviews (purple section) — jobs with interview_at in the future
    - Follow-up alerts (orange section) — jobs needing follow-up
    - Filter bar (location, salary slider, date range buttons)
    - Resume board tabs (if resumes exist)
    - Kanban board with 4 columns
    - Export CSV button
    - + Add Application button
```

---

### 11.5 Adding a New Job Application

**User clicks "+ Add Application", fills form, clicks "Add Application":**

```
Dashboard.jsx
    │ POST /api/jobs {
    │   company, role, status, applied_date, deadline,
    │   location, salary_min, salary_max, job_description
    │ }
    ▼
Job Service POST /jobs
    │ Verifies token
    │ Creates job record in database with user_id = current user
    │ Returns new job object
    ▼
Frontend adds job to local state → appears immediately in the correct Kanban column
```

---

### 11.6 Dragging a Job Card Between Columns

**User drags a card from "Applied" to "Interviewing":**

```
KanbanBoard.jsx (dnd-kit library handles drag gesture)
    │ onDragEnd fires when card is dropped
    │ PATCH /api/jobs/{job_id}/status { status: "interviewing" }
    ▼
Job Service PATCH /jobs/{id}/status
    │ Updates job.status in database
    │ Updates job.updated_at to now
    │ Publishes to Kafka topic "job-events":
    │   { event: "status_changed", new_status: "interviewing", user_email: "...", ... }
    │ Returns updated job object
    ▼
Frontend updates job in local state → card moves to new column instantly
    │
    │ (Meanwhile, asynchronously:)
    ▼
Notification Service (Kafka consumer)
    │ Receives the job-events message
    │ new_status = "interviewing" → matches EMAIL_TEMPLATES
    │ Calls send_email() via Gmail SMTP
    │ Subject: "Interview invite — Google"
    │ Logs to notification_logs table
```

---

### 11.7 Filters on the Dashboard

**User types "New York" in the location filter:**
```
Dashboard.jsx
    │ setFilters({ ...filters, location: "New York" })
    │ filteredJobs = jobs.filter(j =>
    │   j.location?.toLowerCase().includes("new york"))
    │ Passes filteredJobs to KanbanBoard (no API call!)
    ▼
KanbanBoard re-renders with only matching jobs
```

**User drags the salary slider to $100,000:**
```
filteredJobs = jobs.filter(j =>
    (j.salary_max || j.salary_min || 0) >= 100000)
```

**User clicks "30d" date button:**
```
filteredJobs = jobs.filter(j => {
    const ref = j.applied_date || j.updated_at
    return differenceInDays(now, parseISO(ref)) <= 30
})
```

All filters are **client-side** — no API calls, instant response.

---

### 11.8 Job Detail Page

**User clicks on a job card:**
```
JobCard.jsx → navigate(`/jobs/${job.id}`)
    │
    ▼
JobDetail.jsx mounts
    │ GET /api/jobs/{id}     → full job data including job_description
    │ GET /api/resumes       → for the resume board selector
    ▼
Renders:
    - Left panel: company, role, status badge, applied date, salary, interview date picker
    - Status "Move to" buttons (filters out current status)
    - Interview date & time picker (datetime-local input)
    - Notes textarea
    - Resume board assignment dropdown
    - Delete button
    - Right panel: AI Assistant (hidden if status = rejected)
```

**AI tabs visible per status:**
- Applied: Interview Prep + Cover Letter
- Interviewing: Interview Prep + Cover Letter
- Offer: Cover Letter only
- Rejected: AI panel hidden entirely

---

### 11.9 AI Assistant — Generate Tips

**User clicks "Generate tips" on the Interview Prep tab:**
```
JobDetail.jsx
    │ POST /api/ai/interview-prep {
    │   job_description: "We are looking for a...",
    │   user_context: "Role: Software Engineer at Google"
    │ }
    ▼
AI Service POST /ai/interview-prep
    │ Generates cache key = SHA256(job_description + user_context)
    │ Checks Redis → cache hit? Return cached response immediately
    │ Cache miss → calls Groq API (llama-3.3-70b model)
    │ Prompt: "Generate 5 interview questions and 5 prep tips as JSON"
    │ Parses AI response (handles newlines in JSON strings)
    │ Stores in Redis with 1 hour TTL
    │ Returns { questions: [...], tips: [...] }
    ▼
Frontend renders questions and tips
```

---

### 11.10 Setting an Interview Date

**User picks a date in the "Interview Date & Time" picker and clicks "Save":**
```
JobDetail.jsx
    │ PATCH /api/jobs/{id} { interview_at: "2026-05-01T14:30" }
    ▼
Job Service PATCH /jobs/{id}
    │ Updates interview_at in database
    │ Returns updated job
    ▼
Frontend updates local job state
    │
Dashboard.jsx (next page load or nav)
    │ upcomingInterviews = jobs.filter(j =>
    │   j.interview_at && new Date(j.interview_at) > new Date())
    │ Shows purple "Upcoming Interviews" section with this job
```

---

### 11.11 Follow-up Warning

**Follow-up warning appears on a card when:**
```
applied_date is 14+ days ago (for "applied" status)
OR applied_date is 7+ days ago (for "interviewing" status)
AND updated_at is also past the threshold (not recently touched)
```

**User clicks "Done ✓" on the follow-up warning:**
```
JobCard.jsx
    │ e.stopPropagation() ← prevents card click from opening detail page
    │ POST /api/jobs/{job_id}/mark-followed-up
    ▼
Job Service POST /jobs/{id}/mark-followed-up
    │ Sets updated_at = now
    │ Returns updated job
    ▼
KanbanBoard → Dashboard updates local job state
Warning disappears because updated_at is now recent
```

---

### 11.12 Export CSV

**User clicks "Export CSV":**
```
Dashboard.jsx exportCSV() function
    │ No API call needed! Data is already in memory (jobs array)
    │ Builds CSV string from jobs array
    │ Creates a Blob object (binary data in memory)
    │ Creates a temporary <a> tag with blob URL
    │ Programmatically clicks it → browser downloads the file
    │ Revokes the object URL (cleanup)
    ▼
Browser downloads "applications-2026-04-23.csv"
```

---

### 11.13 Admin Panel

**Only visible when logged in as `demo@jobtracker.com`:**
```
Admin.jsx
    │ Parallel requests:
    │   GET /api/auth/admin/users   → list of all registered users
    │   GET /api/jobs/admin/stats   → per-user job counts by status
    ▼
Auth Service checks: is current user demo@jobtracker.com? If not → 403 Forbidden
Job Service checks: same email check → 403 if not admin
    ▼
Admin.jsx combines data: for each user, look up their stats by user_id
Renders table with: name, email, joined date, applied/interviewing/offer/rejected counts,
last activity, and "Force logout" button
```

**Force logout button:**
```
POST /api/auth/admin/revoke/{user_id}
    ▼
Auth Service
    │ Stores revoke_before:{user_id} = current_timestamp in Redis (TTL 2 days)
    │ Any token for that user with iat < this timestamp is now invalid
    ▼
That user gets logged out on their next API request
```

---

### 11.14 Resume Board with Job Suggestions

**User creates a Resume Board with keywords "Python backend engineer":**
```
Dashboard.jsx
    │ POST /api/resumes { name: "Backend Resume", keywords: "Python backend engineer" }
    ▼
Job Service POST /resumes → saves to resumes table
    ▼
Dashboard shows the new tab → user clicks it → ResumeBoard component mounts

ResumeBoard.jsx
    │ keywords = resume.keywords  (must be explicitly set, not board name)
    │ keywords exists → render <JobSuggestions keywords="Python backend engineer" />

JobSuggestions.jsx
    │ GET /api/ai/job-suggestions?keywords=Python+backend+engineer
    ▼
AI Service GET /ai/job-suggestions
    │ Checks Redis cache for today's results
    │ Cache miss → calls Adzuna API
    │ Filters results: only keeps jobs where title contains "python", "backend", or "engineer"
    │ Caches results in Redis until end of day
    │ Returns { jobs: [...], source: "adzuna" }
    ▼
JobSuggestions renders table of matching openings
```

If no keywords are set → shows yellow "Add keywords to see job suggestions" prompt.

---

## 12. AI Features Explained

### How the AI Prompt-to-Response Flow Works

```
User action (click "Generate tips")
    │
    ▼
Frontend sends job_description + user_context
    │
    ▼
AI Service checks Redis cache
    │
    ├── Cache HIT → return cached JSON immediately (< 1ms)
    │
    └── Cache MISS
          │
          ▼
        Groq API (llama-3.3-70b-versatile model)
          │ Receives structured prompt asking for JSON output
          │ Returns text (sometimes with markdown code fences)
          │
          ▼
        parse_json_response() function
          │ Strips ```json ... ``` markdown wrappers
          │ If json.loads() fails: walks char-by-char, escapes
          │   newlines/tabs inside string values, retries
          │
          ▼
        Validated Python dict → stored in Redis → returned to frontend
```

### Why the JSON parsing is tricky

AI models return text. When asked for JSON, they sometimes:
- Wrap it in markdown: ` ```json { ... } ``` `
- Put actual newlines inside string values (e.g., in a cover letter with multiple paragraphs)
  which makes the JSON invalid: `{ "cover_letter": "Dear Sir,\n\nParagraph two..." }`
  The `\n` must be escaped as `\\n` in JSON strings.

The `parse_json_response` function handles all these cases.

---

## 13. Email Notifications Explained

### Types of Emails Sent

**1. Status change emails (instant, via Kafka):**
- Trigger: job status changes to "interviewing", "offer", or "rejected"
- Sender: `jobtracker.reminders1207@gmail.com`
- Template varies by status (congratulations for offer, encouragement for rejected)

**2. Follow-up reminder emails (daily, 9:00 AM):**
- Trigger: job is stale (14+ days applied, 7+ days interviewing)
- Contains: applied date, days elapsed, suggested follow-up message template

**3. Job suggestion emails (daily, 9:05 AM):**
- Trigger: user has at least one resume board with keywords
- Contains: up to 5 matching job openings from Adzuna with links

### Why Gmail + App Password?

Regular Gmail blocks third-party apps from using username+password via SMTP.
App Passwords are special 16-character codes that bypass this:
1. Enable 2-Factor Authentication on Gmail
2. Go to myaccount.google.com/apppasswords
3. Generate a password for "Job Tracker"
4. Use that code as `SMTP_PASSWORD` in `.env`

The app never knows your real Gmail password. You can revoke the app password anytime.

---

## 14. Security — How Login Really Works

### Password Hashing (bcrypt)

Passwords are NEVER stored in plain text. Instead:
1. bcrypt takes your password (e.g., "mypassword123")
2. Generates a random "salt" (random string added to prevent rainbow table attacks)
3. Runs the password+salt through a slow hashing function thousands of times
4. Stores the result: `$2b$12$randomsalt+hashedresult`

When you log in:
1. Database returns the stored hash
2. bcrypt.verify(submitted_password, stored_hash)
3. bcrypt re-hashes the submitted password with the same salt embedded in the hash
4. If results match → authenticated

The hash is one-way — you cannot reverse it to get the original password.

### JWT Security

The JWT signature uses `HMAC-SHA256` with a secret key (`JWT_SECRET` in docker-compose).
If anyone modifies the payload (e.g., changes user_id), the signature becomes invalid.
Any service can verify a token without contacting auth-service — but only auth-service
can ISSUE tokens (it has the secret key).

**Weakness of the current setup:** The JWT secret is hardcoded in docker-compose.yml as
`supersecretkey123`. In production, this should be a long random string stored securely.

### CORS Policy

All services use `allow_origins=["*"]` — any domain can call the API.
This is fine for a development/demo project but in production, you would restrict this
to only your frontend domain.

---

## 15. Sharing the App — Cloudflare Tunnel

### How the Tunnel Works

```
Friend's browser
    │ GET https://xxxx.trycloudflare.com/
    ▼
Cloudflare's servers (in the cloud)
    │ Tunnel connection (established from your laptop)
    ▼
cloudflared process on your laptop
    │ Forwards to http://localhost:3000
    ▼
nginx (frontend container)
    │ Serves the React app
    │ /api/* → api-gateway:8000
    ▼
Your friend sees the app exactly as you do
```

### Why the URL Changes

The **quick tunnel** (`cloudflared tunnel --url`) generates a random URL from Cloudflare's
pool of available subdomains. Each time you start the tunnel, you get a new random URL.

For a permanent URL, you need a named tunnel which requires owning a domain name.

### nginx Cache Headers (no-store)

`index.html` is served with `Cache-Control: no-store` which tells the browser:
"Do not cache this file, always fetch it fresh."

This means when you deploy a new version of the app, users immediately get the new
version next time they load the page — no stale cache issues.

JS/CSS files have content hashes in their filenames (e.g., `index-B_WXI0B0.js`).
These are cached aggressively because if the content changes, Vite generates a
different filename, so the browser always fetches the right version.

---

## 16. Tech Stack Summary

| Component | Technology | Why This Choice |
|-----------|-----------|-----------------|
| Frontend | React 18 + Vite | Industry standard, fast builds, great ecosystem |
| Styling | Tailwind CSS | Rapid development, consistent design system |
| HTTP client | axios | Interceptors for JWT attachment and 401 handling |
| Routing | React Router v6 | Standard SPA routing |
| Drag & Drop | dnd-kit | Lightweight, accessible, works well with React |
| Charts | Recharts | Simple React charting library |
| Date handling | date-fns | Lightweight alternative to moment.js |
| Backend | Python + FastAPI | Fast, async, automatic OpenAPI docs, great DX |
| ORM | SQLAlchemy | Python's most popular ORM, supports raw SQL too |
| Validation | Pydantic v2 | Type-safe request/response validation |
| Database | PostgreSQL 16 | Production-grade, open source, ACID compliant |
| Cache | Redis 7 | In-memory, sub-millisecond, TTL support |
| Messages | Apache Kafka | Scalable event streaming, persistent log |
| AI model | Groq / llama-3.3-70b | Free tier, fast inference, good JSON output |
| Jobs API | Adzuna | Free tier, real job listings, global coverage |
| Email | Gmail SMTP + smtplib | Free, reliable, no third-party service needed |
| Scheduling | APScheduler | Simple Python job scheduler, async support |
| Auth | JWT + bcrypt | Stateless auth, secure password hashing |
| Containers | Docker + Compose | Reproducible environments, easy multi-service setup |
| Web server | nginx | Serves static files, reverse proxy for /api/ |
| Tunnel | Cloudflare Tunnel | Free, secure, no port forwarding needed |

---

## Environment Variables Reference

All secrets are stored in `.env` in the project root. Docker Compose reads this file
and passes the values to each container.

```dotenv
# AI
GROQ_API_KEY=gsk_...          ← API key for Groq (LLM provider)

# Job listings
ADZUNA_APP_ID=...              ← Adzuna API app ID
ADZUNA_APP_KEY=...             ← Adzuna API key

# Email
SMTP_HOST=smtp.gmail.com       ← Gmail's SMTP server address
SMTP_PORT=587                  ← STARTTLS port
SMTP_USER=jobtracker...@gmail.com  ← Sender email address
SMTP_PASSWORD=tvqe xbro ...    ← Gmail App Password (16 chars)

# App
SCHEDULER_TIMEZONE=America/Chicago  ← Timezone for daily email jobs
DEMO_PASSWORD=JobTracker2026        ← Password for demo@jobtracker.com
```

These values are injected into containers as environment variables and read using
`os.getenv("VARIABLE_NAME")` in Python or `import.meta.env.VITE_*` in Vite.

---

*This document covers the complete Job Tracker application as of April 2026.*
*Ask any question about how a specific feature works, why a technology was chosen,*
*or what happens when you click any button.*
