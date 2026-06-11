#!/usr/bin/env bash
cd "$(dirname "$0")"
exec uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
