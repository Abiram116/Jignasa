#!/usr/bin/env bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Load NVM/Node if not already in PATH (common in non-interactive shells or scripts)
if ! command -v npm &> /dev/null; then
    export NVM_DIR="$HOME/.nvm"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        echo "Loading NVM..."
        . "$NVM_DIR/nvm.sh"
    fi
fi

# Ensure npm is now available
if ! command -v npm &> /dev/null; then
    echo "Error: npm/node is not installed or not in PATH."
    exit 1
fi

# Ensure uv is available
if ! command -v uv &> /dev/null; then
    echo "Error: uv is not installed or not in PATH."
    exit 1
fi

echo "Starting Backend API (Port 8000)..."
cd "$DIR"
uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Starting Frontend React Webapp (Port 5173)..."
cd "$DIR/web"
npm run dev &
FRONTEND_PID=$!

# Cleanup function to kill both backend and frontend on exit
cleanup() {
    echo ""
    echo "Stopping all services..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

# Trap Ctrl+C (SIGINT), SIGTERM, and normal exit
trap cleanup SIGINT SIGTERM EXIT

# Keep script running to show logs and wait
wait
