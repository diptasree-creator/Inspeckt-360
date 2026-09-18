"""Tests for Settings.validate_for_production() (app/config.py) — the
startup guard added alongside Alembic/CORS hardening so an insecure
default (shared dev JWT secret, wildcard CORS + credentials, sqlite,
console-only email) can't reach a real deployment silently.

Settings' fields are bound from os.environ at CLASS-DEFINITION time (i.e.
at import), and app.config (like most modules here) is very likely
already imported in this same test process by the time these tests run
(test_api.py etc. import app.main first). So env vars set inside a test
function here would have no effect on an already-imported module — each
scenario below runs in a fresh subprocess instead, the same way a real
deployment's environment is fixed before its process starts.
"""
import subprocess
import sys


def _run_validation(env: dict) -> subprocess.CompletedProcess:
    code = (
        "from app.config import Settings\n"
        "Settings().validate_for_production()\n"
        "print('VALIDATION_OK')\n"
    )
    return subprocess.run(
        [sys.executable, "-c", code],
        cwd=__file__.rsplit("/tests/", 1)[0],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def _base_env(**overrides) -> dict:
    import os
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JWT_", "DATABASE_", "CORS_", "EMAIL_", "ENVIRONMENT"))}
    env.update(overrides)
    return env


def test_development_environment_never_blocks_startup():
    """The default (no ENVIRONMENT set) must stay a no-op no matter how
    insecure the rest of the config looks — this is what keeps
    quickstart.sh and the whole rest of this test suite zero-setup."""
    result = _run_validation(_base_env())
    assert result.returncode == 0, result.stderr
    assert "VALIDATION_OK" in result.stdout


def test_production_with_every_default_left_in_place_refuses_to_start():
    result = _run_validation(_base_env(ENVIRONMENT="production"))
    assert result.returncode != 0
    assert "VALIDATION_OK" not in result.stdout
    combined = result.stdout + result.stderr
    assert "JWT_SECRET" in combined
    assert "CORS_ORIGINS" in combined
    assert "SQLite" in combined or "sqlite" in combined
    # EMAIL_PROVIDER=console is a warning, not a hard failure — see
    # test_production_with_console_email_warns_but_still_starts below —
    # but it should still surface in the output either way.
    assert "EMAIL_PROVIDER" in combined


def test_production_with_console_email_warns_but_still_starts():
    """EMAIL_PROVIDER=console can't leak data or break auth the way the
    other three defaults can — it just means magic-links and lead
    notifications silently no-op — so it must warn, not block a pilot
    launch that hasn't wired up real email yet."""
    result = _run_validation(_base_env(
        ENVIRONMENT="production",
        JWT_SECRET="a-real-random-secret-value-not-the-dev-default",
        DATABASE_URL="postgresql://user:pass@host/db",
        CORS_ORIGINS="https://app.inspeckt.example",
        EMAIL_PROVIDER="console",
    ))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "VALIDATION_OK" in result.stdout
    assert "EMAIL_PROVIDER" in (result.stdout + result.stderr)


def test_production_with_a_real_config_starts_cleanly():
    result = _run_validation(_base_env(
        ENVIRONMENT="production",
        JWT_SECRET="a-real-random-secret-value-not-the-dev-default",
        DATABASE_URL="postgresql://user:pass@host/db",
        CORS_ORIGINS="https://app.inspeckt.example",
        EMAIL_PROVIDER="resend",
    ))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "VALIDATION_OK" in result.stdout


def test_production_still_flags_wildcard_cors_even_with_everything_else_fixed():
    """Isolates the CORS check: wildcard-origin + allow_credentials=True is
    flagged even when JWT/DB/email are all otherwise production-ready,
    since it's both a security hole and silently broken in most browsers
    (see app/config.py's validate_for_production comment)."""
    result = _run_validation(_base_env(
        ENVIRONMENT="production",
        JWT_SECRET="a-real-random-secret-value-not-the-dev-default",
        DATABASE_URL="postgresql://user:pass@host/db",
        CORS_ORIGINS="*",
        EMAIL_PROVIDER="resend",
    ))
    assert result.returncode != 0
    assert "CORS_ORIGINS" in (result.stdout + result.stderr)
