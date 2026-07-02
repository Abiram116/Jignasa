#!/usr/bin/env bash
# Double-click launcher for macOS Finder. Opens Terminal.app and runs the
# exact same run_all.sh (same trap-based cleanup, same port-conflict
# handling) -- JIGNASA_OPEN_BROWSER=1 tells it to open the browser itself
# once it knows which port the frontend actually ended up on.
cd "$(dirname "$0")"
export JIGNASA_OPEN_BROWSER=1
exec ./run_all.sh
