"""
Notification Service — listens to 'job-events' Kafka topic and sends email notifications.
Daily APScheduler jobs:
  1. Follow-up reminders at 09:00 UTC — emails users about stale applications
  2. Job suggestions at 09:05 UTC — emails matching Adzuna openings per user keywords
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
SMTP_HOST     = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER     = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ADZUNA_APP_ID      = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY     = os.getenv("ADZUNA_APP_KEY", "")
APP_URL            = os.getenv("APP_URL", "http://localhost:3000")
SCHEDULER_TIMEZONE = os.getenv("SCHEDULER_TIMEZONE", "America/Chicago")


# ── SQLAlchemy model ──────────────────────────────────────────
class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id                = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id           = Column(String, nullable=False)
    job_id            = Column(String)
    notification_type = Column(String, nullable=False)
    recipient_email   = Column(String)
    sent_at           = Column(DateTime(timezone=True), server_default=text("now()"))
    status            = Column(String, default="sent")


Base.metadata.create_all(bind=engine)


# ── Email templates for Kafka status-change events ────────────
EMAIL_TEMPLATES: dict[str, tuple[str, str]] = {
    "interviewing": (
        "Interview invite — {company}",
        """<h2>Great news!</h2>
        <p>You've advanced to the <strong>interview stage</strong> at <strong>{company}</strong>
        for the <strong>{role}</strong> position.</p>
        <p>Check your Job Tracker for AI-generated interview tips!</p>
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

FOLLOWUP_SUBJECT = "Time to follow up — {company} ({role})"
FOLLOWUP_BODY = """\
<div style="font-family: sans-serif; max-width: 560px; margin: auto;">
  <h2 style="color:#ea580c;">Don't forget to follow up!</h2>
  <p>You applied for <strong>{role}</strong> at <strong>{company}</strong>
  on <strong>{applied_date}</strong>.</p>
  <p>It's been <strong>{days} days</strong> with no status update.
  A quick follow-up email can significantly boost your chances!</p>
  <p><strong>Suggested message:</strong></p>
  <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555;margin:12px 0;">
    Hi [Hiring Manager],<br><br>
    I wanted to follow up on my application for the {role} position at {company}.
    I remain very interested in this opportunity and would love to discuss how I can contribute.<br><br>
    Thank you for your time!
  </blockquote>
  <a href="{app_url}" style="display:inline-block;margin-top:16px;padding:10px 20px;
     background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;">
    Open Job Tracker
  </a>
</div>"""


# ── Email helper ──────────────────────────────────────────────
def send_email(to_email: str, subject: str, html_body: str) -> bool:
    if not SMTP_USER or not SMTP_PASSWORD:
        print(f"[Email] SMTP not configured — would send '{subject}' to {to_email}")
        return True

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_USER
        msg["To"]      = to_email
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


def log_notification(user_id: str, job_id: str, notification_type: str, email: str, success: bool):
    db = SessionLocal()
    try:
        db.add(NotificationLog(
            user_id=user_id,
            job_id=job_id,
            notification_type=notification_type,
            recipient_email=email,
            status="sent" if success else "failed",
        ))
        db.commit()
    except Exception as e:
        print(f"[NotificationLog] Failed to write: {e}")
    finally:
        db.close()


def already_sent_today(job_id: str, notification_type: str) -> bool:
    db = SessionLocal()
    try:
        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        count = (
            db.query(NotificationLog)
            .filter(
                NotificationLog.job_id == job_id,
                NotificationLog.notification_type == notification_type,
                NotificationLog.sent_at >= today_start,
            )
            .count()
        )
        return count > 0
    finally:
        db.close()


# ── Kafka consumer ────────────────────────────────────────────
async def consume_job_events():
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
                print("[Kafka] Could not connect — status-change emails disabled")
                return

    try:
        async for msg in consumer:
            try:
                event      = json.loads(msg.value.decode("utf-8"))
                new_status = event.get("new_status")
                user_email = event.get("user_email", "")
                company    = event.get("company", "")
                role       = event.get("role", "")
                user_id    = event.get("user_id", "")
                job_id     = event.get("job_id", "")

                if new_status in EMAIL_TEMPLATES and user_email:
                    subject_tpl, body_tpl = EMAIL_TEMPLATES[new_status]
                    subject = subject_tpl.format(company=company, role=role)
                    body    = body_tpl.format(company=company, role=role)
                    success = send_email(user_email, subject, body)
                    log_notification(user_id, job_id, new_status, user_email, success)
                    print(f"[Notification] '{new_status}' email → {user_email} — {'ok' if success else 'failed'}")
            except Exception as e:
                print(f"[Kafka] Error processing message: {e}")
    finally:
        if consumer:
            await consumer.stop()


