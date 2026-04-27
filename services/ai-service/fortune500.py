"""
Fortune 500 job scraper — queries public ATS APIs directly.

Supports three ATS platforms:
  • Greenhouse  — boards-api.greenhouse.io (no auth, fully public)
  • Lever       — api.lever.co/v0/postings (no auth, fully public)
  • Workday     — company.wd{n}.myworkdayjobs.com REST API (public job search)

Each company entry lists which ATS it uses and the identifiers needed.
All fetches run concurrently via asyncio.gather so the total wait is
bounded by the slowest single company, not the sum of all.
"""

import asyncio
import random
from typing import List

import httpx

# ── Company registry ──────────────────────────────────────────
# Add / remove companies freely.  Wrong identifiers just produce
# empty results (all fetch functions catch every exception).

COMPANIES = [
    # ── Greenhouse ────────────────────────────────────────────
    {"name": "Airbnb",       "ats": "greenhouse", "board": "airbnb"},
    {"name": "Stripe",       "ats": "greenhouse", "board": "stripe"},
    {"name": "Coinbase",     "ats": "greenhouse", "board": "coinbase"},
    {"name": "DoorDash",     "ats": "greenhouse", "board": "doordash"},
    {"name": "Reddit",       "ats": "greenhouse", "board": "reddit"},
    {"name": "Figma",        "ats": "greenhouse", "board": "figma"},
    {"name": "Notion",       "ats": "greenhouse", "board": "notion"},
    {"name": "Twilio",       "ats": "greenhouse", "board": "twilio"},
    {"name": "Datadog",      "ats": "greenhouse", "board": "datadog"},
    {"name": "MongoDB",      "ats": "greenhouse", "board": "mongodb"},
    {"name": "Cloudflare",   "ats": "greenhouse", "board": "cloudflare"},
    {"name": "HubSpot",      "ats": "greenhouse", "board": "hubspot"},
    {"name": "Zendesk",      "ats": "greenhouse", "board": "zendesk"},
    {"name": "Robinhood",    "ats": "greenhouse", "board": "robinhood"},
    {"name": "Plaid",        "ats": "greenhouse", "board": "plaid"},
    {"name": "Brex",         "ats": "greenhouse", "board": "brex"},
    {"name": "Ramp",         "ats": "greenhouse", "board": "ramp"},
    {"name": "PagerDuty",    "ats": "greenhouse", "board": "pagerduty"},
    {"name": "HashiCorp",    "ats": "greenhouse", "board": "hashicorp"},
    {"name": "Elastic",      "ats": "greenhouse", "board": "elastic"},
    {"name": "Okta",         "ats": "greenhouse", "board": "okta"},
    {"name": "Snowflake",    "ats": "greenhouse", "board": "snowflake"},
    {"name": "Databricks",   "ats": "greenhouse", "board": "databricks"},
    {"name": "Airtable",     "ats": "greenhouse", "board": "airtable"},
    {"name": "Asana",        "ats": "greenhouse", "board": "asana"},
    {"name": "Chime",        "ats": "greenhouse", "board": "chime"},
    {"name": "Rippling",     "ats": "greenhouse", "board": "rippling"},
    {"name": "OpenAI",       "ats": "greenhouse", "board": "openai"},
    {"name": "Anthropic",    "ats": "greenhouse", "board": "anthropic"},
    {"name": "Scale AI",     "ats": "greenhouse", "board": "scaleai"},
    {"name": "Instacart",    "ats": "greenhouse", "board": "instacart"},
    {"name": "Klaviyo",      "ats": "greenhouse", "board": "klaviyo"},
    {"name": "Amplitude",    "ats": "greenhouse", "board": "amplitude"},
    {"name": "Mixpanel",     "ats": "greenhouse", "board": "mixpanel"},
    {"name": "Segment",      "ats": "greenhouse", "board": "segment"},
    {"name": "Intercom",     "ats": "greenhouse", "board": "intercom"},
    {"name": "Gusto",        "ats": "greenhouse", "board": "gusto"},
    {"name": "Checkr",       "ats": "greenhouse", "board": "checkr"},
    {"name": "Gemini",       "ats": "greenhouse", "board": "gemini"},

    # ── Lever ─────────────────────────────────────────────────
    {"name": "Netflix",      "ats": "lever", "site": "netflix"},
    {"name": "Lyft",         "ats": "lever", "site": "lyft"},
    {"name": "Box",          "ats": "lever", "site": "box"},
    {"name": "Twitch",       "ats": "lever", "site": "twitch"},
    {"name": "Snap",         "ats": "lever", "site": "snap"},
    {"name": "Affirm",       "ats": "lever", "site": "affirm"},
    {"name": "Benchling",    "ats": "lever", "site": "benchling"},
    {"name": "Figma",        "ats": "lever", "site": "figma"},

    # ── Workday ───────────────────────────────────────────────
    # Format: subdomain.wd{num}.myworkdayjobs.com + career site path
    {
        "name": "Microsoft", "ats": "workday",
        "subdomain": "microsoft", "num": "5",
        "path": "Microsoft_External_Careers",
    },
    {
        "name": "Salesforce", "ats": "workday",
        "subdomain": "salesforce", "num": "12",
        "path": "External_Career_Site",
    },
    {
        "name": "Nike", "ats": "workday",
        "subdomain": "nike", "num": "1",
        "path": "External_NIKE",
    },
    {
        "name": "Adobe", "ats": "workday",
        "subdomain": "adobe", "num": "5",
        "path": "external_experienced",
    },
    {
        "name": "Walmart", "ats": "workday",
        "subdomain": "walmart", "num": "5",
        "path": "Walmart_External",
    },
    {
        "name": "Target", "ats": "workday",
        "subdomain": "target", "num": "5",
        "path": "Target",
    },
    {
        "name": "IBM", "ats": "workday",
        "subdomain": "ibm", "num": "3",
        "path": "External",
    },
]

