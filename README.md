# Job Tracker — Agentic AI Operations Platform

An end-to-end, 6-service agentic AI platform that automates job search operations — built to solve a real problem, not as a demo.

[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docker.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://postgresql.org)

---

## What This Is

Job searching manually is operationally expensive. Every morning: check boards, read JDs, compare against your resume, draft outreach, track applications. Most of that shouldn't require human judgment.

This platform automates the analysis layer — ingesting job descriptions, scoring them against a candidate profile, flagging sponsorship red flags, surfacing keyword gaps, and generating tailored outreach drafts. The human stays in the loop for decisions. The system handles the data work.

The part I'm most proud of: **the evaluation layer**. Every AI output is validated against defined business rules before it's surfaced. A workflow that outputs wrong answers confidently is worse than no automation at all.

---

## Architecture

6 independent services communicating via Kafka:

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  React UI   │────▶│  FastAPI    │────▶│ Kafka Broker │
└─────────────┘     └─────────────┘     └──────┬───────┘
                                                │
              ┌─────────────────────────────────┼──────────────────┐
              ▼                                 ▼                  ▼
      ┌──────────────┐                 ┌──────────────┐   ┌──────────────┐
      │  JD Ingestion│                 │ AI Analysis  │   │  Outreach    │
      │  Service     │                 │ Service      │   │  Generator   │
      │  (FastAPI)   │                 │ Claude/Groq  │   │  Service     │
      └──────┬───────┘                 └──────┬───────┘   └──────────────┘
             │                                │
             ▼                                ▼
      ┌──────────────┐                 ┌──────────────┐
      │  PostgreSQL  │                 │    Redis     │
      │  (storage)   │                 │   (cache)    │
      └──────────────┘                 └──────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React |
| Backend | FastAPI (Python) |
| Message Queue | Apache Kafka |
| Cache | Redis |
| Database | PostgreSQL |
| AI Models | Claude API (Anthropic), Groq/LLaMA |
| Containerization | Docker |
| AI Patterns | RAG pipelines, Agentic Workflows, Prompt Engineering, MCP |

---

## Key Features

- **JD Analysis** — Ingests job descriptions and scores them against a candidate profile with keyword gap detection and sponsorship flag screening
- **AI Evaluation Layer** — Validates every LLM output against defined business rules before surfacing; catches hallucinations and off-target recommendations
- **Agentic Workflows** — Multi-step reasoning chains that go from raw JD to scored analysis to tailored resume suggestions without human intervention
- **Self-serve Dashboards** — Real-time KPI visibility into application pipeline, response rates, and outreach performance
- **Outreach Generation** — Drafts personalized recruiter emails grounded in JD-specific context, not generic templates

---

## Results

- **40% reduction** in manual job search overhead
- **Consistent output quality** through evaluation logic — not blind AI trust
- End-to-end ownership: problem definition → architecture → deployment → iteration

---

## What I Learned

The hardest part of building AI into operations workflows isn't the integration — it's knowing when to trust the output. This project taught me that the right question isn't "can the AI do this?" but "how do I know when it's wrong?"

---

*Built by Mahathi Marepalli — [LinkedIn](https://www.linkedin.com/in/mahathi-marepalli/) · [Email](mailto:mahathimarepalli23@gmail.com)*

---

**Want to go deeper?** See [TECHNICAL.md](./TECHNICAL.md) for a complete walkthrough — every service, every click, every design decision explained from first principles.
