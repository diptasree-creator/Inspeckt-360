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
    products = relationship("Product", back_populates="user", cascade="all, delete-orphan")


# Valid values for Product.classification_state. Kept as a plain tuple of
# strings (not a DB-level enum) so a future state can be added with a data
# migration only, never a schema migration — see WHOLE_APP_SPEC.md §8.
CLASSIFICATION_STATES = ("CONFIRMED", "NEED_INFORMATION", "CONSULTANT_REVIEW")


class Product(Base):
    """The one shared record a founder's product/submission is supposed to
    be, per WHOLE_APP_SPEC.md §6: "Do NOT create separate duplicate
    versions of the product in New Submission / Formulation Lab / Lab
    Testing / Label Check / Claims Review." Every module should read and
    write against this row instead of inventing its own.

    This is Phase 1 foundation only (see WHOLE_APP_SPEC.md §50): the table
    and the link columns exist and are usable, but the New Submission UI
    doesn't create/attach one yet — that's Phase 2 (the real classification
    engine) — so `product_id` on Submission/FormulationIteration stays
    nullable and existing rows are left unlinked rather than guessed at.
    """
    __tablename__ = "products"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    product_name = Column(String, nullable=False)        # e.g. "Mango Flavoured Milk"
    # The founder's own words — "What is it made from? How is it
    # processed? What will the customer buy?" (WHOLE_APP_SPEC.md §10).
    description = Column(String, nullable=True)
    # Set once a category is at least a candidate; only trustworthy once
    # classification_state == "CONFIRMED".
    category = Column(String, nullable=True)
    sub_type = Column(String, nullable=True)
    # One of CLASSIFICATION_STATES above. Starts at NEED_INFORMATION — a
    # brand-new product is never auto-CONFIRMED (WHOLE_APP_SPEC.md §7-8).
    classification_state = Column(String, nullable=False, default="NEED_INFORMATION")
    # Candidate standards considered, the distinguishing question(s) asked
    # and answered, and why the current state was reached — the "concise
    # reason" / "classification evidence" WHOLE_APP_SPEC.md §6 and §8 call
    # for, kept structured so the founder layer and the consultant/technical
    # layer can both be rendered from the same data instead of two copies.
    classification_evidence_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_now)
    updated_at = Column(DateTime, default=_now, onupdate=_now)

    user = relationship("User", back_populates="products")
    submissions = relationship("Submission", back_populates="product")
    formulation_iterations = relationship("FormulationIteration", back_populates="product")


class Submission(Base):
    __tablename__ = "submissions"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Nullable / additive (Phase 1 foundation — see Product's docstring
    # above): links this submission to the one shared product record when
    # the caller provides one. Existing rows predate this column and stay
    # unlinked rather than being guessed into a product after the fact.
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
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
    product = relationship("Product", back_populates="submissions")


class FormulationIteration(Base):
    """A saved draft formulation inside the Formulation Lab (dashboard).
    Scored against the regulation using the FBO's own planned/target
    numbers — never a lab-verified result. See PLATFORM_PLAN_V2.md §2.5."""
    __tablename__ = "formulation_iterations"

    id = Column(String, primary_key=True, default=_uuid)
    user_id = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Nullable / additive — see Submission.product_id above.
    product_id = Column(String, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    product_name = Column(String, nullable=False)       # e.g. "Fruit Yogurt"
    iteration_label = Column(String, nullable=False)     # e.g. "v1", "Less sugar"
    category = Column(String, nullable=False)
    input_json = Column(JSON, nullable=False)
    closeness_score = Column(String, nullable=False)     # 0-100, stored as string result of scoring
    gap_summary_json = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=_now)

    user = relationship("User", back_populates="formulation_iterations")
    product = relationship("Product", back_populates="formulation_iterations")


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
