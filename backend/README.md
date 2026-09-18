# Inspeckt API

FastAPI backend for the Inspeckt FSSAI dairy compliance checker. Covers
**Milk, Paneer, Cheese, Ghee/Butter, Milk Powder and Yogurt/Dahi** (the
same live categories as the frontend) — composition, labelling, and
shelf-life for all six; microbiology (Table 2A/2B) for the first three
(Ghee/Butter, Milk Powder and Yogurt/Dahi are composition-only for now —
see `GHEE_TYPES` / `MILK_POWDER_TYPES` / `YOGURT_TYPES` / `MICRO_LIMITS`
in `app/dairy_bible.py`).

This is a real, runnable implementation of the architecture described in
`INSPECKT_TECHNICAL_SPECIFICATION.md`, trimmed to the live categories and
to what a small team can actually operate: SQLite by default (zero
setup), Postgres via Docker Compose when you want it, JWT auth, no Alembic
migrations yet (see "What's not here").

## Quickstart (no Docker)

```bash
./quickstart.sh
```

Opens the API at `http://localhost:8000` with a local SQLite file
(`inspeckt.db`). Interactive docs at `http://localhost:8000/docs` — try the
flow directly from Swagger:

1. `POST /api/v1/auth/register` — create an account, get a token
2. Click "Authorize" in Swagger, paste the token
3. `POST /api/v1/submissions` — submit a formulation, get a scored report back
4. `GET /api/v1/submissions` — see it in your history

## Quickstart (Docker + Postgres)

```bash
cp .env.example .env      # edit JWT_SECRET and POSTGRES_PASSWORD
docker-compose up -d
```

Same API, same port, backed by Postgres instead of SQLite.

## Running the tests

```bash
source .venv/bin/activate   # after running quickstart.sh once
pytest -v
```

`tests/test_validation_engine.py` is the important one — it's the same test
cases from `INSPECKT_APP_BUILD_SPECIFICATION.md`'s "Testing Guidelines",
corrected to match the Dairy Bible's actual regulation tables (see
"Regulatory notes" below). `tests/test_api.py` is an end-to-end smoke test:
register → login → submit → read back.

## API surface

```
GET  /health
POST /api/v1/auth/register            — legacy/admin path, password-based
POST /api/v1/auth/login
POST /api/v1/auth/magic-link          — LEGACY: immediate session, no email step (simulated — see below)
POST /api/v1/auth/magic-link/request  — REAL flow, step 1: generates + "emails" a one-time link
GET  /api/v1/auth/magic-link/verify   — REAL flow, step 2: redeems the link, only then issues a session
GET  /api/v1/auth/me

GET  /api/v1/products/platform-categories  — all FSSAI categories (Dairy live, rest coming soon)
GET  /api/v1/products/categories           — Dairy's sub-categories (Milk, Paneer, Cheese, ...)
GET  /api/v1/products/{category}/standards

POST /api/v1/submissions              — validate + persist a submission (has_lab_report gates nutrition/claims)
GET  /api/v1/submissions              — current user's history
GET  /api/v1/submissions/{id}

POST /api/v1/formulations             — save a Formulation Lab iteration (scored, not persisted-with-a-report)
GET  /api/v1/formulations             — list this account's iterations
GET  /api/v1/formulations/{id}

POST /api/v1/leads                    — human hand-off: doesn't-fit / license / custom-bundle / dispute / escalation
GET  /api/v1/pricing/tiers            — the pricing ladder
POST /api/v1/pricing/purchase         — set a tier on the account (mocked — no real payment)

POST /api/v1/lab-reports/extract      — reads an uploaded NABL report, returns structured fields (needs ANTHROPIC_API_KEY — see below)
POST /api/v1/lab-reports/verify-lab   — NOT automated verification; hands back NABL's own search tool (see below)

POST /api/v1/label-checks/scan        — reads 1+ uploaded label photos, returns per-element detected/text (needs ANTHROPIC_API_KEY — see below)
```

Full request/response schemas are in the auto-generated docs at `/docs`.

## Lab report extraction — real endpoint, not wired to the frontend

`app/routers/lab_reports.py` is a genuine, working FastAPI endpoint that
reads an uploaded PDF/image lab report with a vision-capable model and
returns structured fields (lab name, report number, test parameters,
results, units — never inventing a value the document doesn't actually
contain). It exists because a customer asked, reasonably, "why can't we
just build the real OCR flow" — and the honest answer is: we can, but not
inside a static published Artifact.

