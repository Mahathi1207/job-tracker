"""
gmail_sync.py — reads Gmail emails labeled 'job-tracker' and syncs to Job Tracker.

HOW IT WORKS:
  1. You create a Gmail filter that labels job-related emails 'job-tracker'
  2. This script reads ONLY those labeled emails (nothing else in your inbox)
  3. Detects status (applied / interviewing / rejected / offer) via keyword matching
  4. Extracts company from sender, role from subject line
  5. Creates new jobs or upgrades existing ones in your tracker

SETUP (one-time):
  Step 1 — Install dependencies:
    pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client requests

  Step 2 — Create Gmail filter:
    Gmail → Settings (gear) → See all settings → Filters and Blocked Addresses
    → Create a new filter
    Keywords: application received OR interview invitation OR unfortunately OR
              pleased to offer OR thank you for applying OR we received your application
    Action: Apply label 'job-tracker'  (create that label if it doesn't exist)

  Step 3 — Get Gmail API credentials:
    a) Go to console.cloud.google.com
    b) Create a new project (e.g. "Job Tracker Sync")
    c) APIs & Services → Enable APIs → search "Gmail API" → Enable
    d) APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client IDs
    e) Application type: Desktop app → Create
    f) Download JSON → rename to 'credentials.json' → place in this folder

  Step 4 — Configure your tracker credentials below (or set as env vars):
    TRACKER_EMAIL    = your job tracker login email
    TRACKER_PASSWORD = your job tracker password

  Step 5 — Run:
    python gmail_sync.py
    (First run opens a browser to authorize Gmail access → saves token.json)

USAGE:
  Run manually whenever you want:    python gmail_sync.py

  Or add to Windows Task Scheduler to run daily automatically.
"""

import os
import re
import json
import base64
import requests
from datetime import datetime
from pathlib import Path
from email.utils import parsedate_to_datetime

# ── Your configuration ────────────────────────────────────────
# You can set these here or as environment variables
TRACKER_URL      = os.getenv("TRACKER_URL",      "http://localhost:3000")
TRACKER_EMAIL    = os.getenv("TRACKER_EMAIL",    "")   # set via env var or edit directly
TRACKER_PASSWORD = os.getenv("TRACKER_PASSWORD", "")   # set via env var or edit directly

GMAIL_LABEL      = "job-tracker"          # the label you create in Gmail
PROCESSED_FILE   = Path(__file__).parent / ".processed_emails.json"
TOKEN_FILE       = Path(__file__).parent / "token.json"
CREDS_FILE       = Path(__file__).parent / "credentials.json"

# Gmail API scope — read + label emails only, no send/delete
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]


# ── Status keyword detection ──────────────────────────────────
# Order matters: offer > rejected > interviewing > applied
# More specific phrases first to avoid false positives

OFFER_KEYWORDS = [
    "pleased to offer", "offer of employment", "official offer",
    "we are excited to offer", "extend an offer", "job offer",
    "compensation package", "start date",
]

REJECTED_KEYWORDS = [
    "unfortunately", "regret to inform", "not moving forward",
    "decided to move forward with other", "position has been filled",
    "will not be moving", "not a match", "decided not to proceed",
    "other candidates were", "we have decided", "not selected",
    "we won't be", "we will not be", "no longer considering",
]

INTERVIEWING_KEYWORDS = [
    "interview", "schedule a call", "schedule a meeting",
    "next steps", "we'd like to speak", "we would like to speak",
    "phone screen", "technical screen", "video call",
    "speak with you about", "connect with you",
    "move you forward", "moving you forward",
]

APPLIED_KEYWORDS = [
    "thank you for applying", "thanks for applying",
    "we received your application", "we've received your application",
    "we have received your application", "application received",
    "application has been submitted", "successfully applied",
    "your application for", "application is under review",
    "thank you for your interest", "thanks for your interest",
    "thank you for your application", "thanks for your application",
    "application confirmation", "your recent job application",
    "your job application status", "we received your job application",
    "we have received your resume", "resume received",
    "your resume has been", "we got your application",
    "appreciate your interest", "application submitted",
]


def detect_status(text: str) -> str | None:
    t = text.lower()
    for kw in OFFER_KEYWORDS:
        if kw in t:
            return "offer"
    for kw in REJECTED_KEYWORDS:
        if kw in t:
            return "rejected"
    for kw in INTERVIEWING_KEYWORDS:
        if kw in t:
            return "interviewing"
    for kw in APPLIED_KEYWORDS:
        if kw in t:
            return "applied"
    return None


