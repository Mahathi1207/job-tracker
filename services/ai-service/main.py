"""
AI Service — calls the Anthropic Claude API to generate resume tips, interview prep,
cover letters, and full resume-vs-JD analysis with match scoring.
"""
import os
import io
import hashlib
import json
from typing import Optional, List
from contextlib import asynccontextmanager

import pypdf
import httpx
from datetime import date
from fastapi import File, Form, UploadFile, Query

from groq import Groq
import redis.asyncio as aioredis
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID", "")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY", "")
CACHE_TTL = 3600  # 1 hour in seconds

# llama-3.3-70b-versatile — best free model on Groq for structured JSON output
MODEL = "llama-3.3-70b-versatile"

# Synchronous Groq client (FastAPI runs sync handlers in a thread pool)
ai_client = Groq(api_key=GROQ_API_KEY)

# Async Redis client — shared across requests via app state
redis_client: Optional[aioredis.Redis] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)
    yield
    await redis_client.aclose()


# ── Pydantic schemas (v2) ─────────────────────────────────────
class AIRequest(BaseModel):
    job_description: str
    user_context: Optional[str] = ""


class TipsResponse(BaseModel):
    tips: List[str]
    cached: bool = False


class InterviewPrepResponse(BaseModel):
    questions: List[str]
    tips: List[str]
    cached: bool = False


class CoverLetterResponse(BaseModel):
    cover_letter: str
    key_points: List[str]
    cached: bool = False


# ── Cache helpers ─────────────────────────────────────────────
def make_cache_key(route: str, job_description: str, user_context: str) -> str:
    """Deterministic cache key: SHA-256 of route + inputs."""
    raw = f"{route}:{job_description}:{user_context}"
    return hashlib.sha256(raw.encode()).hexdigest()


async def get_cached(key: str) -> Optional[dict]:
    if redis_client:
        value = await redis_client.get(key)
        if value:
            return json.loads(value)
    return None


async def set_cached(key: str, data: dict):
    if redis_client:
        await redis_client.setex(key, CACHE_TTL, json.dumps(data))


