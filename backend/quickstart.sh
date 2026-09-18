#!/usr/bin/env bash
# Fastest way to a running API with zero setup: a local venv + SQLite.
# For Postgres in Docker instead, use: docker-compose up -d
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment..."
  python3 -m venv .venv
fi

source .venv/bin/activate
echo "Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

echo ""
echo "Starting Inspeckt API on http://localhost:8000"
echo "Swagger docs at http://localhost:8000/docs"
echo ""
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
