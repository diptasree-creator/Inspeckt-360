from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import User
from app.pricing import PRICING_TIERS, TIER_IDS, get_tier
from app.schemas import TierPurchaseRequest, UserOut

router = APIRouter(prefix="/api/v1/pricing", tags=["pricing"])


@router.get("/tiers")
def list_tiers():
    return {"tiers": PRICING_TIERS}


@router.post("/purchase", response_model=UserOut)
def purchase_tier(
    payload: TierPurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mocked purchase — sets the tier directly with no real payment.
    Razorpay isn't wired up in this build (see backend README "What's
    simulated"); this exists so the rest of the product (tier gating,
    Formulation Lab allowances) has something real to check against."""
    if payload.tier not in TIER_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown tier '{payload.tier}'")
    current_user.tier = payload.tier
    current_user.tier_purchased_at = datetime.now(timezone.utc)
    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user
