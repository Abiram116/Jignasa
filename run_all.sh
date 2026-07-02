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

# Pure-bash TCP port check (no lsof/nc dependency) -- opens then immediately
# closes a connection; success means something is already listening there.
port_in_use() {
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && { exec 3>&- 3<&-; return 0; }
    return 1
}

# The backend port is fixed (the frontend's Vite proxy and CORS both assume
# 8000) -- if it's taken, fail clearly instead of uvicorn crashing a few
# lines into its own startup log where it's easy to miss.
if port_in_use 8000; then
    echo "Error: port 8000 is already in use by another program."
    echo "Stop whatever's using it (e.g. 'lsof -i :8000' on Mac/Linux shows what), then run this again."
    exit 1
fi

# The frontend port can just move to the next free one -- find it ourselves
# (rather than letting Vite silently auto-increment) so we know the exact
# URL to report/open, instead of guessing 5173 when it might actually be
# on 5174 or higher.
FRONTEND_PORT=5173
while port_in_use "$FRONTEND_PORT"; do
    FRONTEND_PORT=$((FRONTEND_PORT + 1))
done
if [ "$FRONTEND_PORT" != "5173" ]; then
    echo "Note: port 5173 was already in use -- using $FRONTEND_PORT instead."
fi

echo "Starting Backend API (Port 8000)..."
cd "$DIR"
uv run uvicorn api.main:app --reload --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "Starting Frontend React Webapp (Port $FRONTEND_PORT)..."
cd "$DIR/web"
npm run dev -- --port "$FRONTEND_PORT" --strictPort &
FRONTEND_PID=$!

# Only the double-click launchers (run_all.command, Jignasa.desktop) set
# this -- a developer running ./run_all.sh directly from a terminal they're
# already at doesn't want a new browser tab popping open on every restart.
if [ "$JIGNASA_OPEN_BROWSER" = "1" ]; then
    (
        sleep 3
        if command -v open &> /dev/null; then
            open "http://localhost:$FRONTEND_PORT"        # macOS
        elif command -v xdg-open &> /dev/null; then
            xdg-open "http://localhost:$FRONTEND_PORT"     # Linux desktop
        fi
    ) &
fi

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

# Poll instead of a plain `wait` (which only returns once BOTH jobs exit):
# `wait -n` would do this in one line but needs bash 4.3+, which stock macOS
# doesn't ship -- this works the same on any bash. Exits as soon as EITHER
# process stops (e.g. the in-app "Quit Jignasa" button killing the backend),
# so cleanup() then stops the other one too instead of leaving it orphaned.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
    sleep 1
done