# ── Common browser-like headers (reduces bot-blocking) ────────
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}


# ── Per-ATS fetch functions ───────────────────────────────────

async def _fetch_greenhouse(
    client: httpx.AsyncClient, company: dict, keywords: List[str]
) -> List[dict]:
    try:
        resp = await client.get(
            f"https://boards-api.greenhouse.io/v1/boards/{company['board']}/jobs",
            params={"content": "false"},
            headers=HEADERS,
            timeout=8,
        )
        jobs = []
        for j in resp.json().get("jobs", []):
            title    = j.get("title", "")
            location = j.get("location", {}).get("name", "")
            if _matches(title, keywords) and _is_us(location):
                jobs.append({
                    "title": title,
                    "company": company["name"],
                    "location": location,
                    "url": j.get("absolute_url", ""),
                    "source": "greenhouse",
                })
        return jobs
    except Exception:
        return []


async def _fetch_lever(
    client: httpx.AsyncClient, company: dict, keywords: List[str]
) -> List[dict]:
    try:
        resp = await client.get(
            f"https://api.lever.co/v0/postings/{company['site']}",
            params={"mode": "json", "limit": 50},
            headers=HEADERS,
            timeout=8,
        )
        jobs = []
        for j in resp.json():
            title    = j.get("text", "")
            cats     = j.get("categories", {})
            location = cats.get("location", "") or (cats.get("allLocations", [""])[0] if cats.get("allLocations") else "")
            if _matches(title, keywords) and _is_us(location):
                jobs.append({
                    "title": title,
                    "company": company["name"],
                    "location": location,
                    "url": j.get("hostedUrl", ""),
                    "source": "lever",
                })
        return jobs
    except Exception:
        return []


async def _fetch_workday(
    client: httpx.AsyncClient, company: dict, keywords: List[str]
) -> List[dict]:
    subdomain = company["subdomain"]
    num       = company["num"]
    path      = company["path"]
    url = (
        f"https://{subdomain}.wd{num}.myworkdayjobs.com"
        f"/wday/cxs/{subdomain}/{path}/jobs"
    )
    try:
        resp = await client.post(
            url,
            json={
                "limit": 20,
                "offset": 0,
                "searchText": " ".join(keywords[:3]),
                "appliedFacets": {},
            },
            headers={**HEADERS, "Content-Type": "application/json"},
            timeout=8,
        )
        jobs = []
        for j in resp.json().get("jobPostings", []):
            title    = j.get("title", "")
            location = j.get("locationsText", "")
            if _matches(title, keywords) and _is_us(location):
                ext = j.get("externalPath", "")
                jobs.append({
                    "title": title,
                    "company": company["name"],
                    "location": location,
                    "url": (
                        f"https://{subdomain}.wd{num}.myworkdayjobs.com"
                        f"/en-US/{path}{ext}"
                    ),
                    "source": "workday",
                })
        return jobs
    except Exception:
        return []


# ── US location filter ────────────────────────────────────────

_NON_US_SIGNALS = {
    "canada", "alberta", "british columbia", "ontario", "quebec", "manitoba",
    "saskatchewan", "nova scotia", "new brunswick", "newfoundland",
    "calgary", "toronto", "vancouver", "montreal", "ottawa", "edmonton",
    "winnipeg", "halifax",
    "united kingdom", " uk ", "london", "england", "scotland",
    "india", "bangalore", "bengaluru", "mumbai", "delhi", "hyderabad", "pune",
    "germany", "berlin", "munich", "france", "paris",
    "australia", "sydney", "melbourne", "singapore", "japan", "tokyo",
    "brazil", "são paulo", "netherlands", "amsterdam", "ireland", "dublin",
    "poland", "warsaw", "sweden", "stockholm", "israel", "tel aviv",
    "mexico", "new zealand",
}