**Why it isn't live in the demo link.** The demo (`dist-inspeckt-site.html`)
is one self-contained HTML file with no server behind it. Calling an
OCR/document-AI API from inside that file would mean embedding a secret
API key in client-side JavaScript — anyone could read it out of the page
source and run up your bill. Real extraction has to happen server-side,
which means: deploy this backend somewhere reachable, set
`ANTHROPIC_API_KEY` (see `.env.example`), `pip install anthropic`, and
point a real frontend at this backend's URL instead of running everything
against `localStorage`. None of those three steps happen automatically —
until they do, `POST /api/v1/lab-reports/extract` returns a `501` with an
explanation, not a fabricated result.

**Why lab verification is a search link, not a checkmark.** We looked:
NABL (under QCI) publishes no official API or open-data feed for
accreditation status — only a manual HTML search form
(`nablwp.qci.org.in/laboratorysearchone`) and periodic static PDF
directories. Scraping that form is possible but unofficial (no ToS or
rate-limit guarantee, no stable contract to build against), which is
exactly the "looks automated but isn't reliable" category this codebase
doesn't ship silently — a green "Verified" badge backed by a scraper that
could break at any time is worse than no badge at all. `POST
/api/v1/lab-reports/verify-lab` reflects that honestly: it always returns
`status: "manual_verification_required"` plus the real search URL, so a
human can do the one actually-reliable check themselves.

## Automated label scan — same pattern as lab report extraction

`app/routers/label_checks.py` is the label-check equivalent of the lab-report
endpoint above, built because you specifically asked for the Label Check flow
to work like labelveda.com's — upload your label, get an automated result,
instead of ticking a checklist yourself. It's wired up for real now:
`frontend/js/ui/label-check.js` calls it over a same-origin `fetch()`, and
`app/main.py` serves that real frontend from this same FastAPI app (see its
static-mount comment) so the two are already talking to each other — the
only missing piece for a real deployment is `ANTHROPIC_API_KEY` itself. See
[`DEPLOY.md`](../DEPLOY.md) at the repo root for the exact steps to put this
on a real URL. It's genuinely useful to understand its actual boundary
before relying on it, though:

**What it can honestly do.** A vision-capable model reading a label photo
can tell you, with real confidence, whether a given mandatory element
(product name, FSSAI license number, allergen box, and so on — the same
`LABEL_ELEMENTS_ALL`/`LABEL_ELEMENTS_BY_CATEGORY` list the manual checklist
uses) is actually present and legible, and transcribe the text it finds.
`POST /api/v1/label-checks/scan` does exactly that: send it 1+ photos of
one product's packaging (front/back/nutrition-panel close-up) and a
`category`, get back a detected/not-detected + extracted-text answer per
element.

**What it can't honestly do.** labelveda.com's marketing copy claims
"format and placement rules" checking — exact font size, symbol
positioning against a stated minimum. A model looking at an ordinary
photo has no calibrated reference scale, so it cannot reliably measure
that the way a device built for it could; this endpoint only returns a
qualitative note ("text looked very small") when something is
conspicuous, never a pass/fail on a physical measurement it didn't
actually take.

**The compliance verdict is still computed deterministically, not by the
model.** This endpoint's job stops at "what's on the label" — the actual
PASS/MISSING result per element is computed the same way every other
result in this app is: `validation_engine.py`'s `_run_labelling()` reads
a plain `{key: bool}` map and applies the same rule it always has. The
scan's `detected` answers feed that map; the model itself never asserts
a compliance verdict directly. This is the same "AI extracts, the
deterministic engine judges" split used by `lab_reports.py`'s extraction
endpoint, and it's what keeps this feature inside the one rule the whole
app is built on: never state a compliance result that isn't backed by a
real, traceable check.

## Project layout

