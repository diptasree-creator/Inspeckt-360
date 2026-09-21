from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import FormulationIteration, Product, User
from app.schemas import FormulationIterationCreateRequest, FormulationIterationOut
from app.usage_pool import pool_allowance, pool_used
from app.validation_engine import score_formulation

router = APIRouter(prefix="/api/v1/formulations", tags=["formulations"])


@router.post("", response_model=FormulationIterationOut, status_code=status.HTTP_201_CREATED)
def create_iteration(
    payload: FormulationIterationCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Phase 1 foundation (WHOLE_APP_SPEC.md §6) — same ownership check as
    # submissions.py's create_submission().
    if payload.product_id is not None:
        product = db.get(Product, payload.product_id)
        if product is None or product.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Product not found")

    # Fix per review item C3: formulation iterations now draw from the
    # same shared pool as New Submissions (app/usage_pool.py) instead of
    # their own separate, additive allowance.
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

    scored = score_formulation(payload.category, payload.input)
    record = FormulationIteration(
        user_id=current_user.id,
        product_id=payload.product_id,
        product_name=payload.product_name,
        iteration_label=payload.iteration_label,
        category=payload.category,
        input_json=payload.input,
        closeness_score=str(scored["score"]),
        gap_summary_json=scored["gap_summary"],
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return FormulationIterationOut(
        id=record.id, product_name=record.product_name, iteration_label=record.iteration_label,
        category=record.category, input=record.input_json, closeness_score=record.closeness_score,
        gap_summary=record.gap_summary_json, created_at=record.created_at, product_id=record.product_id,
    )


@router.get("", response_model=List[FormulationIterationOut])
def list_iterations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(FormulationIteration)
        .filter(FormulationIteration.user_id == current_user.id)
        .order_by(FormulationIteration.product_name, FormulationIteration.created_at)
        .all()
    )
    return [
        FormulationIterationOut(
            id=r.id, product_name=r.product_name, iteration_label=r.iteration_label,
            category=r.category, input=r.input_json, closeness_score=r.closeness_score,
            gap_summary=r.gap_summary_json, created_at=r.created_at, product_id=r.product_id,
        )
        for r in rows
    ]


@router.get("/{iteration_id}", response_model=FormulationIterationOut)
def get_iteration(iteration_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    record = db.get(FormulationIteration, iteration_id)
    if record is None or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Formulation iteration not found")
    return FormulationIterationOut(
        id=record.id, product_name=record.product_name, iteration_label=record.iteration_label,
        category=record.category, input=record.input_json, closeness_score=record.closeness_score,
        gap_summary=record.gap_summary_json, created_at=record.created_at, product_id=record.product_id,
    )


@router.delete("/{iteration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_iteration(iteration_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Added for parity with the standalone frontend's existing
    deleteIteration() (frontend/js/formulations.js) — the Formulation Lab
    UI has always let a founder delete a draft iteration; this endpoint
    didn't exist yet because nothing called it until the frontend was
    wired to this real backend. Freeing a deleted iteration's slot back
    into the shared usage pool (app/usage_pool.py, which counts rows) is
    automatic — pool_used() just counts what's left in the table.
    """
    record = db.get(FormulationIteration, iteration_id)
    if record is None or record.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Formulation iteration not found")
    db.delete(record)
    db.commit()
