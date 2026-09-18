from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.routers import auth, products, submissions, formulations, leads, pricing, lab_reports, label_checks

# Fail loudly at boot, before accepting a single request, if this is a real
# deployment (ENVIRONMENT=production) with an unsafe default still in place
# (shared dev JWT secret, wildcard CORS + credentials, sqlite, console-only
# email). A no-op for local dev / the test suite — see
# Settings.validate_for_production()'s own docstring in app/config.py.
settings.validate_for_production()

# Zero-setup convenience for local dev and the test suite (tests/test_api.py
# et al. just import this module against a throwaway sqlite file with no
# setup step) — create_all() only ever fills in tables that don't exist yet,
# so it's a safe no-op once a database is already at the current schema.
#
# Alembic now owns the schema going forward (alembic/, alembic.ini — see
# README's "Database migrations" section): a real deployment should run
# `alembic upgrade head` before starting this app, and every future model
# change belongs in a new `alembic revision --autogenerate` migration, not
# just an edit to app/models.py. This line stays only so a brand-new local
# checkout still boots with zero setup; it never ALTERs an existing table,
# so it can't substitute for a migration once the schema needs to change
# under real data.
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Inspeckt API",
    description=(
        "FSSAI compliance platform API. Dairy (Milk, Paneer, Cheese) is the "
        "only live category today; the platform-wide category taxonomy, "
        "Formulation Lab, pricing tiers, and human hand-off (leads) are all "
        "built to extend to the rest of FSSAI's categories without a "
        "rearchitect. See PLATFORM_PLAN_V2.md at the repo root."
    ),
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(submissions.router)
app.include_router(formulations.router)
app.include_router(leads.router)
app.include_router(pricing.router)
# Registered unconditionally, like every other router — it returns a clear
# 501 (not a 404, and not a fabricated result) until ANTHROPIC_API_KEY is
# actually configured. See app/routers/lab_reports.py's module docstring.
app.include_router(lab_reports.router)
# Same pattern, same precondition, same honest 501 until configured — see
# app/routers/label_checks.py's module docstring for what this can and
# can't determine from a photo even once it's live.
app.include_router(label_checks.router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok"}


# ---------------------------------------------------------------
# Real deployment mode: serve the actual multi-page frontend (frontend/)
# from this same FastAPI app, same origin as the API. This is what makes
# label_checks.py's /scan endpoint (and lab_reports.py's /extract) reach-
# able from a real page load — a plain `fetch("/api/v1/label-checks/scan")`
# from frontend/js/ui/label-check.js needs no CORS config or hardcoded
# host because it's the same origin. This is genuinely different from the
# published Artifact demo: that's one static HTML file with no server at
# all; this serves the real frontend/ directory next to a real backend.
#
# Mounted LAST and matched in registration order — every /api/... route
# above is tried first, so this only ever catches page/asset requests
# (index.html, css/*, js/*, label-check.html, ...), never shadows the API.
#
# Two different on-disk layouts both need to resolve here, at different
# relative depths from this file, so both candidates are checked rather
# than hardcoding one: a local checkout has `frontend/` as backend/'s
# sibling (repo_root/frontend, 3 parents up from this file), while the
# Docker image (see Dockerfile) copies backend/app's CONTENTS to /app/app
# and frontend/ to /app/frontend — losing the "backend" path segment, so
# frontend/ ends up only 2 parents up there. Guarded so `uvicorn
# app.main:app` still runs standalone (API only, per quickstart.sh) if
# neither candidate exists.
_FRONTEND_CANDIDATES = [
    Path(__file__).resolve().parent.parent.parent / "frontend",  # local checkout: backend/app/main.py -> repo_root/frontend
    Path(__file__).resolve().parent.parent / "frontend",          # Docker image: /app/app/main.py -> /app/frontend
]
_FRONTEND_DIR = next((p for p in _FRONTEND_CANDIDATES if p.is_dir()), None)
if _FRONTEND_DIR is not None:
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
