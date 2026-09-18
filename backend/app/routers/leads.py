import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user, get_current_user_optional
from app.email_adapter import LeadNotification, get_email_adapter
from app.models import Lead, User
from app.schemas import LeadCreateRequest, LeadOut

logger = logging.getLogger("inspeckt.leads")

router = APIRouter(prefix="/api/v1/leads", tags=["leads"])

_VALID_KINDS = {"doesnt_fit", "license", "custom_bundle", "dispute", "escalation"}


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(
    payload: LeadCreateRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Every AI-to-human hand-off in the product lands here: a product
    that doesn't fit any FSSAI category, a license/registration request, a
    dispute, a rule-level escalation, or a custom-bundle pricing enquiry.
    Works logged-out (the entry-point buttons on the homepage don't require
    an account first) as well as logged-in. See PLATFORM_PLAN_V2.md §3, §6.
    """
    kind = payload.kind if payload.kind in _VALID_KINDS else "doesnt_fit"
    record = Lead(
        user_id=current_user.id if current_user else None,
        kind=kind,
        contact_name=payload.contact_name or (current_user.full_name if current_user else None),
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        company_name=payload.company_name or (current_user.company_name if current_user else None),
        message=payload.message,
        context_json=payload.context,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # Every AI-to-human hand-off in the product depends on someone
    # actually finding out a lead exists — the DB row alone isn't enough
    # (see this router's own module comment). But the lead has already
    # been durably saved above: a founder who clicked "Talk to a
    # Consultant" must always get their 201 and their lead ID, even if
    # the notification email fails to send (misconfigured provider,
    # provider outage, etc.) — the alternative (failing the whole request
    # over a notification problem) would lose the lead's own creation for
    # no good reason. So this is deliberately best-effort: log and move
    # on, never raise.
    try:
        get_email_adapter().send_lead_notification(LeadNotification(
            kind=record.kind,
            contact_name=record.contact_name,
            contact_email=record.contact_email,
            contact_phone=record.contact_phone,
            company_name=record.company_name,
            message=record.message,
            lead_id=record.id,
        ))
    except Exception:
        logger.exception("Failed to send lead notification for lead %s (kind=%s)", record.id, record.kind)

    return LeadOut(id=record.id, kind=record.kind, status=record.status, created_at=record.created_at, message=record.message)


@router.get("", response_model=List[LeadOut])
def list_my_leads(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Added for parity with the standalone frontend's existing
    listLeadsForUser() (frontend/js/leads.js) — a founder's dashboard has
    always shown "your consultant requests" (frontend/js/ui/dashboard.js's
    renderConsultRequests()); this endpoint didn't exist yet because
    nothing called it until the frontend was wired to this real backend.
    Auth-required (unlike POST above, which also works logged-out) since
    there's no way to scope "your own leads" without knowing who "you"
    are — a lead submitted while logged out (user_id is NULL) never shows
    up here, matching create_lead()'s own behavior of only stamping
    user_id when someone was actually logged in at submission time.
    """
    rows = (
        db.query(Lead)
        .filter(Lead.user_id == current_user.id)
        .order_by(Lead.created_at.desc())
        .all()
    )
    return [LeadOut(id=r.id, kind=r.kind, status=r.status, created_at=r.created_at, message=r.message) for r in rows]
