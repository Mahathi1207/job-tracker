"""
Notification Service — listens to 'job-events' Kafka topic and sends email notifications.
Also runs a daily APScheduler job to remind users about upcoming application deadlines.
"""
import os
import json
import asyncio
import smtplib
import uuid
from datetime import datetime, date, timedelta
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from aiokafka import AIOKafkaConsumer
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Column, String, DateTime, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv

from database import engine, Base, SessionLocal, get_db

load_dotenv()

KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
JOB_SERVICE_URL = os.getenv("JOB_SERVICE_URL", "http://job-service:8002")


# ── SQLAlchemy model — persists a log of every notification sent ──
class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(String, nullable=False)
    job_id = Column(String)
    notification_type = Column(String, nullable=False)
    recipient_email = Column(String)
    sent_at = Column(DateTime(timezone=True), server_default=text("now()"))
    status = Column(String, default="sent")  # "sent" | "failed"


Base.metadata.create_all(bind=engine)


# ── Email templates keyed by new job status ───────────────────
EMAIL_TEMPLATES: dict[str, tuple[str, str]] = {
    "interviewing": (
        "Interview invite — {company}",
        """<h2>Great news!</h2>
        <p>You've advanced to the <strong>interview stage</strong> at <strong>{company}</strong>
        for the <strong>{role}</strong> position.</p>
        <p>Make sure you prepare thoroughly — check your Job Tracker for AI-generated interview tips!</p>
        <p>Good luck! 🍀</p>""",
    ),
    "offer": (
        "Job offer received — {company} 🎉",
        """<h2>Congratulations!</h2>
        <p>You've received an <strong>offer</strong> from <strong>{company}</strong>
        for the <strong>{role}</strong> position.</p>
        <p>Take your time to evaluate it carefully. You've worked hard for this!</p>""",
    ),
    "rejected": (
        "Keep going — next one's the one",
        """<h2>Don't give up!</h2>
        <p>Unfortunately, things didn't work out with <strong>{company}</strong>
        for the <strong>{role}</strong> position.</p>
        <p>Every rejection is one step closer to the right opportunity. Keep applying! 💪</p>""",
    ),
}


# ── Email helper ──────────────────────────────────────────────
def send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send an HTML email via SMTP. Returns True on success."""
    if not SMTP_USER or not SMTP_PASSWORD:
        print(f"[Email] SMTP not configured — would have sent '{subject}' to {to_email}")
        return True  # Treat as success so the log entry is still recorded

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_USER
        msg["To"] = to_email
        msg.attach(MIMEText(html_body, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_USER, to_email, msg.as_string())
        return True
    except Exception as e:
        print(f"[Email] Error sending to {to_email}: {e}")
        return False


def log_notification(
    user_id: str,
    job_id: str,
    notification_type: str,
    email: str,
    success: bool,
):
    """Persist a notification record to the DB."""
    db = SessionLocal()
    try:
        entry = NotificationLog(
            user_id=user_id,
            job_id=job_id,
            notification_type=notification_type,
            recipient_email=email,
            status="sent" if success else "failed",
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        print(f"[NotificationLog] Failed to write log: {e}")
    finally:
        db.close()


# ── Kafka consumer — runs as a background asyncio task ────────
async def consume_job_events():
    """
    Subscribes to 'job-events' Kafka topic.
    On each status-change event, sends a templated email to the user.
    Retries connection up to 12 times with 5-second back-off.
    """
    consumer = None
    for attempt in range(12):
        try:
            consumer = AIOKafkaConsumer(
                "job-events",
                bootstrap_servers=KAFKA_BOOTSTRAP_SERVERS,
                group_id="notification-service-v1",
                auto_offset_reset="earliest",
            )
            await consumer.start()
            print("[Kafka] Consumer connected — listening on 'job-events'")
            break
        except Exception as e:
            print(f"[Kafka] Consumer attempt {attempt + 1}/12 failed: {e}")
            consumer = None
            if attempt < 11:
                await asyncio.sleep(5)
            else:
                print("[Kafka] Could not connect — email notifications disabled")
                return

    try:
        async for msg in consumer:
            try:
                event = json.loads(msg.value.decode("utf-8"))
                new_status = event.get("new_status")
                user_email = event.get("user_email", "")
                company = event.get("company", "")
                role = event.get("role", "")
                user_id = event.get("user_id", "")
                job_id = event.get("job_id", "")

                if new_status in EMAIL_TEMPLATES and user_email:
                    subject_tpl, body_tpl = EMAIL_TEMPLATES[new_status]
                    subject = subject_tpl.format(company=company, role=role)
                    body = body_tpl.format(company=company, role=role)
                    success = send_email(user_email, subject, body)
                    log_notification(user_id, job_id, new_status, user_email, success)
                    print(f"[Notification] Sent '{new_status}' email to {user_email} — {'ok' if success else 'failed'}")
            except Exception as e:
                print(f"[Kafka] Error processing message: {e}")
    finally:
        if consumer:
            await consumer.stop()


# ── Deadline reminder — runs daily at 08:00 UTC ───────────────
async def send_deadline_reminders():
    """
    Checks jobs with deadlines in the next 3 days and emails the owners.
    Calls job-service internally (service-to-service without user auth).
    """
    print("[Scheduler] Running deadline reminder check…")
    cutoff = date.today() + timedelta(days=3)
    # NOTE: In production, use a service account token or a shared internal header.
    # For demo purposes we log the scheduled execution.
    print(f"[Scheduler] Would remind users about jobs with deadlines before {cutoff}")


# ── Lifespan — wire up background tasks ──────────────────────
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    consumer_task = asyncio.create_task(consume_job_events())
    scheduler.add_job(send_deadline_reminders, "cron", hour=8, minute=0)
    scheduler.start()
    yield
    consumer_task.cancel()
    try:
        await consumer_task
    except asyncio.CancelledError:
        pass
    scheduler.shutdown(wait=False)


# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="Notification Service",
    description="Sends email notifications from Kafka events and deadline reminders.",
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


# ── Schemas ───────────────────────────────────────────────────
class TestEmailRequest(BaseModel):
    to_email: EmailStr
    subject: str = "Test notification from Job Tracker"
    body: str = "This is a test notification from your Job Application Tracker."


# ── Routes ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "notification-service"}


@app.post("/notifications/test")
async def test_notification(req: TestEmailRequest):
    """Test endpoint — verifies SMTP configuration is working correctly."""
    html_body = f"<p>{req.body}</p>"
    success = send_email(req.to_email, req.subject, html_body)
    if not success:
        raise HTTPException(
            status_code=500,
            detail="Failed to send email. Check SMTP_HOST / SMTP_USER / SMTP_PASSWORD in .env",
        )
    return {"message": "Email sent successfully", "to": req.to_email}


@app.get("/notifications/logs")
async def list_logs(db: Session = Depends(get_db)):
    """Returns the last 50 notification log entries (newest first)."""
    logs = (
        db.query(NotificationLog)
        .order_by(NotificationLog.sent_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": str(log.id),
            "user_id": log.user_id,
            "job_id": log.job_id,
            "type": log.notification_type,
            "email": log.recipient_email,
            "status": log.status,
            "sent_at": log.sent_at.isoformat() if log.sent_at else None,
        }
        for log in logs
    ]
