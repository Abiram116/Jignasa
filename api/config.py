from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KB = ROOT / "knowledge-base"
RAG_INDEX = ROOT / "rag_index"
INDEX_PATH = RAG_INDEX / "faiss.index"
METADATA_PATH = RAG_INDEX / "metadata.json"
CHUNKS_PATH = RAG_INDEX / "chunks.json"
DB_PATH = ROOT / "data" / "chat_history.sqlite3"
EVALUATION_SET_PATH = ROOT / "data" / "evaluation_set.json"
EVALUATIONS_DIR = ROOT / "data" / "evaluations"
SAVED_METRICS_PATH = EVALUATIONS_DIR / "saved_metrics.json"

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
OLLAMA_MODEL = "qwen3:8b"
TOP_K = 5
DEFAULT_EVAL_K = TOP_K

# ── Guardrails ───────────────────────────────────────────────────────
MAX_INPUT_LENGTH = 2000          # characters
MIN_INPUT_LENGTH = 1

# Patterns that are blocked outright (jailbreak / prompt injection attempts)
BLOCKED_PATTERNS = [
    "ignore previous instructions",
    "ignore all instructions",
    "forget your instructions",
    "you are now",
    "act as if you",
    "pretend you are",
    "disregard your",
    "override your",
    "jailbreak",
    "do anything now",
    "dan mode",
]

# ── Intent routing ───────────────────────────────────────────────────
# Keywords that signal the user wants a live web search
WEB_TRIGGER_WORDS = [
    # Temporal / live data
    "latest", "today", "current", "news", "right now",
    "live", "real-time", "realtime", "recent", "trending",
    "what happened", "2025", "2026",
    # Explicit web requests — phrase-based
    "from web", "from the web", "from internet", "from the internet",
    "on web", "on the web", "on internet", "on the internet",
    "search the web", "search online", "search for", "search web",
    "search it on", "search that on",
    "look up", "look it up", "look that up",
    "google", "web search", "browse", "find online",
    "answer from web", "answer using web", "use the web", "use web",
    "using web", "using the web", "using internet",
    "check online", "check the web", "check internet",
    "from google", "google it", "google that",
    "fetch from", "pull from web",
]

# Phrases that are clearly casual / conversational
CASUAL_PATTERNS = [
    "hi", "hello", "hey", "hiya", "howdy",
    "how are you", "what's up", "whats up", "sup",
    "good morning", "good afternoon", "good evening", "good night",
    "who are you", "what are you", "what can you do",
    "thanks", "thank you", "thank u", "thx", "ty",
    "ok", "okay", "cool", "great", "awesome", "nice",
    "bye", "goodbye", "see you", "cya",
    "help", "what is this", "lol", "haha", "ha",
    "yes", "no", "sure", "sounds good", "alright",
]

# ── Web search ───────────────────────────────────────────────────────
WEB_SEARCH_RESULT_COUNT = 8     # number of DDG results to fetch

# ── Prompt cache TTLs ────────────────────────────────────────────────
RAG_CACHE_TTL_HOURS = 24 * 7    # 7 days
WEB_CACHE_TTL_HOURS = 6         # 6 hours

# ── Adaptive ReAct agent loop ────────────────────────────────────────
MAX_REACT_ITERATIONS = 3           # hard cap on tool-call/observe rounds before forcing an answer
AGENT_DECISION_NUM_PREDICT = 150   # decision call must fit a query + reasoning string, not just a label

# ── Persistent memory ────────────────────────────────────────────────
MAX_MEMORY_ITEMS = 20            # most-recent memories injected into system prompts
MEMORY_MODEL_NUM_PREDICT = 160   # extraction can return multiple facts, needs more than a single label
MEMORY_MANAGE_LIMIT = 500        # cap for the "view/manage all memories" endpoint