# ── Company extraction ────────────────────────────────────────

# ATS relay domains — extract company from subject instead of sender
_ATS_DOMAINS = {
    "greenhouse-mail.io", "lever.co", "workday.com", "myworkday.com",
    "mail.greenhouse.io", "notifications.greenhouse.io", "hire.lever.co",
    "taleo.net", "icims.com", "jobvite.com", "jobtarget.com",
    "eprivatemail.com", "us.greenhouse-mail.io", "smartrecruiters.com",
    "successfactors.com", "oraclecloud.com", "kenexa.com",
    "brassring.com", "recruitics.com", "jazz.co", "ashbyhq.com",
    "rippling.com", "workable.com", "bamboohr.com",
}

# Domains to completely skip — job alert/spam senders
SKIP_DOMAINS = {
    "jobtracker2gmail.com",
    "jobalerts.com",
    "jobboard.com",
}

# Generic sender names that mean nothing
_JUNK_SENDERS = {
    "us", "mail", "noreply", "no-reply", "donotreply", "do-not-reply",
    "info", "careers", "jobs", "recruiting", "hr", "team",
    "notifications", "updates", "support", "hello",
}

_STRIP_SUFFIXES = [
    " recruiting", " careers", " talent", " hr", " no reply",
    " noreply", " jobs", " notifications", " team", " hiring",
    " acquisition", " human resources",
]


def extract_company(sender: str, subject: str, body: str = "") -> str:
    # Get email domain to check if it's an ATS relay
    email_match = re.search(r'@([a-zA-Z0-9._-]+)', sender)
    sender_domain = email_match.group(1).lower() if email_match else ""
    is_ats = any(ats in sender_domain for ats in _ATS_DOMAINS)
    is_generic = any(
        sender_domain.startswith(g) or sender_domain == g + ".com"
        for g in ("gmail", "yahoo", "outlook", "hotmail", "us.", "mail.", "noreply")
    )

    # Try display name from sender: "Google Recruiting <careers@google.com>"
    if not is_ats and not is_generic:
        name_match = re.match(r'^"?([^"<@\n]{2,})"?\s*<', sender)
        if name_match:
            name = name_match.group(1).strip()
            for suffix in _STRIP_SUFFIXES:
                name = re.sub(re.escape(suffix), "", name, flags=re.IGNORECASE).strip()
            name_lower = name.lower()
            if name and len(name) > 1 and name_lower not in _JUNK_SENDERS:
                return name

        # Use domain as company: careers@google.com → Google
        if email_match:
            domain_part = sender_domain.split(".")[0]
            if domain_part not in _JUNK_SENDERS and len(domain_part) > 1:
                return domain_part.capitalize()

    _COMPANY_PATTERNS = [
        r'(?:applying to|applied to|application to|applying at|applied at|interest in)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9\s&,\.\'-]{1,50}?)(?:\s*[!,\.\-\n]|$)',
        r'(?:position|role|job)\s+at\s+([A-Za-z0-9][A-Za-z0-9\s&,\.\'-]{1,50}?)(?:\s*[!,\.\-\n]|$)',
        r'welcome to\s+([A-Za-z0-9][A-Za-z0-9\s&,\.\'-]{1,50}?)(?:\s*[!,\.\-\n]|$)',
        r'team at\s+([A-Za-z0-9][A-Za-z0-9\s&,\.\'-]{1,50}?)(?:\s*[!,\.\-\n]|$)',
        r'([A-Za-z0-9][A-Za-z0-9\s&,\.\'-]{1,50}?)\s+(?:recruiting|careers|hiring|talent)\s+team',
    ]

    _JUNK_COMPANY_PHRASES = {
        "us", "you", "our company", "our team", "our organization",
        "the team", "your team", "this role", "the role", "our role",
        "the position", "your application", "your resume", "our process",
        "joining us", "joining our", "our company", "your career",
        "our community", "our platform", "further",
    }

    # Search subject first, then body
    for text in [subject, body[:3000]]:
        for pattern in _COMPANY_PATTERNS:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                c = m.group(1).strip().rstrip("!,.")
                c_lower = c.lower()
                if (c and 2 < len(c) < 60
                        and c_lower not in _JUNK_SENDERS
                        and not any(j in c_lower for j in _JUNK_COMPANY_PHRASES)):
                    return c

    # "Cloudflare Recruiting" at start of subject
    company_in_subj = re.match(r'^([A-Z][A-Za-z0-9]+(?:\s[A-Z][A-Za-z0-9]+)?)\s+(?:Recruiting|Careers|Jobs|Hiring)', subject)
    if company_in_subj:
        return company_in_subj.group(1).strip()

    # Pipe-separated: "Marvell | Application Confirmation"
    pipe_match = re.match(r'^([A-Z][A-Za-z0-9\s&]+?)\s*[|\-–]', subject)
    if pipe_match:
        c = pipe_match.group(1).strip()
        if len(c) > 1:
            return c

    # Last resort: "at Visa" / "at Google" anywhere in subject or body
    for text in [subject, body[:500]]:
        m = re.search(r'\bat\s+([A-Z][A-Za-z0-9&]+(?:\s[A-Z][A-Za-z0-9&]+)?)', text)
        if m:
            c = m.group(1).strip()
            if c and c.lower() not in _JUNK_SENDERS and len(c) > 1:
                return c

    return "Unknown Company"


