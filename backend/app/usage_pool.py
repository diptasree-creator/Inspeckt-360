"""
Inspeckt — shared usage pool: New Submissions + Formulation Lab
iterations, counted together.

Fix per review item C3: these used to be gated by two separate counters
(routers/submissions.py's old _submission_allowance() and
routers/formulations.py's old _iteration_allowance()), each with its own
number that didn't match the pricing copy — Starter's copy said "3
formulation iterations included," but the old _iteration_allowance()
actually granted 8 (adding a 5-free baseline on top). Confirmed policy:
one shared pool per tier, no separate counters, no free baseline. Both
routers/submissions.py's create_submission() and
routers/formulations.py's create_iteration() check the same
pool_used()/pool_allowance() pair before saving, so a New Submission and a
Formulation Lab iteration draw from the same counter, in any mix.
"""
from sqlalchemy.orm import Session

from app.models import FormulationIteration, Submission, User
from app.pricing import get_tier


def pool_allowance(user: User) -> int:
    """How many total units (New Submissions + Formulation Lab
    iterations, combined) this account may save. An account with no tier
    gets 0 — there is no free baseline."""
    tier = get_tier(user.tier) if user.tier else None
    if tier is None:
        return 0
    if tier["included_units"] is None:  # unlimited (Full Consultation)
        return 10 ** 9
    return tier["included_units"]


def pool_used(db: Session, user_id) -> int:
    """How many units this account has already used, combining saved
    Submissions and saved FormulationIterations."""
    submissions = db.query(Submission).filter(Submission.user_id == user_id).count()
    iterations = db.query(FormulationIteration).filter(FormulationIteration.user_id == user_id).count()
    return submissions + iterations
