# Build context must be the REPO ROOT (the directory containing both
# backend/ and frontend/), not backend/ itself — this image serves the
# real frontend/ directory alongside the API (see app/main.py's static
# mount), so it needs to copy both. On Render: set "Root Directory" to
# the repo root and "Dockerfile Path" to backend/Dockerfile. Locally:
# `docker build -f backend/Dockerfile .` from the repo root (docker-
# compose.yml already sets this up correctly — see its `context: ..`).
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini .
COPY frontend ./frontend

EXPOSE 8000
# Apply any migrations that haven't run yet, THEN start the app — never the
# reverse, so the app never boots against a schema older than its own code
# expects. See README's "Database migrations" section: alembic/env.py reads
# DATABASE_URL from the same app/config.py this app itself uses, so this
# targets whatever database the container is actually configured for.
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
