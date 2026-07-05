"""
Ollama host auto-detection -- WSL-aware.

FOUND AND FIXED: the first version of this module set os.environ["OLLAMA_HOST"]
and assumed every ollama.chat()/ollama.list() call downstream would pick it
up. That's wrong about *when* the package reads it: ollama/__init__.py
constructs a module-level `_client = Client()` at import time, and
`Client.__init__` reads OLLAMA_HOST from the environment exactly once,
baking the resolved host into that instance permanently
(ollama/_client.py: `base_url=_parse_host(host or os.getenv('OLLAMA_HOST'))`).
api/llm.py's `from ollama import chat` captures a bound method on that
same frozen instance -- and that import happens when api/main.py loads,
which is before the FastAPI startup event (where detect_ollama_host() used
to run) ever fires. So the env var got set, but nothing was still listening
for it: every real chat call kept silently hitting the stale default host,
while /api/status would happily report the *candidate* host as reachable
(since the probe here is a raw HTTP request, unrelated to the frozen
client) -- actively misleading, not just inert.

Fix: don't rely on the env var being re-read. This module owns an explicit,
lazily-constructed Client pointed at whatever host was actually resolved,
and every call site (api/llm.py, api/agent.py, api/memory.py,
api/query_transform.py, api/main.py's get_ollama_models()) uses
ollama_discovery.client() instead of the top-level ollama.chat/ollama.list.
A user-set OLLAMA_HOST env var is still read once at detection time and
always wins -- it's just no longer the only mechanism relied on to
actually reach the resolved host.

query_transform.py was missed in the first pass of this fix (it has two
call sites, rewrite_query() and generate_hypothetical_document(), both
wrapped in try/except so the miss was silent -- RAG search kept working,
just paying a ~1s timeout and silently losing query rewriting whenever the
default host was wrong). If you add a new Ollama call site anywhere, run
`grep -rn "from ollama import" api/` -- the only permitted hits are this
file (importing Client) and this docstring's own prose mentioning it.
"""
from __future__ import annotations

import os
import subprocess
import urllib.request

from ollama import Client

_state: dict = {"host": "http://127.0.0.1:11434", "reachable": False, "via": "localhost"}
_client_cache: Client | None = None


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


def _set_state(host: str, reachable: bool, via: str) -> dict:
    global _state, _client_cache
    _state = {"host": host, "reachable": reachable, "via": via}
    _client_cache = None  # force client() to rebuild against the new host
    return _state


def detect_ollama_host() -> dict:
    """
    Call once at startup. Returns {"host", "reachable", "via"} and also
    caches it for get_ollama_status()/client() to read from any request
    handler or background task.
    """
    if os.environ.get("OLLAMA_HOST"):
        host = os.environ["OLLAMA_HOST"]
        return _set_state(host, _probe(host), "env (user-set)")

    if _probe("http://127.0.0.1:11434"):
        return _set_state("http://127.0.0.1:11434", True, "localhost")

    if _is_wsl():
        gateway = _wsl_gateway_host()
        if gateway:
            candidate = f"http://{gateway}:11434"
            if _probe(candidate):
                return _set_state(candidate, True, "wsl-gateway")

    # Nothing reachable -- don't crash startup, just record it so /api/status
    # (and the UI banner) can tell the user clearly instead of a generic
    # error surfacing on their first chat message.
    return _set_state("http://127.0.0.1:11434", False, "none")


def get_ollama_status() -> dict:
    return dict(_state)


def client() -> Client:
    """
    The one place in this codebase that should ever construct an Ollama
    Client -- every call site imports this instead of `ollama.chat`/
    `ollama.list` directly, specifically so the resolved host from
    detect_ollama_host() actually gets used by real requests, not just
    reported in /api/status.
    """
    global _client_cache
    if _client_cache is None:
        _client_cache = Client(host=_state["host"])
    return _client_cache