# ── Role extraction ───────────────────────────────────────────

def extract_role(subject: str, body: str = "") -> str:
    patterns = [
        r'(?:application|applied)\s+(?:to|for)\s+(?:the\s+)?(.+?)(?:\s+at\s|\s+position|\s+role|\s*[,\n]|$)',
        r'interview\s+(?:invitation\s+)?for\s+(?:the\s+)?(.+?)(?:\s+(?:position|role|at)\s|\s*[,\n]|$)',
        r'(?:position|role|job)\s*[:\-]\s*(.+?)(?:\s+at\s|\s*[,\n]|$)',
        r'applying\s+(?:to|for)\s+(?:the\s+)?(.+?)(?:\s+at\s|\s+position|\s*[,\n]|$)',
        r'(?:opening|opportunity)\s+(?:for\s+)?(?:the\s+)?(.+?)(?:\s+at\s|\s*[,\n]|$)',
    ]
    # Search subject first, then body
    for text in [subject, body[:2000]]:
        for pattern in patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                role = m.group(1).strip().rstrip(".,!")
                if 3 < len(role) < 100:
                    return role
    # Fallback: cleaned subject
    return re.sub(r'^(?:re:|fw:|fwd:)\s*', '', subject, flags=re.IGNORECASE).strip()[:80]


# ── Email body extraction ─────────────────────────────────────

def get_body(payload: dict) -> str:
    """Recursively extract plain text from Gmail message payload."""
    text = ""
    mime = payload.get("mimeType", "")
    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            text += base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
    elif mime.startswith("multipart"):
        for part in payload.get("parts", []):
            text += get_body(part)
            if text:  # stop at first substantial text chunk
                break
    return text


# ── Processed email tracking ──────────────────────────────────

def load_processed() -> set:
    if PROCESSED_FILE.exists():
        try:
            return set(json.loads(PROCESSED_FILE.read_text()))
        except Exception:
            return set()
    return set()


def save_processed(ids: set):
    PROCESSED_FILE.write_text(json.dumps(list(ids), indent=2))


# ── Gmail authentication ──────────────────────────────────────

def get_gmail_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    if not CREDS_FILE.exists():
        print("\nERROR: credentials.json not found in this folder.")
        print("Follow Step 3 in the setup instructions at the top of this file.\n")
        raise SystemExit(1)

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())

    return build("gmail", "v1", credentials=creds)


# ── Job Tracker API helpers ───────────────────────────────────

