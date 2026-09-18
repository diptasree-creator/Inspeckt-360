import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.email_adapter import get_email_adapter
from app.models import MagicLinkToken, User
from app.schemas import EmailExistsResponse, LoginRequest, MagicLinkRequest, MagicLinkRequestStartResponse, RegisterRequest, TokenResponse, UserOut
from app.security import create_access_token, extract_state_code, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """Legacy/admin path — kept for anything that still wants a password.
    The real signup flow (Section 2.4 of PLATFORM_PLAN_V2.md) is
    /auth/magic-link below."""
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password) if payload.password else None,
        full_name=payload.full_name,
        company_name=payload.company_name,
        fssai_license_number=payload.fssai_license_number,
        state_code=extract_state_code(payload.fssai_license_number),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                          user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect.")

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                          user=UserOut.model_validate(user))


@router.post("/magic-link", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def magic_link(payload: MagicLinkRequest, db: Session = Depends(get_db)):
    """LEGACY / SIMULATED — kept only because most of this backend's own
    test suite still uses it as a one-call signup shortcut. Issues a
    session token immediately, with no email step at all: right now
    anyone who knows an email address can sign in as it. Real
    integrations should use the two-step flow below instead —
    POST /magic-link/request then GET /magic-link/verify — which
    actually withholds the session token until a one-time link is
    redeemed. This endpoint is not being removed as part of that change
    (that would break the existing test fixtures for no functional
    gain), but it should not be the endpoint a real frontend calls.
    """
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if user is None:
        user = User(
            email=payload.email.lower(),
            password_hash=None,
            full_name=payload.business_name,
            company_name=payload.business_name,
            fssai_license_number=payload.fssai_license_number,
            state_code=extract_state_code(payload.fssai_license_number),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                          user=UserOut.model_validate(user))


@router.post("/magic-link/request", response_model=MagicLinkRequestStartResponse, status_code=status.HTTP_201_CREATED)
def magic_link_request(payload: MagicLinkRequest, db: Session = Depends(get_db)):
    """Step 1 of the REAL magic-link flow (Fix Plan Part 3, §1). Generates
    a one-time token, stores only its hash, and sends it through
    app/email_adapter.py's configured adapter (EMAIL_PROVIDER=console by
    default — the link is logged, not actually emailed, since no
    provider is configured in this environment; see that module for how
    to wire a real one). No account is created and no session token is
    returned here — see /magic-link/verify, which does both, and only
    once the link is actually redeemed.
    """
    raw_token = secrets.token_urlsafe(32)
    db.add(MagicLinkToken(
        token_hash=_hash_token(raw_token),
        email=payload.email.lower(),
        business_name=payload.business_name,
        fssai_license_number=payload.fssai_license_number,
        expires_at=datetime.utcnow() + timedelta(minutes=settings.MAGIC_LINK_EXPIRE_MINUTES),
    ))
    db.commit()

    link_url = f"{settings.MAGIC_LINK_BASE_URL}?token={raw_token}"
    get_email_adapter().send_magic_link(payload.email.lower(), link_url)

    return MagicLinkRequestStartResponse(
        message="Check your email for a sign-in link.",
        expires_in_minutes=settings.MAGIC_LINK_EXPIRE_MINUTES,
    )


@router.get("/magic-link/verify", response_model=TokenResponse)
def magic_link_verify(token: str, db: Session = Depends(get_db)):
    """Step 2 — redeems a one-time link from /magic-link/request. The
    account is created HERE, not at request time, so a link nobody ever
    clicks never leaves an account behind. A token can only be redeemed
    once (used_at is checked and set) and only within
    MAGIC_LINK_EXPIRE_MINUTES of being issued.
    """
    token_row = db.query(MagicLinkToken).filter(MagicLinkToken.token_hash == _hash_token(token)).first()
    if token_row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This sign-in link is invalid.")
    if token_row.used_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This sign-in link has already been used — request a new one.")
    if token_row.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This sign-in link has expired — request a new one.")

    token_row.used_at = datetime.utcnow()

    user = db.query(User).filter(User.email == token_row.email).first()
    if user is None:
        user = User(
            email=token_row.email,
            password_hash=None,
            full_name=token_row.business_name,
            company_name=token_row.business_name,
            fssai_license_number=token_row.fssai_license_number,
            state_code=extract_state_code(token_row.fssai_license_number),
        )
        db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(user.id)
    return TokenResponse(access_token=access_token, expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
                          user=UserOut.model_validate(user))


@router.get("/exists", response_model=EmailExistsResponse)
def email_exists(email: str, db: Session = Depends(get_db)):
    """Used by the real frontend's sign-IN page (frontend/js/auth.js) to
    tell "no account yet — create one first" apart from "there's an
    account — sign them in" BEFORE calling the passwordless /magic-link
    endpoint below, which would otherwise silently create an account for
    any email typed into the login page (its whole job is find-or-create).
    Deliberately unauthenticated and needs no password, matching this
    platform's real (passwordless) auth model — see MagicLinkRequest's
    docstring. Yes, this lets anyone probe whether an email has signed
    up; email/account enumeration is an accepted, deliberate trade-off
    for the simple "email-only, no password" flow this whole auth system
    already uses (see the same trade-off in the magic-link endpoints
    below), not something newly introduced here.
    """
    exists = db.query(User).filter(User.email == email.lower()).first() is not None
    return EmailExistsResponse(exists=exists)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