# ── Daily follow-up reminders ─────────────────────────────────
async def send_followup_reminders():
    print("[Scheduler] Running follow-up reminder check…")
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT j.id, j.user_id, j.company, j.role, j.status, j.applied_date,
                       u.email, u.full_name
                FROM jobs j
                JOIN users u ON j.user_id = u.id
                WHERE j.status IN ('applied', 'interviewing')
                  AND j.applied_date IS NOT NULL
                  AND (
                    (j.status = 'applied'      AND j.applied_date <= CURRENT_DATE - INTERVAL '14 days')
                    OR (j.status = 'interviewing' AND j.applied_date <= CURRENT_DATE - INTERVAL '7 days')
                  )
            """)).fetchall()
    except Exception as e:
        print(f"[Scheduler] DB error fetching follow-up jobs: {e}")
        return

    for row in rows:
        job_id = str(row.id)
        if already_sent_today(job_id, "follow_up"):
            continue

        days = (date.today() - row.applied_date).days
        subject = FOLLOWUP_SUBJECT.format(company=row.company, role=row.role)
        body = FOLLOWUP_BODY.format(
            company=row.company,
            role=row.role,
            applied_date=row.applied_date.strftime("%B %d, %Y"),
            days=days,
            app_url=APP_URL,
        )
        success = send_email(row.email, subject, body)
        log_notification(str(row.user_id), job_id, "follow_up", row.email, success)
        print(f"[Scheduler] Follow-up → {row.email} for {row.company} — {'ok' if success else 'failed'}")


# ── Daily job suggestions ─────────────────────────────────────
async def send_job_suggestions():
    print("[Scheduler] Running job suggestions…")
    if not ADZUNA_APP_ID or not ADZUNA_APP_KEY:
        print("[Scheduler] Adzuna not configured — skipping job suggestions")
        return

    try:
        with engine.connect() as conn:
            users = conn.execute(text("""
                SELECT DISTINCT ON (u.id)
                       u.id, u.email, u.full_name,
                       COALESCE(r.keywords, '') AS keywords
                FROM users u
                LEFT JOIN resumes r ON r.user_id = u.id
            """)).fetchall()
    except Exception as e:
        print(f"[Scheduler] DB error fetching users: {e}")
        return

    async with httpx.AsyncClient(timeout=15) as client:
        for user in users:
            raw_keywords = user.keywords or ""
            search_term = raw_keywords.split(",")[0].strip() if raw_keywords else "software engineer"

            try:
                resp = await client.get(
                    "https://api.adzuna.com/v1/api/jobs/us/search/1",
                    params={
                        "app_id": ADZUNA_APP_ID,
                        "app_key": ADZUNA_APP_KEY,
                        "what": search_term,
                        "results_per_page": 5,
                        "sort_by": "date",
                    },
                )
                job_results = resp.json().get("results", [])
            except Exception as e:
                print(f"[Scheduler] Adzuna error for {user.email}: {e}")
                continue

            if not job_results:
                continue

            items_html = "".join(
                f"""<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:8px 0;">
                  <strong style="color:#1f2937;">{j.get('title','Unknown Role')}</strong><br>
                  <span style="color:#6b7280;">{j.get('company',{}).get('display_name','Unknown')}
                  · {j.get('location',{}).get('display_name','')}</span><br>
                  <a href="{j.get('redirect_url','#')}"
                     style="color:#2563eb;font-size:14px;text-decoration:none;">View Job →</a>
                </div>"""
                for j in job_results
            )

            name = user.full_name or "there"
            subject = f"Today's top {search_term} jobs for you"
            body = f"""\
<div style="font-family:sans-serif;max-width:560px;margin:auto;">
  <h2>Hi {name}!</h2>
  <p>Here are today's fresh openings matching <strong>{search_term}</strong>:</p>
  {items_html}
  <a href="{APP_URL}" style="display:inline-block;margin-top:16px;padding:10px 20px;
     background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;">
    Open Job Tracker
  </a>
  <p style="color:#9ca3af;font-size:12px;margin-top:24px;">
    You're receiving this because you have an account on Job Tracker.
  </p>
</div>"""

            success = send_email(user.email, subject, body)
            print(f"[Scheduler] Job suggestions → {user.email} ({search_term}) — {'ok' if success else 'failed'}")


# ── Lifespan ──────────────────────────────────────────────────
scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    consumer_task = asyncio.create_task(consume_job_events())
    scheduler.add_job(send_followup_reminders, "cron", hour=9, minute=0, timezone=SCHEDULER_TIMEZONE)
    scheduler.add_job(send_job_suggestions,    "cron", hour=9, minute=5, timezone=SCHEDULER_TIMEZONE)
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
    description="Status-change emails via Kafka + daily follow-up and job suggestion emails.",
    version="2.0.0",
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
    success = send_email(req.to_email, req.subject, f"<p>{req.body}</p>")
    if not success:
        raise HTTPException(500, "Failed to send email — check SMTP config in .env")
    return {"message": "Email sent successfully", "to": req.to_email}


@app.post("/notifications/trigger-followup")
async def trigger_followup():
    """Manually trigger follow-up reminder check (for testing)."""
    await send_followup_reminders()
    return {"message": "Follow-up check complete"}


@app.post("/notifications/trigger-suggestions")
async def trigger_suggestions():
    """Manually trigger job suggestions (for testing)."""
    await send_job_suggestions()
    return {"message": "Job suggestions sent"}


@app.get("/notifications/logs")
async def list_logs(db: Session = Depends(get_db)):
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