```
app/
  main.py               FastAPI app, CORS, router registration
  config.py             Settings from environment variables
  database.py            SQLAlchemy engine/session (SQLite or Postgres)
  models.py              User, Submission, FormulationIteration, MagicLinkToken, Lead
  schemas.py              Pydantic request/response models
  security.py             Password hashing (bcrypt), JWT issuing/verification
  deps.py                  get_current_user / get_current_user_optional dependencies
  dairy_bible.py           FSSAI composition/microbiology/labelling data + FSSAI_CATEGORIES
  pricing.py                The pricing ladder (Starter/Mid/Higher/Full Consultation)
  validation_engine.py       The compliance-checking logic (+ score_formulation for the Lab)
  email_adapter.py            Pluggable email sending — magic-link + lead notifications
  routers/
    auth.py, products.py, submissions.py, formulations.py, leads.py, pricing.py
alembic/
  env.py                 Wired to app.config.settings + app.models — see "Database migrations" below
  versions/               One file per migration, oldest first
tests/
  test_validation_engine.py   Unit tests for the checks themselves
  test_api.py                  End-to-end smoke test
  test_platform_v2.py           Magic-link auth (legacy shortcut), Formulation Lab, leads, pricing, upload gating
  test_magic_link_real_flow.py   The real request/verify magic-link flow + the email adapter
```

## Production configuration (`ENVIRONMENT=production`)

Every default in `app/config.py` is picked for zero-setup local dev — a
shared dev JWT secret, `CORS_ORIGINS=*`, a local SQLite file, and the
console (log-only) email adapter. None of those are safe to carry into a
real deployment, and it's easy to simply forget to change one.

Setting `ENVIRONMENT=production` (the Render blueprint at repo-root
`render.yaml` — see root `DEPLOY.md` — sets this) turns on
`Settings.validate_for_production()`, called once at the top of
`app/main.py`, before `create_all()` or anything else runs. It checks two
tiers, not one:

**Refuses to start** (raises `RuntimeError`, with a specific message per
problem) — these three can leak data or break auth, so booting with any of
them is never safe:
- `JWT_SECRET` is unset or still the checked-in dev value — every session
  token would be forgeable by anyone who's read this source.
