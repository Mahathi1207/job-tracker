"""
Job Service — full CRUD for job applications, Kanban pipeline status management,
and Kafka event publishing on every status change.
"""
import uuid
import os
import json
import asyncio
from datetime import datetime, date, timezone
from typing import Optional, List
from contextlib import asynccontextmanager

import httpx
from aiokafka import AIOKafkaProducer
from fastapi import FastAPI, Depends, HTTPException, status, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Column, String, DateTime, Date, Integer, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session
from pydantic import BaseModel
from dotenv import load_dotenv

from database import engine, Base, get_db

load_dotenv()

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
AUTH_SERVICE_URL = os.getenv("AUTH_SERVICE_URL", "http://auth-service:8001")

VALID_STATUSES = {"applied", "interviewing", "offer", "rejected"}

# Shared Kafka producer — started once at app startup and stopped at shutdown
kafka_producer: Optional[AIOKafkaProducer] = None


# ── SQLAlchemy model ──────────────────────────────────────────
class Job(Base):
    __tablename__ = "jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    company = Column(String, nullable=False)
    role = Column(String, nullable=False)
    status = Column(String, default="applied")
    job_description = Column(Text)
    notes = Column(Text)
    applied_date = Column(Date, default=date.today)
    deadline = Column(Date)
    salary_min = Column(Integer)
    salary_max = Column(Integer)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))


Base.metadata.create_all(bind=engine)


# ── Pydantic schemas (v2) ─────────────────────────────────────
class JobCreate(BaseModel):
    company: str
    role: str
    status: str = "applied"
    job_description: Optional[str] = None
    notes: Optional[str] = None
    applied_date: Optional[date] = None
    deadline: Optional[date] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None


class JobUpdate(BaseModel):
    company: Optional[str] = None
    role: Optional[str] = None
    job_description: Optional[str] = None
    notes: Optional[str] = None
    deadline: Optional[date] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None


class StatusUpdate(BaseModel):
    status: str


class JobResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    company: str
    role: str
    status: str
    job_description: Optional[str] = None
    notes: Optional[str] = None
    applied_date: Optional[date] = None
    deadline: Optional[date] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ── Auth dependency — validates JWT by calling auth-service ───
async def get_current_user_info(authorization: str = Header(...)) -> dict:
    """
    Validates the Bearer token with auth-service and returns {user_id, email}.
    Raises 401 if invalid, 503 if auth-service is unreachable.
    """
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(
                f"{AUTH_SERVICE_URL}/auth/verify",
                headers={"authorization": authorization},
            )
            data = resp.json()
            if not data.get("valid"):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired token",
                )
            return {"user_id": data["user_id"], "email": data.get("email", "")}
        except httpx.RequestError:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Auth service unavailable",
            )


# ── Kafka helpers ─────────────────────────────────────────────
async def publish_job_event(event: dict):
    """
    Fire-and-forget: publishes a JSON event to the 'job-events' Kafka topic.
    Silently skips if the producer is unavailable so a Kafka outage
    doesn't break the rest of the job CRUD API.
    """
    if kafka_producer is None:
        return
    try:
        await kafka_producer.send_and_wait(
            "job-events",
            json.dumps(event).encode("utf-8"),
        )
    except Exception as e:
        print(f"[Kafka] Failed to publish event: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global kafka_producer
    # Retry Kafka connection — Kafka may take 30-60 s to become ready in Docker
    for attempt in range(12):
        try:
            kafka_producer = AIOKafkaProducer(
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                retry_backoff_ms=500,
            )
            await kafka_producer.start()
            print("[Kafka] Producer connected successfully")
            break
        except Exception as e:
            print(f"[Kafka] Connection attempt {attempt + 1}/12 failed: {e}")
            kafka_producer = None
            if attempt < 11:
                await asyncio.sleep(5)
            else:
                print("[Kafka] Proceeding without Kafka — status events will not be published")
    yield
    if kafka_producer:
        await kafka_producer.stop()


# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="Job Service",
    description="Manages job applications with full CRUD and Kanban pipeline status tracking.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "job-service"}


@app.post("/jobs", response_model=JobResponse, status_code=201)
async def create_job(
    job_in: JobCreate,
    user_info: dict = Depends(get_current_user_info),
    db: Session = Depends(get_db),
):
    if job_in.status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")

    job = Job(**job_in.model_dump(), user_id=uuid.UUID(user_info["user_id"]))
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@app.get("/jobs", response_model=List[JobResponse])
async def list_jobs(
    user_info: dict = Depends(get_current_user_info),
    status_filter: Optional[str] = Query(None, alias="status"),
    sort_by: str = Query("applied_date"),
    db: Session = Depends(get_db),
):
    query = db.query(Job).filter(Job.user_id == uuid.UUID(user_info["user_id"]))

    if status_filter:
        query = query.filter(Job.status == status_filter)

    # Default: newest applications first
    order_col = Job.applied_date if sort_by == "applied_date" else Job.created_at
    query = query.order_by(order_col.desc())

    return query.all()


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: uuid.UUID,
    user_info: dict = Depends(get_current_user_info),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Job)
        .filter(Job.id == job_id, Job.user_id == uuid.UUID(user_info["user_id"]))
        .first()
    )
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@app.patch("/jobs/{job_id}", response_model=JobResponse)
async def update_job(
    job_id: uuid.UUID,
    job_in: JobUpdate,
    user_info: dict = Depends(get_current_user_info),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Job)
        .filter(Job.id == job_id, Job.user_id == uuid.UUID(user_info["user_id"]))
        .first()
    )
    if not job:
        raise HTTPException(404, "Job not found")

    for field, value in job_in.model_dump(exclude_unset=True).items():
        setattr(job, field, value)
    job.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return job


@app.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: uuid.UUID,
    user_info: dict = Depends(get_current_user_info),
    db: Session = Depends(get_db),
):
    job = (
        db.query(Job)
        .filter(Job.id == job_id, Job.user_id == uuid.UUID(user_info["user_id"]))
        .first()
    )
    if not job:
        raise HTTPException(404, "Job not found")
    db.delete(job)
    db.commit()


@app.patch("/jobs/{job_id}/status", response_model=JobResponse)
async def update_job_status(
    job_id: uuid.UUID,
    status_in: StatusUpdate,
    user_info: dict = Depends(get_current_user_info),
    db: Session = Depends(get_db),
):
    if status_in.status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")

    job = (
        db.query(Job)
        .filter(Job.id == job_id, Job.user_id == uuid.UUID(user_info["user_id"]))
        .first()
    )
    if not job:
        raise HTTPException(404, "Job not found")

    old_status = job.status
    job.status = status_in.status
    job.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)

    # Publish a Kafka event so notification-service can send an email
    await publish_job_event(
        {
            "user_id": user_info["user_id"],
            "user_email": user_info["email"],
            "job_id": str(job.id),
            "company": job.company,
            "role": job.role,
            "old_status": old_status,
            "new_status": status_in.status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    )

    return job