def tracker_login() -> str:
    if not TRACKER_EMAIL or not TRACKER_PASSWORD:
        print("\nERROR: TRACKER_EMAIL and TRACKER_PASSWORD are not set.")
        print("Edit gmail_sync.py and fill them in, or set as environment variables.\n")
        raise SystemExit(1)
    resp = requests.post(
        f"{TRACKER_URL}/api/auth/login",
        data={"username": TRACKER_EMAIL, "password": TRACKER_PASSWORD},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def get_jobs(token: str) -> list:
    resp = requests.get(
        f"{TRACKER_URL}/api/jobs",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def create_job(token: str, company: str, role: str, status: str,
               applied_date: str, notes: str = "") -> dict:
    resp = requests.post(
        f"{TRACKER_URL}/api/jobs",
        json={"company": company, "role": role, "status": status,
              "applied_date": applied_date, "notes": notes},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def update_status(token: str, job_id: str, status: str) -> dict:
    resp = requests.patch(
        f"{TRACKER_URL}/api/jobs/{job_id}/status",
        json={"status": status},
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ── Main sync ─────────────────────────────────────────────────

# Status rank — higher rank wins when updating
STATUS_RANK = {"applied": 1, "interviewing": 2, "offer": 4, "rejected": 3}


def sync():
    print("=" * 45)
    print("  Job Tracker Gmail Sync")
    print("=" * 45)

    service    = get_gmail_service()
    token      = tracker_login()
    jobs       = get_jobs(token)

    # Clean up bad company names from previous run
    BAD_NAMES = {
        "unknown company", "us", "mail", "eprivatemail", "jobtarget",
        "myworkday", "workday", "8am", "mahathi marepalli", "weldon rice",
        "mahathi", "noreply", "no-reply",
    }
    deleted = 0
    for j in jobs:
        if j.get("company", "").lower() in BAD_NAMES:
            try:
                requests.delete(
                    f"{TRACKER_URL}/api/jobs/{j['id']}",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=10,
                )
                deleted += 1
            except Exception:
                pass
    if deleted:
        print(f"Cleaned up {deleted} bad entries from previous run")
        jobs = get_jobs(token)

    # Reset processed list so all emails get re-evaluated with improved logic
    if PROCESSED_FILE.exists():
        PROCESSED_FILE.unlink()
    processed  = load_processed()

    # Resolve label ID
    all_labels = service.users().labels().list(userId="me").execute().get("labels", [])
    label_map  = {l["name"].lower(): l["id"] for l in all_labels}

    if GMAIL_LABEL.lower() not in label_map:
        print(f"\nLabel '{GMAIL_LABEL}' not found in Gmail.")
        print("Create it: Gmail → Settings → Labels → New label → 'job-tracker'")
        print("Then set up a filter to apply it (see setup instructions).\n")
        return

    label_id = label_map[GMAIL_LABEL.lower()]

    # Fetch all emails with the label
    result   = service.users().messages().list(
        userId="me", labelIds=[label_id], maxResults=200
    ).execute()
    messages = result.get("messages", [])

    print(f"\nEmails with label '{GMAIL_LABEL}': {len(messages)}")
    new_count = updated_count = skipped_count = 0

    for ref in messages:
        msg_id = ref["id"]

        if msg_id in processed:
            skipped_count += 1
            continue

        msg     = service.users().messages().get(userId="me", id=msg_id, format="full").execute()
        headers = {h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])}
        sender  = headers.get("from", "")
        subject = headers.get("subject", "No Subject")
        date_h  = headers.get("date", "")

        # Skip emails from unwanted senders
        if any(domain in sender.lower() for domain in SKIP_DOMAINS):
            processed.add(msg_id)
            skipped_count += 1
            continue

        body        = get_body(msg["payload"])
        search_text = subject + " " + body[:1500]

        status = detect_status(search_text)
        if not status:
            print(f"  ? No status detected — {subject[:60]}")
            processed.add(msg_id)
            skipped_count += 1
            continue

        company = extract_company(sender, subject, body)
        role    = extract_role(subject, body)

        try:
            applied_date = parsedate_to_datetime(date_h).strftime("%Y-%m-%d")
        except Exception:
            applied_date = datetime.today().strftime("%Y-%m-%d")

        # Build a note with the email details for verification
        body_snippet = body.strip()[:600].replace('\r', '').strip()
        note = (
            f"📧 Auto-synced from email\n"
            f"From: {sender}\n"
            f"Subject: {subject}\n"
            f"Date: {applied_date}\n"
            f"{'─' * 30}\n"
            f"{body_snippet}"
        )

        # Match against existing jobs by company name (fuzzy)
        existing = next(
            (j for j in jobs if (
                company.lower() in j.get("company", "").lower() or
                j.get("company", "").lower() in company.lower()
            ) and company.lower() not in ("unknown company",)),
            None,
        )

        if existing:
            current_rank = STATUS_RANK.get(existing["status"], 0)
            new_rank     = STATUS_RANK.get(status, 0)
            if new_rank > current_rank:
                update_status(token, existing["id"], status)
                jobs = get_jobs(token)  # refresh list
                print(f"  ↑ Updated  | {company} — {existing['status']} → {status}")
                updated_count += 1
            else:
                print(f"  ~ No change| {company} already at '{existing['status']}'")
                skipped_count += 1
        else:
            created = create_job(token, company, role, status, applied_date, note)
            jobs.append(created)
            print(f"  + Created  | {company} | {role[:40]} | {status}")
            new_count += 1

        processed.add(msg_id)

    save_processed(processed)

    print(f"\n{'─' * 45}")
    print(f"  Created: {new_count}  Updated: {updated_count}  Skipped: {skipped_count}")
    print(f"{'─' * 45}\n")


if __name__ == "__main__":
    sync()