def call_claude(prompt: str, max_tokens: int = 1024) -> str:
    """Calls Groq synchronously and returns the raw text response."""
    response = ai_client.chat.completions.create(
        model=MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


def parse_json_response(text: str) -> dict:
    """
    Attempts to parse the model's response as JSON.
    Strips markdown code fences that the model sometimes adds.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Remove ```json ... ``` wrapper
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return json.loads(cleaned)


# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="AI Service",
    description="Generates resume tips, interview prep, and cover letters via Claude API.",
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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service"}


@app.post("/ai/resume-tips", response_model=TipsResponse)
async def resume_tips(req: AIRequest):
    cache_key = make_cache_key("resume-tips", req.job_description, req.user_context or "")

    if cached := await get_cached(cache_key):
        return TipsResponse(**cached, cached=True)

    prompt = f"""You are an expert resume coach. Analyze this job description and provide specific, actionable resume improvement tips.

Job Description:
{req.job_description}

Applicant Context:
{req.user_context or "General software engineering applicant"}

Provide exactly 7 specific, actionable resume tips tailored to this role. Focus on: keywords to include, skills to highlight, how to quantify achievements, and gaps to address.

Respond ONLY with a valid JSON object — no markdown, no explanation:
{{"tips": ["tip 1", "tip 2", "tip 3", "tip 4", "tip 5", "tip 6", "tip 7"]}}"""

    try:
        text = call_claude(prompt)
        data = parse_json_response(text)
        result = {"tips": data["tips"][:7]}
        await set_cached(cache_key, result)
        return TipsResponse(**result)
    except (json.JSONDecodeError, KeyError):
        # Fallback: treat each non-empty line as a tip
        tips = [line.lstrip("•-*0123456789. ").strip() for line in text.split("\n") if line.strip()]
        result = {"tips": tips[:7]}
        await set_cached(cache_key, result)
        return TipsResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI API error: {str(e)}")


@app.post("/ai/interview-prep", response_model=InterviewPrepResponse)
async def interview_prep(req: AIRequest):
    cache_key = make_cache_key("interview-prep", req.job_description, req.user_context or "")

    if cached := await get_cached(cache_key):
        return InterviewPrepResponse(**cached, cached=True)

    prompt = f"""You are an expert interview coach. Based on this job description, prepare the candidate.

Job Description:
{req.job_description}

Applicant Context:
{req.user_context or "General software engineering applicant"}

Respond ONLY with a valid JSON object — no markdown, no explanation:
{{
  "questions": ["most likely interview question 1", "question 2", "question 3", "question 4", "question 5"],
  "tips": ["interview preparation tip 1", "tip 2", "tip 3", "tip 4", "tip 5"]
}}"""

    try:
        text = call_claude(prompt)
        data = parse_json_response(text)
        result = {"questions": data["questions"][:5], "tips": data["tips"][:5]}
        await set_cached(cache_key, result)
        return InterviewPrepResponse(**result)
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(status_code=500, detail="Failed to parse AI response. Please retry.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI API error: {str(e)}")


@app.post("/ai/cover-letter", response_model=CoverLetterResponse)
async def cover_letter(req: AIRequest):
    cache_key = make_cache_key("cover-letter", req.job_description, req.user_context or "")

    if cached := await get_cached(cache_key):
        return CoverLetterResponse(**cached, cached=True)

    prompt = f"""You are an expert career counselor. Write a compelling, personalized cover letter.

Job Description:
{req.job_description}

Applicant Context:
{req.user_context or "Experienced software engineer seeking a new opportunity"}

Write a professional 3-paragraph cover letter and extract 3 key selling points.

Respond ONLY with a valid JSON object — no markdown, no explanation:
{{
  "cover_letter": "Full cover letter text here (3 paragraphs)...",
  "key_points": ["key selling point 1", "key selling point 2", "key selling point 3"]
}}"""

    try:
        text = call_claude(prompt, max_tokens=2048)
        data = parse_json_response(text)
        result = {"cover_letter": data["cover_letter"], "key_points": data["key_points"][:3]}
        await set_cached(cache_key, result)
        return CoverLetterResponse(**result)
    except (json.JSONDecodeError, KeyError):
        raise HTTPException(status_code=500, detail="Failed to parse AI response. Please retry.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI API error: {str(e)}")


# ── Resume Analysis ───────────────────────────────────────────

class ResumeAnalysisResponse(BaseModel):
    match_percentage: int                # 0-100
    missing_keywords: List[str]          # keywords in JD but not in resume
    present_keywords: List[str]          # strong keywords already in resume
    selection_probability: str           # "High" | "Medium" | "Low"
    probability_reasoning: str           # one-sentence explanation
    interview_topics: List[str]          # likely topics based on JD
    strengths: List[str]                 # what the resume does well for this role
    improvements: List[str]             # specific things to add/change
    overall_assessment: str             # 2-3 sentence summary
    cached: bool = False


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Pull plain text from every page of a PDF using pypdf."""
    reader = pypdf.PdfReader(io.BytesIO(file_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


@app.post("/ai/analyze-resume", response_model=ResumeAnalysisResponse)
async def analyze_resume(
    job_description: str = Form(...),
    resume_text: str = Form(""),
    resume_file: Optional[UploadFile] = File(None),
):
    """
    Accepts a resume (PDF upload or raw text) + a job description.
    Returns a comprehensive match analysis: score, missing keywords,
    selection probability, interview topics, and actionable improvements.
    Responses are cached in Redis for 1 hour by (resume, JD) hash.
    """
    # Extract text from uploaded PDF if provided
    if resume_file:
        content = await resume_file.read()
        try:
            resume_text = extract_text_from_pdf(content)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if not resume_text or len(resume_text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="Resume text is too short. Upload a PDF or paste your resume text.",
        )

    cache_key = make_cache_key("analyze-resume", job_description, resume_text)
    if cached := await get_cached(cache_key):
        return ResumeAnalysisResponse(**cached, cached=True)

    prompt = f"""You are an expert ATS (Applicant Tracking System) and senior technical recruiter.
Analyse the candidate's resume against the job description and return a detailed evaluation.

JOB DESCRIPTION:
{job_description}

CANDIDATE RESUME:
{resume_text}

Evaluate thoroughly and respond ONLY with a valid JSON object — no markdown, no explanation:
{{
  "match_percentage": <integer 0-100, how well the resume matches the JD>,
  "missing_keywords": ["keyword1", "keyword2", ...],
  "present_keywords": ["keyword1", "keyword2", ...],
  "selection_probability": "<High|Medium|Low>",
  "probability_reasoning": "<one sentence explaining the probability>",
  "interview_topics": ["topic1", "topic2", "topic3", "topic4", "topic5"],
  "strengths": ["strength1", "strength2", "strength3"],
  "improvements": ["specific improvement 1", "specific improvement 2", "specific improvement 3", "specific improvement 4"],
  "overall_assessment": "<2-3 sentence honest assessment of this resume for this specific role>"
}}

Scoring guide:
- match_percentage: count matching skills/keywords/experience as a % of what the JD requires
- missing_keywords: technical skills, tools, or qualifications in the JD that are absent from the resume
- present_keywords: strong relevant skills already visible in the resume
- selection_probability: High (>70% match), Medium (40-70%), Low (<40%)
- interview_topics: what topics the interviewer will focus on given this JD"""

    try:
        text = call_claude(prompt, max_tokens=2048)
        data = parse_json_response(text)
        result = {
            "match_percentage": int(data["match_percentage"]),
            "missing_keywords": data["missing_keywords"],
            "present_keywords": data["present_keywords"],
            "selection_probability": data["selection_probability"],
            "probability_reasoning": data["probability_reasoning"],
            "interview_topics": data["interview_topics"],
            "strengths": data["strengths"],
            "improvements": data["improvements"],
            "overall_assessment": data["overall_assessment"],
        }
        await set_cached(cache_key, result)
        return ResumeAnalysisResponse(**result)
    except (json.JSONDecodeError, KeyError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {e}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI API error: {str(e)}")


# ── Job Suggestions ───────────────────────────────────────────

@app.get("/ai/job-suggestions")
async def job_suggestions(
    keywords: str = Query(..., description="Search terms derived from resume, e.g. 'React frontend engineer'"),
    country: str = Query("us"),
):
    """
    Returns up to 15 job openings posted today matching the given keywords.
    Uses Adzuna API if configured (ADZUNA_APP_ID + ADZUNA_APP_KEY env vars),
    otherwise falls back to Remotive (free, no key, remote jobs only).
    Results are cached in Redis for the rest of the calendar day.
    """
    today = date.today().isoformat()
    cache_key = f"suggestions:{country}:{hashlib.sha256(f'{keywords}:{today}'.encode()).hexdigest()}"

    if cached := await get_cached(cache_key):
        return {"jobs": cached["jobs"], "cached": True, "source": cached.get("source", "cache")}

    jobs = []
    source = "none"

    if ADZUNA_APP_ID and ADZUNA_APP_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"https://api.adzuna.com/v1/api/jobs/{country}/search/1",
                    params={
                        "app_id": ADZUNA_APP_ID,
                        "app_key": ADZUNA_APP_KEY,
                        "results_per_page": 15,
                        "what": keywords,
                        "max_days_old": 1,
                        "sort_by": "date",
                    },
                )
                data = resp.json()
            jobs = [
                {
                    "title": r.get("title", ""),
                    "company": r.get("company", {}).get("display_name", ""),
                    "location": r.get("location", {}).get("display_name", ""),
                    "redirect_url": r.get("redirect_url", ""),
                    "salary_min": r.get("salary_min"),
                    "salary_max": r.get("salary_max"),
                }
                for r in data.get("results", [])
            ]
            source = "adzuna"
        except Exception as e:
            print(f"[Adzuna] Error: {e}")

    # Fallback: Remotive (free, no auth, remote jobs)
    if not jobs:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://remotive.com/api/remote-jobs",
                    params={"search": keywords, "limit": 15},
                )
                data = resp.json()
            jobs = [
                {
                    "title": r.get("title", ""),
                    "company": r.get("company_name", ""),
                    "location": r.get("candidate_required_location", "Remote"),
                    "redirect_url": r.get("url", ""),
                    "salary_min": None,
                    "salary_max": None,
                }
                for r in data.get("jobs", [])[:15]
            ]
            source = "remotive"
        except Exception as e:
            print(f"[Remotive] Error: {e}")

    result = {"jobs": jobs, "source": source}
    await set_cached(cache_key, result)
    return {"jobs": jobs, "cached": False, "source": source}
