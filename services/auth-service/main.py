"""
Auth Service — handles user registration, login, JWT issuance, token verification,
and logout via Redis-backed token blacklisting.
"""
import uuid
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis as redis_sync
from fastapi import FastAPI, Depends, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import Column, String, Boolean, DateTime, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Session
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from dotenv import load_dotenv

from database import engine, Base, SessionLocal, get_db

load_dotenv()

# ── Config ────────────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET", "supersecretkey123")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")

# ── Demo seed credentials (created on startup if DB is empty) ─
DEMO_USER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
DEMO_EMAIL = "demo@jobtracker.com"
DEMO_PASSWORD = "demo1234"
DEMO_NAME = "Demo User"

# ── Security helpers ──────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# ── Redis client (synchronous — used in sync route handlers) ──
r = redis_sync.from_url(REDIS_URL, decode_responses=True)

# ── SQLAlchemy model ──────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))


# Create the users table if it doesn't already exist (init.sql may have created it)
Base.metadata.create_all(bind=engine)

# ── Pydantic schemas (v2) ─────────────────────────────────────
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: Optional[str]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenVerifyResponse(BaseModel):
    valid: bool
    user_id: Optional[str] = None
    email: Optional[str] = None


# ── JWT helpers ───────────────────────────────────────────────
def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def is_token_blacklisted(token: str) -> bool:
    """Check Redis to see if this token was explicitly revoked at logout."""
    try:
        return r.get(f"blacklist:{token}") is not None
    except Exception:
        return False  # If Redis is down, allow the request rather than locking everyone out


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if is_token_blacklisted(token):
        raise HTTPException(status_code=401, detail="Token has been revoked")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.query(User).filter(User.id == uuid.UUID(user_id)).first()
    if user is None or not user.is_active:
        raise credentials_exception
    return user


# ── FastAPI app ───────────────────────────────────────────────
app = FastAPI(
    title="Auth Service",
    description="Handles user registration, login, JWT issuance, and token verification.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def seed_demo_user():
    """
    Create the demo user on first startup, or fix the placeholder hash that
    init.sql inserts before auth-service has run for the first time.
    """
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == DEMO_EMAIL).first()
        if not existing:
            demo = User(
                id=uuid.UUID(DEMO_USER_ID),
                email=DEMO_EMAIL,
                hashed_password=pwd_context.hash(DEMO_PASSWORD),
                full_name=DEMO_NAME,
            )
            db.add(demo)
            db.commit()
            print(f"[Auth] Demo user created — email: {DEMO_EMAIL}, password: {DEMO_PASSWORD}")
        elif not existing.hashed_password.startswith("$2b$"):
            # init.sql inserted a placeholder — replace it with a real bcrypt hash
            existing.hashed_password = pwd_context.hash(DEMO_PASSWORD)
            db.commit()
            print(f"[Auth] Demo user hash updated — email: {DEMO_EMAIL}, password: {DEMO_PASSWORD}")
    except Exception as e:
        print(f"[Auth] Could not seed demo user: {e}")
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth-service"}


@app.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(user_in: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == user_in.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=user_in.email,
        hashed_password=pwd_context.hash(user_in.password),
        full_name=user_in.full_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    token = create_access_token({"sub": str(user.id), "email": user.email})
    return {"access_token": token, "token_type": "bearer"}


@app.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@app.post("/auth/logout")
async def logout(token: str = Depends(oauth2_scheme)):
    """Blacklist the JWT in Redis so it cannot be reused after logout."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        exp = payload.get("exp", 0)
        # Only store in Redis until the token naturally expires to keep the blacklist lean
        ttl = max(0, int(exp - datetime.now(timezone.utc).timestamp()))
        r.setex(f"blacklist:{token}", ttl, "1")
    except JWTError:
        pass  # Invalid tokens need not be blacklisted
    return {"message": "Successfully logged out"}


@app.post("/auth/verify", response_model=TokenVerifyResponse)
async def verify_token(authorization: str = Header(...)):
    """
    Called by other services (job-service, api-gateway) to validate a Bearer token.
    Returns the decoded user_id and email if the token is valid.
    """
    if not authorization.startswith("Bearer "):
        return TokenVerifyResponse(valid=False)

    token = authorization.removeprefix("Bearer ")

    if is_token_blacklisted(token):
        return TokenVerifyResponse(valid=False)

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        email = payload.get("email")
        if user_id is None:
            return TokenVerifyResponse(valid=False)
        return TokenVerifyResponse(valid=True, user_id=user_id, email=email)
    except JWTError:
        return TokenVerifyResponse(valid=False)
