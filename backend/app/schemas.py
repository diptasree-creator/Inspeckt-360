from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


# ---- Auth ----
class RegisterRequest(BaseModel):
    email: EmailStr
    # Optional on purpose: the platform's real auth is magic-link / Google
    # OAuth (see MagicLinkRequest below and PLATFORM_PLAN_V2.md §2.4). A
    # password is still accepted for a legacy/admin-style account.
    password: Optional[str] = Field(default=None, min_length=6)
    full_name: str
    company_name: Optional[str] = None
    fssai_license_number: Optional[str] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class MagicLinkRequest(BaseModel):
    """The real signup path: email + business name + FSSAI license number,
    no password. In production this sends a one-time link via an email
    provider (SendGrid/Postmark — see backend README "What's simulated");
    this build issues the session token immediately since no email provider
    is configured in this environment, so the click-through step is
    simulated rather than real."""
    email: EmailStr
    business_name: str
    # Optional, not a signup gate — see Fix Plan handoff item "I don't
    # want license to be a criteria." Format is still enforced when one
    # IS provided (14 digits), via the validator below.
    fssai_license_number: Optional[str] = Field(default=None, description="14-digit FSSAI license number, if known yet")

    @field_validator("fssai_license_number")
    @classmethod
    def _validate_license_format(cls, v):
        if v is None or v == "":
            return None
        if not (len(v) == 14 and v.isdigit()):
            raise ValueError("FSSAI license number should be 14 digits — or leave it blank for now.")
        return v


class MagicLinkRequestStartResponse(BaseModel):
    """Response for POST /auth/magic-link/request — the REAL flow's first
    step. Deliberately carries no token and no user: nothing about
    signing in has happened yet, only an email has been (simulated-)sent.
    Compare with the legacy POST /auth/magic-link, which returns a
    TokenResponse immediately."""
    message: str
    expires_in_minutes: int


class UserOut(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    fssai_license_number: Optional[str] = None
    state_code: Optional[str] = None
    tier: Optional[str] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


# ---- Products ----
class CategoryOut(BaseModel):
    id: str
    label: str
    regulation: str
    live: bool


class PlatformCategoryOut(BaseModel):
    id: str
    label: str
    description: str
    live: bool


# ---- Formulation Lab ----
class FormulationIterationCreateRequest(BaseModel):
    product_name: str
    iteration_label: str
    category: str
    input: Dict[str, Any]


class FormulationIterationOut(BaseModel):
    id: str
    product_name: str
    iteration_label: str
    category: str
    input: Dict[str, Any]
    closeness_score: str
    gap_summary: List[Dict[str, Any]]
    created_at: datetime

    class Config:
        from_attributes = True


# ---- Leads (human hand-off: doesn't-fit, license, custom bundle, dispute) ----
class LeadCreateRequest(BaseModel):
    kind: str  # "doesnt_fit" | "license" | "custom_bundle" | "dispute" | "escalation"
    contact_name: Optional[str] = None
    contact_email: EmailStr
    contact_phone: Optional[str] = None
    company_name: Optional[str] = None
    message: Optional[str] = None
    context: Optional[Dict[str, Any]] = None


class LeadOut(BaseModel):
    id: str
    kind: str
    status: str
    created_at: datetime
    # Added so GET /api/v1/leads (a logged-in founder's own "consultant
    # requests" history — frontend/js/ui/dashboard.js's renderConsultRequests())
    # has something to show per row beyond the kind/status/date already
    # returned by POST. Additive/optional so the existing POST response
    # shape doesn't change for anything already reading it.
    message: Optional[str] = None

    class Config:
        from_attributes = True


class EmailExistsResponse(BaseModel):
    """GET /api/v1/auth/exists?email=... — lets the frontend tell "no
    account for that email, create one first" apart from "there's an
    account, sign them in", without a password (the platform's real auth
    is passwordless — see MagicLinkRequest above) and without yet
    building the full send-a-real-email verification flow (deliberately
    deferred — see backend/README.md's "Frontend integration" section)."""
    exists: bool


# ---- Pricing / payments (mocked — see backend README) ----
class TierPurchaseRequest(BaseModel):
    tier: str  # "starter" | "mid" | "higher" | "full_consultation"


# ---- Submissions ----
class SubmissionCreateRequest(BaseModel):
    category: str
    input: Dict[str, Any]
    has_lab_report: bool = False
    # Fix per review item C12: a micro test result belongs to a specific
    # production batch/lot, not "the SKU" as a concept — the same recipe
    # can pass one batch and fail the next. Previously there was no
    # durable link between a saved result and a batch/lot number at all
    # (label.batch_number only recorded whether one was DECLARED on the
    # label, never what it was). Optional — not every FBO has assigned one
    # yet at draft time.
    batch_lot_number: Optional[str] = None


class SubmissionOut(BaseModel):
    id: str
    category: str
    overall_status: str
    created_at: datetime
    input: Dict[str, Any]
    result: Dict[str, Any]
    batch_lot_number: Optional[str] = None

    class Config:
        from_attributes = True


class SubmissionSummaryOut(BaseModel):
    id: str
    category: str
    overall_status: str
    created_at: datetime
    batch_lot_number: Optional[str] = None