- `CORS_ORIGINS` is still `*` — combined with `allow_credentials=True`
  (always on, in `app/main.py`'s `CORSMiddleware`), Starlette deliberately
  reflects back whatever `Origin` a request came from rather than refusing
  the combination, so this means every origin is trusted: any website's
  JavaScript could make an authenticated call against this API.
- `DATABASE_URL` is still a local SQLite file — it won't survive a redeploy
  on most hosts and doesn't support concurrent writers.

**Warns but still boots** — real, but not a reason to block a pilot launch
that hasn't finished every integration yet:
- `EMAIL_PROVIDER` is still `console` — magic-links and consultant lead
  notifications would only be logged, never actually delivered, until this
  is switched to `resend` (or another real provider).

Leaving `ENVIRONMENT` unset (the default, "development") skips all of
this — required so `quickstart.sh` and the test suite stay zero-setup.
See `tests/test_config_validation.py` for the checks exercised end to end
(each scenario runs in its own subprocess, since `Settings`' fields are
bound from the environment at import time).

## Database migrations (Alembic)

Schema changes are now tracked as Alembic migrations under `alembic/versions/`,
not just edits to `app/models.py`. `alembic/env.py` reads `DATABASE_URL` and
`Base.metadata` straight from `app/config.py` / `app/models.py` — there's no
separate hardcoded connection string to keep in sync.

**New deployment (empty database)**: run `alembic upgrade head` before
starting the app. It creates every table from scratch, matching exactly
what `Base.metadata.create_all()` would have produced (verified: an
`alembic revision --autogenerate` diff against a freshly-migrated database
comes back empty).

**Existing database from before Alembic existed** (this repo's own
`inspeckt.db` / `test_inspeckt.db`, or any database `create_all()` already
built): don't run `upgrade`, or Alembic will try to `CREATE TABLE` things
that already exist. Instead tell it "you're already here":
`alembic stamp head`. (Already done for the two SQLite files committed in
this checkout.)

**Making a schema change going forward**: edit `app/models.py` as usual,
then generate the migration from the diff instead of hand-writing it —
`alembic revision --autogenerate -m "add whatever"` — review the generated
file (autogenerate misses some things: renamed columns look like a
drop+add, and check constraints aren't detected), then `alembic upgrade
head` to apply it locally before committing both the model change and the
migration file together.

`app/main.py` still calls `Base.metadata.create_all(bind=engine)` on boot —
kept only so a brand-new local checkout still runs with zero setup
(`quickstart.sh`, the test suite). It's a safe no-op once a database is
already current (it only fills in missing tables, never alters existing
ones), so it can't substitute for `alembic upgrade head` once the schema
actually needs to change under real production data.

## Email sending (`app/email_adapter.py`)

One pluggable adapter interface (`EmailAdapter`) backs both of this
backend's outbound emails: the magic-link sign-in flow, and notifying the
consultant team whenever a founder hits an AI-to-human hand-off
(`routers/leads.py` — "doesn't fit any category", a license request, a
dispute, a custom-bundle enquiry). The default adapter
(`EMAIL_PROVIDER=console`, the default) never sends real email — there's
no provider account configured in this environment — it logs instead and
records everything in-process (`sent_links` / `sent_notifications`),
which is how `test_magic_link_real_flow.py` and
`test_platform_v2.py::test_lead_capture_notifies_the_consultant_team`
read back what was "sent" instead of needing a real mailbox.

**Magic-link sign-in**: `POST /auth/magic-link/request` generates a
one-time token, stores its hash (not the raw value) in
`magic_link_tokens`, and calls
`get_email_adapter().send_magic_link(email, link_url)`.
`GET /auth/magic-link/verify?token=...` redeems it: checks the hash,
single-use (`used_at`), and expiry (`MAGIC_LINK_EXPIRE_MINUTES`, default
15), only then creates the account (if it doesn't exist yet) and issues a
real session token. `MAGIC_LINK_BASE_URL` (default
`http://localhost:8000/auth/magic-link/landing`) is the page a real
emailed link would point at; no such page is deployed anywhere in this
environment, so set this to a real URL once one exists.

**Lead notification**: after `create_lead()` durably saves a `Lead` row,
it calls `get_email_adapter().send_lead_notification(...)` in a
try/except that only logs on failure — a notification-provider outage
must never cost a founder their already-successful hand-off. With the
console adapter this is log-only; wiring `EMAIL_PROVIDER=resend` (see
below) actually emails `CONSULTANT_NOTIFY_EMAIL`.

**A real provider is already built in**: setting `EMAIL_PROVIDER=resend`
selects `ResendEmailAdapter`, a real HTTP-API-based implementation
(https://resend.com/docs/api-reference/emails/send-email) covering both
`send_magic_link` and `send_lead_notification`. It needs three environment
variables — `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (a verified sending
address on your Resend account), and `CONSULTANT_NOTIFY_EMAIL` (where
every lead gets emailed) — and raises loudly at construction/send time if
they're missing, rather than silently no-op'ing. **It has not been
exercised against the real Resend API** (this environment has no
account/key to test against) — only `ConsoleEmailAdapter` runs in the test
suite. Verify it against a real `RESEND_API_KEY` before relying on it in
production.

To wire a *different* provider instead: add a class in `email_adapter.py`
implementing both `EmailAdapter` methods, read its API key from an
environment variable in `config.py` (the same pattern `JWT_SECRET` and
`RESEND_API_KEY` use), and add a branch for it in `get_email_adapter()`.
Setting `EMAIL_PROVIDER` to anything unrecognized raises
`NotImplementedError` at send time — on purpose, so a misconfiguration
fails loudly instead of silently dropping a real email.

## Two validation engines

There are deliberately two implementations of the same rules: this one in
Python (`app/dairy_bible.py` + `app/validation_engine.py`), and one in
JavaScript in the frontend (`frontend/js/data/dairyBible.js` +
`frontend/js/validation.js`). Both still exist and are kept in sync by
hand — if you change a limit, change it in both places, or the two will
quietly disagree (a golden cross-engine parity test exists specifically to
catch that — see the checks referenced in the root README).

They're no longer used for the same thing, though. `frontend/js/auth.js`,
`storage.js`, and `formulations.js` now call this real backend
(`/api/v1/submissions`, `/api/v1/formulations` — see "Frontend
integration" below) for anything that actually gets saved, so the Python
engine is the one that runs for every real New Submission and Formulation
Lab score. The JavaScript engine still runs standalone in two places that
deliberately have no backend at all: the published claude.ai Artifact
demo (`dist-inspeckt-site.html` — a single static HTML file, can never
call this API however it's configured) and `label-check.html`'s
label-only checklist (`checkLabelOnly()` — a smaller, unauthenticated,
non-financial check that was never worth adding a backend model for). Keep
both engines correct; just don't expect JS-only changes to affect what a
real signed-in submission returns any more.

## Frontend integration

`frontend/` (the real multi-page app — distinct from the claude.ai
Artifact demo, see the root README) calls this backend over same-origin
`fetch()`, through one small wrapper (`frontend/js/api.js`) that attaches
`Authorization: Bearer <token>` and turns a non-2xx response into a real
`Error` with the backend's own message. What maps to what:

| Frontend module | Backend endpoint(s) |
|---|---|
| `auth.js` (`signUp`/`signIn`/`setTier`/`getCurrentUser`) | `POST /auth/register`, `GET /auth/exists`, `POST /auth/magic-link`, `POST /pricing/purchase` |
| `storage.js` (submissions) | `POST`/`GET /submissions`, `GET /submissions/{id}` |
| `formulations.js` (Formulation Lab) | `POST`/`GET /formulations`, `DELETE /formulations/{id}` |
| `leads.js` (consultant hand-off) | `POST`/`GET /leads` |

Two things stay deliberately unfinished, not by oversight:

- **No real sign-in verification.** `signUp()`/`signIn()` use
  `/auth/register` and the legacy instant `/auth/magic-link` (never a
  password, never an emailed link that has to be clicked) — the real
  verified flow (`/auth/magic-link/request` + `/auth/magic-link/verify`,
  described above) already exists on this backend but isn't called by the
  frontend yet. `GET /auth/exists` was added alongside this wiring so a
  returning user still gets an accurate "no account — create one first"
  instead of `/magic-link` silently creating one.
- **`label-check.html`'s history stays local.** Everything else moved off
  `localStorage`; label checks didn't, because there's no backend model
  for them and they don't gate anything financially — see
  `frontend/js/labelChecks.js`'s own header comment.

## Regulatory notes — corrections vs. the original build spec

`INSPECKT_APP_BUILD_SPECIFICATION.md` and the original `index.html`
prototype used composition numbers that don't match
`INSPECKT_DAIRY_BIBLE_MASTER.md` (the more detailed, regulation-cited
document). This backend — and the frontend — follow the Dairy Bible.
Differences found:

| Product | Build spec said | Dairy Bible says | Used here |
|---|---|---|---|
| Buffalo Milk | min fat 6.0% | min fat 5.0% (FSS 2.1.2) | **5.0%** |
| Low-Fat Paneer | min fat 15% (dry basis) | ≤ 20% dry basis is the "Low Fat" band; 20–50% is "Medium Fat" | **3-tier band, not a single minimum** |
| Mozzarella | 52% max moisture / 44% min fat | 60% max moisture / 35% min fat (dry basis) | **Dairy Bible's figures** |

The Dairy Bible itself says (Appendix B sign-off checklist): *"Domain
Expert (Dipta): Verify all regulatory figures before sign-off"* — these
corrections still need your sign-off before this goes anywhere near a real
compliance decision. Treat every number in `dairy_bible.py` as "best
current reading of the supplied documents," not as gazette-verified.

This table is a historical snapshot of the first correction pass (build
spec vs. Dairy Bible) and is now out of date on its own — the Low-Fat
Paneer and Mozzarella rows above no longer match what's actually coded.
Both were revisited again, twice: once to strip the "Medium Fat" Paneer
band the Dairy Bible's own Ch 5 algorithm rejected, and then again,
reading the actual primary FSSAI regulation text (uploaded during
review), to discover that second read was itself wrong — a real Medium
Fat band exists, Mozzarella isn't a flat moisture/fat pair at all, and
Processed Cheese does have a sourced Lactose limit. See the main
[`README.md`](../README.md#regulatory-corrections-need-your-sign-off)
"Regulatory corrections" table for the current, primary-source-verified
numbers — that one is kept current; this one isn't.

## What's not here (see the Dairy Bible, Chapter 14 "What is still missing")

- The other 12 FSSAI dairy categories (Ice Cream/Frozen Dessert, etc.) —
  `dairy_bible.py` lists them as `"live": False`; adding one is "add
  composition/micro/label data + a form config," not a rearchitect
  (Ghee/Butter, Milk Powder, and Yogurt/Dahi are the three done so far).
- PDF report generation (Chapter 7 of the technical spec has a ReportLab
  template to start from). For now, the frontend's "Print / Save as PDF"
  button uses the browser's print stylesheet.
- Contaminants (aflatoxin, antibiotic MRLs), food additive rules, and
  advertising/claims checks — all documented in the Dairy Bible but not
  wired into the validation engine yet.
- Rate limiting, audit logging, and the admin/analytics endpoints sketched
  in the technical spec.
