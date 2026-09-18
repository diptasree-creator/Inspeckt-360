from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dairy_bible import CATEGORIES
from app.database import get_db
from app.deps import get_current_user
from app.models import Submission, User
from app.schemas import SubmissionCreateRequest, SubmissionOut, SubmissionSummaryOut
from app.usage_pool import pool_allowance, pool_used
from app.validation_engine import validate_submission

router = APIRouter(prefix="/api/v1/submissions", tags=["submissions"])

_LIVE_CATEGORY_IDS = {c["id"] for c in CATEGORIES if c["live"]}


@router.post("", response_model=SubmissionOut, status_code=status.HTTP_201_CREATED)
def create_submission(
    payload: SubmissionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.category not in _LIVE_CATEGORY_IDS:
        raise HTTPException(status_code=400, detail=f"'{payload.category}' is not a live category yet.")

    # Fix per review item C3: New Submissions now draw from the same
    # shared pool as Formulation Lab iterations (app/usage_pool.py)
    # instead of their own separate allowance (the C1/C2-era numbers,
    # 1/5/unlimited, didn't match the pricing copy either — see
    # app/pricing.py).
    allowance = pool_allowance(current_user)
    if pool_used(db, current_user.id) >= allowance:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"You've used all {allowance} New Submissions and formulation iterations available on your "
                "current plan. Purchase the Starter tier (₹15,000) — or a per-unit overage on an existing "
                "tier — to add more."
            ),
        )

    result = validate_submission(payload.category, payload.input, has_lab_report=payload.has_lab_report)

    record = Submission(
        user_id=current_user.id,
        category=payload.category,
        input_json=payload.input,
        result_json=result,
        overall_status=result["overall_status"],
        has_lab_report=payload.has_lab_report,
        # Fix per review item C12.
        batch_lot_number=payload.batch_lot_number,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return SubmissionOut(
        id=record.id, category=record.category, overall_status=record.overall_status,
        created_at=record.created_at, input=record.input_json, result=record.result_json,
        batch_lot_number=record.batch_lot_number,
    )


@router.get("", response_model=List[SubmissionSummaryOut])
def list_submissions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Submission)
        .filter(Submission.user_id == current_user.id)
        .order_by(Submission.created_at.desc())
        .all()
    )
    return [
        SubmissionSummaryOut(
            id=r.id, category=r.category, overall_status=r.overall_status, created_at=r.created_at,
            batch_lot_number=r.batch_lot_number,
        )
        for r in rows
    ]


@router.get("/{submission_id}", response_model=SubmissionOut)
def get_submission(submission_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    record = db.get(Submission, submission_id)
    if record is None or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Submission not found")
    return SubmissionOut(
        id=record.id, category=record.category, overall_status=record.overall_status,
        created_at=record.created_at, input=record.input_json, result=record.result_json,
        batch_lot_number=record.batch_lot_number,
    )
