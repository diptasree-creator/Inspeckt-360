import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON, Boolean
from sqlalchemy.orm import relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_uuid)
    email = Column(String, unique=True, nullable=False, index=True)
    # Nullable: the platform's real auth is magic-link / Google OAuth (no
    # password an FBO has to remember — see PLATFORM_PLAN_V2.md §2.4). This
    # column is kept only so a password-based account (older test fixtures,
    # or a future admin login) still has somewhere to store a hash.
    password_hash = Column(String, nullable=True)
    full_name = Column(String)
    company_name = Column(String)
    fssai_license_number = Column(String)
    state_code = Column(String(2))
    is_active = Column(Boolean, default=True)
    # Which pricing tier this account has purchased (see app/pricing.py):
    # "starter" | "mid" | "higher" | "full_consultation" | None (free layer
    # only — Regulatory Brief + up to 5 Formulation Lab iterations).
    tier = Column(String, nullable=True)
    tier_purchased_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_now)

    submissions = relationship("Submission", back_populates="user", cascade="all, delete-orphan")
    formulation_iterations = relationship("FormulationIteration", back_populates="user", cascade="all, delete-orphan")


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String, nullable=False)          # "milk" | "paneer" | "cheese"
    input_json = Column(JSON, nullable=False)           # raw form input, as submitted
    result_json = Column(JSON, nullable=False)          # full validate_submission() output
    overall_status = Column(String, nullable=False)     # denormalised for fast history listing
    # Whether a real NABL lab report has been uploaded for this submission.
    # Gates claims validation and the populated nutrition panel — see
    # PLATFORM_PLAN_V2.md §2.6. This build tracks the flag; it does not yet
    # store/parse an actual uploaded file.
    has_lab_report = Column(Boolean, default=False)
    # Fix per review item C12: durable link between a saved result and the
    # production batch/lot it was tested from — see schemas.py.
    batch_lot_number = Column(String, nullable=True)
    created_at = Column(DateTime, default=_now)

    user = relationship("User", back_populates="submissions")


class FormulationIteration(Base):
    """A saved draft formulation inside the Formulation Lab (dashboard).
    Scored against the regulation using the FBO's own planned/target
    numbers — never a lab-verified result. See PLATFORM_PLAN_V2.md §2.5."""
    __tablename__ = "formulation_iterations"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name = Column(String, nullable=False)       # e.g. "Fruit Yogurt"
    iteration_label = Column(String, nullable=False)     # e.g. "v1", "Less sugar"
    category = Column(String, nullable=False)
    input_json = Column(JSON, nullable=False)
    closeness_score = Column(String, nullable=False)     # 0-100, stored as string result of scoring
    gap_summary_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=_now)

    user = relationship("User", back_populates="formulation_iterations")


class MagicLinkToken(Base):
    """A one-time sign-in link, issued by POST /auth/magic-link/request
    and redeemed by GET /auth/magic-link/verify — see app/email_adapter.py
    and Fix Plan Part 3, §1. Stores a HASH of the token, not the raw
    value (the same reasoning as password_hash on User: a database read
    shouldn't hand back something directly usable to sign in).

    Signup fields are carried here, NOT written to a User row, until the
    link is actually redeemed — unlike the legacy /auth/magic-link
    endpoint, which creates the User immediately. A link nobody ever
    clicks should never leave behind an account."""
    __tablename__ = "magic_link_tokens"

    id = Column(String, primary_key=True, default=_uuid)
    token_hash = Column(String, nullable=False, unique=True, index=True)
    email = Column(String, nullable=False, index=True)
    business_name = Column(String)
    fssai_license_number = Column(String)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_now)


class Lead(Base):
    """A hand-off to a human consultant: a product that doesn't fit any
    FSSAI category, a license/registration request, a dispute, or a
    custom-bundle pricing enquiry. Never auto-resolved — see
    PLATFORM_PLAN_V2.md §3 and §6."""
    __tablename__ = "leads"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    kind = Column(String, nullable=False)  # "doesnt_fit" | "license" | "custom_bundle" | "dispute" | "escalation"
    contact_name = Column(String)
    contact_email = Column(String, nullable=False)
    contact_phone = Column(String)
    company_name = Column(String)
    message = Column(String)
    context_json = Column(JSON)  # e.g. {"product_description": "...", "category_searched": "..."}
    status = Column(String, default="new")  # "new" | "contacted" | "resolved"
    created_at = Column(DateTime, default=_now)
