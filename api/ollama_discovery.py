"""
Ollama host auto-detection -- WSL-aware.

The `ollama` Python package already reads OLLAMA_HOST from the environment
natively (see api/llm.py, api/agent.py, api/memory.py -- none of them
hardcode a host). This module's only job is deciding what to put in that
env var *before* any of those modules make their first call, for the one
case that doesn't work out of the box: Ollama installed on the Windows
side while Jignasa runs inside WSL2. WSL2 has its own network namespace,
so 127.0.0.1 there does not reach the Windows host -- this used to require
a user to manually export OLLAMA_HOST (still documented in README.md as a
fallback); this probes for it automatically instead.

If the user has already set OLLAMA_HOST themselves, this never overrides
it -- that's an explicit choice and always wins.
"""
from __future__ import annotations

import os
import subprocess
import urllib.request

_state: dict = {"host": "http://127.0.0.1:11434", "reachable": False, "via": "localhost"}


def _probe(host: str, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"{host}/api/version", timeout=timeout):
            return True
    except Exception:
        return False


def _is_wsl() -> bool:
    try:
        with open("/proc/version", encoding="utf-8", errors="ignore") as f:
            return "microsoft" in f.read().lower()
    except Exception:
        return False  # not Linux, or /proc/version doesn't exist (e.g. some containers)


def _wsl_gateway_host() -> str | None:
    """The Windows host's IP as seen from inside WSL2 -- the default route's gateway."""
    try:
        out = subprocess.run(
            ["ip", "route", "show", "default"],
            capture_output=True, text=True, timeout=2,
        ).stdout
        # e.g. "default via 172.20.0.1 dev eth0 ..."
        parts = out.split()
        if "via" in parts:
            return parts[parts.index("via") + 1]
    except Exception:
        pass
    return None


def detect_ollama_host() -> dict:
    """
    Call once at startup. Returns {"host", "reachable", "via"} and also
    caches it for get_ollama_status() to read from any request handler.
    """
    global _state

    if os.environ.get("OLLAMA_HOST"):
        host = os.environ["OLLAMA_HOST"]
        _state = {"host": host, "reachable": _probe(host), "via": "env (user-set)"}
        return _state

    if _probe("http://127.0.0.1:11434"):
        _state = {"host": "http://127.0.0.1:11434", "reachable": True, "via": "localhost"}
        return _state

    if _is_wsl():
        gateway = _wsl_gateway_host()
        if gateway:
            candidate = f"http://{gateway}:11434"
            if _probe(candidate):
                os.environ["OLLAMA_HOST"] = candidate
                _state = {"host": candidate, "reachable": True, "via": "wsl-gateway"}
                return _state

    # Nothing reachable -- don't crash startup, just record it so /api/status
    # (and eventually a UI banner) can tell the user clearly instead of a
    # generic error surfacing on their first chat message.
    _state = {"host": "http://127.0.0.1:11434", "reachable": False, "via": "none"}
    return _state


def get_ollama_status() -> dict:
    return dict(_state)
