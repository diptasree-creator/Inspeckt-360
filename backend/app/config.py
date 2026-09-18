import os

# The one deliberately-insecure default this file ships — kept ONLY so a
# fresh local checkout (quickstart.sh, the test suite) boots with zero
# setup. See Settings.validate_for_production() below, which is what
# actually stops this from reaching a real deployment.
_DEV_ONLY_JWT_SECRET = "dev-only-secret-change-me"


class Settings:
    # "development" (default) never blocks startup, however it's
    # configured — that's what keeps quickstart.sh and the test suite
    # zero-setup. Set ENVIRONMENT=production (Render, or any real deploy)
    # to turn on validate_for_production()'s checks below. Anything else
    # is treated as non-production on purpose: failing open here would
    # mean a typo like "prod" or "Production" silently skips the checks
    # instead of the reverse.
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    # Defaults to a local SQLite file so `uvicorn app.main:app` works with
    # zero setup. Point DATABASE_URL at Postgres for anything beyond a demo
    # (docker-compose.yml already does this — see its `backend` service).
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite:///./inspeckt.db")

    # CHANGE THIS before deploying anywhere reachable. A hardcoded fallback
    # is only here so the app boots for local evaluation without an .env file.
    JWT_SECRET: str = os.getenv("JWT_SECRET", _DEV_ONLY_JWT_SECRET)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

    # "*" (the default) is fine for local dev, where the frontend is often
    # opened straight from disk or a random localhost port. Comma-separated,
    # each entry stripped so "https://a.com, https://b.com" doesn't leave a
    # leading space that would never match a real Origin header.
    CORS_ORIGINS: list = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

    # ---- Magic-link email (app/email_adapter.py) ----
    # "console" (default) logs the link instead of emailing it — see
    # app/email_adapter.py for why, and what plugging in a real provider
    # looks like. Any other value resolves to an adapter that raises
    # NotImplementedError at send time rather than silently no-op'ing.
    EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "console")
    MAGIC_LINK_EXPIRE_MINUTES: int = int(os.getenv("MAGIC_LINK_EXPIRE_MINUTES", "15"))
    # Base URL the emailed link points at — a page that reads ?token=...
    # and calls GET /auth/magic-link/verify. No frontend page like that
    # is deployed anywhere from this backend in this environment (see
    # README, "Two validation engines" / "frontend and backend run
    # independently"), so this defaults to a placeholder; set it to a
    # real deployed URL once one exists.
    MAGIC_LINK_BASE_URL: str = os.getenv("MAGIC_LINK_BASE_URL", "http://localhost:8000/auth/magic-link/landing")

    # ---- Resend adapter (app/email_adapter.py, EMAIL_PROVIDER=resend) ----
    # Only read/required when EMAIL_PROVIDER=resend; ConsoleEmailAdapter
    # (the default) ignores all three. Sign up at resend.com, verify a
    # sending domain, and set these three as real secrets on the host —
    # never commit a real key here or in .env.
    RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")
    RESEND_FROM_EMAIL: str = os.getenv("RESEND_FROM_EMAIL", "")
    # Where every "Talk to a Consultant" / license / dispute / custom-bundle
    # lead (routers/leads.py) gets emailed. Required for
    # send_lead_notification() once EMAIL_PROVIDER=resend; leave unset
    # while using the console adapter for local dev.
    CONSULTANT_NOTIFY_EMAIL: str = os.getenv("CONSULTANT_NOTIFY_EMAIL", "")

    # ---- Lab report extraction (app/routers/lab_reports.py) ----
    # Unset by default on purpose — the frontend (the static demo Artifact,
    # or any future deployment) should never assume this feature is live.
    # See lab_reports.py's module docstring and README's "Lab report
    # extraction" section for the full reasoning: this needs a real
    # backend deployment AND a real key, neither of which exist in this
    # sandbox — set this only once you've actually deployed the backend
    # somewhere reachable.
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"

    def validate_for_production(self) -> None:
        """Called once at app startup (see app/main.py) — fails loudly and
        immediately, before the app accepts a single request, rather than
        letting an insecure default (a hardcoded JWT secret every clone of
        this repo shares, or a CORS policy that accepts any origin with
        credentials on) reach production quietly. A no-op unless
        ENVIRONMENT=production, so it never affects local dev or the test
        suite: those explicitly opt out by not setting ENVIRONMENT at all.

        Split into two tiers, not one: `problems` (raises — a security hole
        or a data-durability bug, never safe to boot with) vs `warnings`
        (printed, not fatal — a real product gap, but blocking startup over
        it would stop a founder from launching a pilot at all just because
        email delivery isn't wired up yet). See README's "Production
        configuration" section for the reasoning per item.
        """
        if not self.is_production:
            return

        problems = []
        warnings = []

        if not self.JWT_SECRET or self.JWT_SECRET == _DEV_ONLY_JWT_SECRET:
            problems.append(
                "JWT_SECRET is unset or still the dev default — every session token would be "
                "forgeable by anyone who has read this source file. Set it to a real secret "
                "(e.g. `openssl rand -hex 32`)."
            )

        # Checked Starlette's actual CORSMiddleware behavior (app/main.py
        # sets allow_credentials=True unconditionally) rather than assuming
        # the spec's general wildcard-plus-credentials restriction applies
        # here: with allow_all_origins AND allow_credentials, Starlette
        # deliberately reflects back whatever Origin the request came from
        # instead of literally sending "*" (see
        # starlette/middleware/cors.py's `allow_explicit_origin`) — so this
        # isn't "silently broken", it's "every origin is treated as
        # trusted", i.e. any website's JS can make an authenticated call
        # against this API on a visitor's behalf. Real exposure once real
        # user data sits behind it, independent of whether today's auth
        # happens to use a bearer header rather than a cookie.
        if self.CORS_ORIGINS == ["*"]:
            problems.append(
                "CORS_ORIGINS is \"*\" — combined with allow_credentials=True (app/main.py), "
                "Starlette treats every origin as trusted rather than refusing the combination, "
                "so any website's JavaScript can make an authenticated call against this API. "
                "Set it to your real frontend origin(s), comma-separated."
            )

        if self.DATABASE_URL.startswith("sqlite"):
            problems.append(
                "DATABASE_URL is still a local SQLite file — fine for a demo, but it won't "
                "survive a redeploy on most hosts (Render's disk is ephemeral outside a paid "
                "persistent disk add-on) and doesn't support concurrent writers. Point it at a "
                "real Postgres instance (see docker-compose.yml / the repo root's DEPLOY.md)."
            )

        if self.EMAIL_PROVIDER == "console":
            # Deliberately a warning, not a `problems` entry: unlike the
            # three above, this can't leak data or break auth — it just
            # means two features (magic-link sign-in, consultant lead
            # notifications) silently no-op instead of delivering. Real,
            # but not a reason to refuse a pilot launch outright.
            warnings.append(
                "EMAIL_PROVIDER is \"console\" — magic-link sign-in and consultant lead "
                "notifications will only be logged, never actually emailed to anyone. Set "
                "EMAIL_PROVIDER=resend (see README's \"Email sending\" section) or another real "
                "provider before founders rely on either flow."
            )

        if warnings:
            print(
                "[startup warning] ENVIRONMENT=production but some configuration is incomplete:\n- "
                + "\n- ".join(warnings)
            )

        if problems:
            raise RuntimeError(
                "Refusing to start with ENVIRONMENT=production and an unsafe configuration:\n- "
                + "\n- ".join(problems)
                + "\n\nSet ENVIRONMENT back to \"development\" if this is not really a production "
                "deployment."
            )


settings = Settings()
