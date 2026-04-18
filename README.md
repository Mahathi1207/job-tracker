# Job Tracker — AI-Powered Application Manager

A full-stack, microservices portfolio project that helps job seekers track applications through a Kanban pipeline, with AI-generated resume tips, interview prep, and cover letters powered by the Claude API.

---

## Architecture

```
Browser
   │
   ▼
┌──────────────┐    Redis (rate limit)
│  API Gateway │◄──────────────────────
│  :8000       │
└──────┬───────┘
       │ routes by path prefix
  ┌────┴──────────────────────────────────┐
  │                                       │
  ▼                                       ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐
│ Auth Service │  │ Job  Service │  │  AI Service  │  │ Notification Service │
│ :8001        │  │ :8002        │  │ :8003        │  │ :8004                │
│              │  │              │  │              │  │                      │
│ JWT login /  │  │ CRUD jobs    │  │ Claude API   │  │ Kafka consumer       │
│ register /   │  │ Kanban status│  │ Redis cache  │  │ SMTP emails          │
│ verify       │  │ Kafka events │  │              │  │ APScheduler          │
└──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────────┬───────────┘
       │                 │                                        │
       ▼                 ▼                                        │
┌──────────────────────────────────┐                             │
│          PostgreSQL :5432        │◄────────────────────────────┘
│  (single jobtracker DB,          │
│   tables per service domain)     │
└──────────────────────────────────┘
       ▲                 │
       │          ┌──────┴───────┐
       │          │  Kafka :9092 │
       │          │  (job-events)│
       │          └──────────────┘
       │
┌──────┴───────┐
│   Redis :6379│  ← rate limiting + token blacklist + AI response cache
└──────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, dnd-kit, Recharts |
| Backend | Python 3.11, FastAPI, SQLAlchemy, Pydantic v2 |
| AI | Anthropic Claude API (claude-sonnet-4-20250514) |
| Database | PostgreSQL 16 |
| Cache / Blacklist | Redis 7 |
| Message Bus | Apache Kafka (Confluent) |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- An [Anthropic API key](https://console.anthropic.com/)
- (Optional) An SMTP account for email notifications

---

## How to Run

```bash
# 1. Clone the repo
git clone https://github.com/your-username/job-tracker.git
cd job-tracker

# 2. Configure environment variables
cp .env.example .env   # then edit .env and fill in your keys

# 3. Start everything
docker compose up --build

# 4. Open the app
#    Frontend  → http://localhost:3000
#    API Docs  → http://localhost:8000/docs  (gateway, no auth docs)
#    Auth docs → http://localhost:8001/docs
#    Jobs docs → http://localhost:8002/docs
```

**Demo credentials** (pre-seeded):
- Email: `demo@jobtracker.com`
- Password: `demo1234`

---

## Environment Variables (.env)

```dotenv
ANTHROPIC_API_KEY=sk-ant-...

# SMTP (optional — leave blank to skip emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
```

---

## API Endpoints

All requests go through the gateway on `:8000`. The gateway strips the prefix and forwards.

### Auth Service (`/auth/*`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | — | Register a new user |
| POST | `/auth/login` | — | Login, returns JWT |
| GET | `/auth/me` | JWT | Get current user profile |
| POST | `/auth/logout` | JWT | Invalidate token |
| POST | `/auth/verify` | — | Validate a Bearer token (service-to-service) |

### Job Service (`/jobs/*`) — requires JWT

| Method | Path | Description |
|--------|------|-------------|
| POST | `/jobs` | Create a new job application |
| GET | `/jobs` | List all applications (filter by `?status=`, sort by `?sort_by=`) |
| GET | `/jobs/{id}` | Get a single application |
| PATCH | `/jobs/{id}` | Update fields (company, role, notes, salary, deadline) |
| DELETE | `/jobs/{id}` | Delete an application |
| PATCH | `/jobs/{id}/status` | Update Kanban status → fires Kafka event |

### AI Service (`/ai/*`) — requires JWT

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/resume-tips` | 7 resume tips tailored to the job description |
| POST | `/ai/interview-prep` | 5 likely questions + 5 prep tips |
| POST | `/ai/cover-letter` | Full cover letter + 3 key selling points |

All AI endpoints accept `{ "job_description": "...", "user_context": "..." }` and cache responses in Redis for 1 hour.

### Notification Service (`/notifications/*`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/notifications/test` | Send a test email |
| GET | `/notifications/logs` | Last 50 notification log entries |

### Gateway

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Pings all services, returns aggregate status |

---

## Project Structure

```
job-tracker/
├── docker-compose.yml
├── .env
├── services/
│   ├── api-gateway/        main.py — reverse proxy + rate limiting
│   ├── auth-service/       main.py — JWT auth + Redis blacklist
│   ├── job-service/        main.py — CRUD + Kafka producer
│   ├── ai-service/         main.py — Claude API + Redis cache
│   └── notification-service/ main.py — Kafka consumer + SMTP
├── frontend/
│   └── src/
│       ├── pages/          Login, Register, Dashboard, JobDetail, Charts
│       ├── components/     Navbar, KanbanBoard, JobCard, ProtectedRoute
│       ├── contexts/       AuthContext (JWT state)
│       └── api/            axios.js (interceptors)
├── infra/
│   └── postgres/
│       └── init.sql        Schema + 50 seed rows
└── .github/
    └── workflows/
        └── ci.yml          Lint → Test → Build Docker images
```

---

## Screenshots

_Add screenshots here after running the app locally._

| Dashboard (Kanban) | Job Detail + AI Tips | Analytics |
|-------------------|---------------------|-----------|
| _(screenshot)_ | _(screenshot)_ | _(screenshot)_ |

---

## Key Design Decisions

- **Single PostgreSQL instance, separate tables** — avoids network overhead of cross-service DB calls while keeping the schema simple for a portfolio project. In production, each service would own its own database.
- **Kafka for status events** — decouples job-service from notification-service; adding new event consumers (Slack, webhooks) requires no changes to the producer.
- **Redis caching in ai-service** — identical job descriptions (e.g., from the same job board URL) return instantly from cache, cutting API costs and latency.
- **Token blacklisting in Redis** — logout is immediate without JWT invalidation complexity; Redis TTL matches token expiry so the blacklist never grows unbounded.
- **API Gateway rate limiting** — 100 req/min per IP protects downstream services from abuse without requiring each service to implement its own limiter.