_US_SIGNALS = {
    "united states", "usa", "u.s.a", " us,", " us ", "- us", "us only",
    "california", "new york", "texas", "washington", "illinois",
    "georgia", "florida", "massachusetts", "colorado", "virginia",
    "north carolina", "ohio", "oregon", "michigan", "minnesota",
    "arizona", "utah", "nevada", "maryland", "connecticut",
    "new jersey", "pennsylvania", "indiana", "tennessee", "missouri",
    "wisconsin", "alabama", "louisiana", "kentucky", "iowa",
    "san francisco", "los angeles", "seattle", "chicago", "austin",
    "boston", "denver", "atlanta", "miami", "portland", "new york city",
    "nyc", "san jose", "san diego", "dallas", "houston", "phoenix",
    "minneapolis", "detroit", "raleigh", "salt lake city", "charlotte",
    ", ca", ", ny", ", tx", ", wa", ", ma", ", co", ", ga", ", il",
    ", fl", ", co", ", va", ", nc", ", oh", ", or", ", mi", ", mn",
}

def _is_us(location: str) -> bool:
    """Return True only if the location is in the US or unspecified."""
    if not location or location.strip() == "":
        return True
    loc = location.lower()
    # Explicitly reject known non-US locations first
    if any(sig in loc for sig in _NON_US_SIGNALS):
        return False
    # Accept if a US signal is present
    if any(sig in loc for sig in _US_SIGNALS):
        return True
    # "Remote" with no country specified — accept
    if "remote" in loc:
        return True
    # Unknown location — accept by default
    return True


# ── Keyword matching ──────────────────────────────────────────

_SENIOR_TERMS = {
    "senior", "sr.", "staff", "principal", "lead", "manager", "director",
    "head of", "vp", "vice president", "distinguished", "architect",
    "engineering manager", "tech lead",
}

_JUNIOR_TERMS = {
    "junior", "jr.", "entry", "associate", "new grad", "new-grad",
    "early career", "graduate", "intern", "internship", "apprentice",
}

_MID_TERMS = {"mid", "mid-level", "midlevel", "ii", "iii", "iv"}


def _matches(title: str, keywords: List[str]) -> bool:
    """
    Relevance filter that respects seniority level.
    - If searching 'junior', exclude senior/staff/principal titles.
    - If searching 'senior', exclude junior titles.
    - Always require at least one core role word (non-level) to match.
    """
    t = title.lower()

    kw_str = " ".join(keywords)
    wants_junior = any(jt in kw_str for jt in _JUNIOR_TERMS)
    wants_senior = any(st in kw_str for st in _SENIOR_TERMS)

    # Level exclusions
    if wants_junior and any(st in t for st in _SENIOR_TERMS):
        return False
    if wants_senior and any(jt in t for jt in _JUNIOR_TERMS):
        return False

    # Generic words that alone are not enough to call a match
    _GENERIC = {
        "engineer", "engineering", "developer", "software", "technical",
        "technology", "tech", "system", "systems", "specialist", "analyst",
        "associate", "consultant", "professional",
    }

    level_words = _SENIOR_TERMS | _JUNIOR_TERMS | _MID_TERMS
    core_kws = [kw for kw in keywords if kw not in level_words and len(kw) >= 3]

    if not core_kws:
        return False

    # Specific keywords (non-generic) — ALL of these must match the title
    specific_kws = [kw for kw in core_kws if kw not in _GENERIC]
    generic_kws  = [kw for kw in core_kws if kw in _GENERIC]

    if specific_kws:
        # Every specific keyword must appear in the title
        if not all(kw in t for kw in specific_kws):
            return False
    else:
        # Search is all-generic (e.g. "software engineer") — require all to match
        if not all(kw in t for kw in generic_kws):
            return False

    return True


def _extract_keywords(keywords_str: str) -> List[str]:
    """Split keyword string into individual meaningful words."""
    return [w.lower() for w in keywords_str.replace(",", " ").split() if len(w) >= 3]


# ── Public entry point ────────────────────────────────────────

async def search_fortune500(keywords_str: str, max_results: int = 50) -> List[dict]:
    """
    Query all registered companies concurrently and return up to
    max_results jobs whose titles match the given keywords string.
    """
    keywords = _extract_keywords(keywords_str)
    if not keywords:
        return []

    async with httpx.AsyncClient() as client:
        tasks = []
        for company in COMPANIES:
            ats = company["ats"]
            if ats == "greenhouse":
                tasks.append(_fetch_greenhouse(client, company, keywords))
            elif ats == "lever":
                tasks.append(_fetch_lever(client, company, keywords))
            elif ats == "workday":
                tasks.append(_fetch_workday(client, company, keywords))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_jobs: List[dict] = []
    for r in results:
        if isinstance(r, list):
            all_jobs.extend(r)

    # Shuffle so results mix companies instead of clustering by ATS
    random.shuffle(all_jobs)
    return all_jobs[:max_results]
