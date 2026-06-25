from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Iterator

import faiss
import numpy as np
import streamlit as st
from langchain_huggingface import HuggingFaceEmbeddings
from ollama import chat

ROOT = Path(__file__).resolve().parent
RAG_INDEX = ROOT / "rag_index"
INDEX_PATH = RAG_INDEX / "faiss.index"
METADATA_PATH = RAG_INDEX / "metadata.json"
CHUNKS_PATH = RAG_INDEX / "chunks.json"
DB_PATH = ROOT / "chat_history.sqlite3"
EVAL_SCRIPT = ROOT / "scripts" / "evaluate_rag_metrics.py"
SAVED_METRICS_PATH = ROOT / "data" / "evaluations" / "saved_metrics.json"

EMBEDDING_MODEL = "BAAI/bge-base-en-v1.5"
OLLAMA_MODEL = "qwen3:8b"
TOP_K = 5


# --- chat sqlite ---


@contextmanager
def db_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db_conn() as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS conversations (
                session_id TEXT PRIMARY KEY, title TEXT, created_at TEXT)"""
        )
        conn.execute(
            """CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY, session_id TEXT, role TEXT,
                message TEXT, created_at TEXT)"""
        )


def list_conversations() -> list[dict]:
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT session_id, title FROM conversations ORDER BY created_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_conversation() -> str:
    sid = datetime.utcnow().strftime("session_%Y%m%d_%H%M%S_%f")
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO conversations VALUES (?, ?, ?)",
            (sid, "New Chat", datetime.utcnow().isoformat()),
        )
    return sid


def delete_conversation(session_id: str) -> None:
    with db_conn() as conn:
        conn.execute("DELETE FROM chats WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM conversations WHERE session_id = ?", (session_id,))


def load_messages(session_id: str) -> list[dict]:
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT role, message FROM chats WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def append_message(session_id: str, role: str, message: str) -> None:
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO chats (session_id, role, message, created_at) VALUES (?,?,?,?)",
            (session_id, role, message, datetime.utcnow().isoformat()),
        )


def set_title(session_id: str, title: str) -> None:
    with db_conn() as conn:
        conn.execute(
            "UPDATE conversations SET title = ? WHERE session_id = ?",
            (title[:60], session_id),
        )


def get_title(session_id: str) -> str:
    with db_conn() as conn:
        row = conn.execute(
            "SELECT title FROM conversations WHERE session_id = ?", (session_id,)
        ).fetchone()
    return row["title"] if row else "New Chat"


# --- retrieval ---


@lru_cache(maxsize=1)
def _embeddings() -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )


def index_ready() -> bool:
    return INDEX_PATH.exists() and METADATA_PATH.exists()


def load_index() -> tuple[faiss.IndexFlatIP, list[dict]]:
    if not index_ready():
        raise FileNotFoundError(
            f"No index in `{RAG_INDEX}`. Run `rag_with_langchain.ipynb` first."
        )
    index = faiss.read_index(str(INDEX_PATH))
    metadata = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    return index, metadata


def search(query: str, k: int = TOP_K) -> list[dict]:
    index, metadata = load_index()
    emb = _embeddings()
    qv = np.asarray([emb.embed_query(query)], dtype=np.float32)
    faiss.normalize_L2(qv)
    scores, indices = index.search(qv, k)
    hits = []
    for rank, (score, idx) in enumerate(zip(scores[0], indices[0], strict=True), start=1):
        if idx == -1:
            continue
        item = metadata[idx]
        hits.append(
            {
                "rank": rank,
                "score": float(score),
                "source": item.get("source"),
                "page_number": item.get("page_number"),
                "text": item.get("text", ""),
            }
        )
    return hits


def build_prompt(question: str, hits: list[dict], history: list[dict]) -> str:
    context = "\n\n".join(
        f"[{h['source']} p.{h.get('page_number')}] {h['text']}" for h in hits
    ) or "No chunks retrieved."
    recent = "\n".join(f"{m['role']}: {m['message']}" for m in history[-6:])
    return f"""Answer using only the context below. If unknown, say you don't know.

Context:
{context}

Recent chat:
{recent or "None"}

Question: {question}

Answer:"""


def stream_answer(prompt: str) -> str:
    text = ""
    with st.chat_message("assistant"):
        slot = st.empty()
        for chunk in chat(
            model=OLLAMA_MODEL,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            think=False,
            options={"temperature": 0.2},
        ):
            if chunk.message.content:
                text += chunk.message.content
                slot.markdown(text + "▌")
        slot.markdown(text or "_No response._")
    return text.strip()


def run_eval_script(*, k: int, save_as: str = "") -> dict:
    cmd = [sys.executable, str(EVAL_SCRIPT), "--json", "--k", str(k)]
    if save_as:
        cmd.extend(["--save-as", save_as])
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
    if result.returncode != 0:
        raise RuntimeError(result.stderr or result.stdout or "Evaluation failed")
    return json.loads(result.stdout.strip())


def load_saved_metrics() -> list[dict]:
    if not SAVED_METRICS_PATH.exists():
        return []
    return json.loads(SAVED_METRICS_PATH.read_text(encoding="utf-8"))


# --- UI ---


def inject_css() -> None:
    st.markdown(
        """
        <style>
        .stApp { background: #0b0f17; }
        [data-testid="stSidebar"] {
            background: #111827;
            border-right: 1px solid #1f2937;
        }
        .hero { font-size: 1.6rem; font-weight: 700; color: #f9fafb; margin: 0; }
        .muted { color: #9ca3af; font-size: 0.9rem; }
        .metric-card {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 12px;
            padding: 1rem;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def sidebar() -> None:
    with st.sidebar:
        st.markdown('<p class="hero">PDF RAG</p>', unsafe_allow_html=True)
        ready = index_ready()
        chunk_n = 0
        if METADATA_PATH.exists():
            chunk_n = len(json.loads(METADATA_PATH.read_text(encoding="utf-8")))
        st.caption(
            f"Index: {'ready' if ready else 'missing'} · {chunk_n} chunks · `{OLLAMA_MODEL}`"
        )
        if not ready:
            st.warning("Run `rag_with_langchain.ipynb` to build `rag_index/`.")

        if st.button("+ New chat", use_container_width=True, type="primary"):
            st.session_state.session_id = create_conversation()
            st.rerun()

        for conv in list_conversations():
            sid = conv["session_id"]
            label = conv["title"] or "New Chat"
            if sid == st.session_state.session_id:
                label = f"• {label}"
            c1, c2 = st.columns([0.85, 0.15])
            with c1:
                if st.button(label, key=f"open_{sid}", use_container_width=True):
                    st.session_state.session_id = sid
                    st.rerun()
            with c2:
                if st.button("×", key=f"del_{sid}"):
                    delete_conversation(sid)
                    if sid == st.session_state.session_id:
                        rest = list_conversations()
                        st.session_state.session_id = (
                            rest[0]["session_id"] if rest else create_conversation()
                        )
                    st.rerun()

        st.session_state.show_sources = st.toggle(
            "Show sources", value=st.session_state.get("show_sources", True)
        )


def page_chat() -> None:
    sid = st.session_state.session_id
    st.markdown('<p class="hero">Chat</p>', unsafe_allow_html=True)
    st.markdown(
        f'<p class="muted">{get_title(sid)} · answers from your PDF index</p>',
        unsafe_allow_html=True,
    )

    for msg in load_messages(sid):
        with st.chat_message(msg["role"]):
            st.markdown(msg["message"])

    if prompt := st.chat_input("Ask about your PDFs…"):
        if not index_ready():
            st.error("Build the index first (run the notebook).")
            return

        msgs = load_messages(sid)
        if not msgs:
            words = prompt.strip().split()[:6]
            set_title(sid, " ".join(words).title() if words else "New Chat")

        append_message(sid, "user", prompt)
        with st.chat_message("user"):
            st.markdown(prompt)

        try:
            hits = search(prompt)
            if st.session_state.show_sources and hits:
                with st.expander("Retrieved chunks", expanded=False):
                    for h in hits:
                        st.caption(
                            f"#{h['rank']} {h['source']} p.{h.get('page_number')} "
                            f"· {h['score']:.4f}"
                        )
                        st.text(h["text"][:400])
            rag_prompt = build_prompt(prompt, hits, load_messages(sid))
            answer = stream_answer(rag_prompt)
            append_message(sid, "assistant", answer)
        except Exception as e:
            st.error(str(e))


def page_metrics() -> None:
    st.markdown('<p class="hero">Evaluation</p>', unsafe_allow_html=True)
    st.markdown(
        '<p class="muted">Runs `scripts/evaluate_rag_metrics.py` on your index</p>',
        unsafe_allow_html=True,
    )

    k = st.slider("Top-k", 1, 10, TOP_K)

    if st.button("Run evaluation", type="primary", use_container_width=True):
        if not index_ready():
            st.error("Build `rag_index/` with the notebook first.")
        else:
            with st.spinner("Evaluating…"):
                try:
                    st.session_state.last_eval = run_eval_script(k=k)
                except Exception as e:
                    st.error(str(e))

    if last := st.session_state.get("last_eval"):
        st.markdown("#### Latest run")
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Hit@k", f"{last['hit_at_k']:.1%}")
        c2.metric("MRR@k", f"{last['mrr_at_k']:.3f}")
        c3.metric("Recall@k", f"{last['recall_at_k']:.1%}")
        c4.metric("Precision@k", f"{last['precision_at_k']:.3f}")
        c5.metric("nDCG@k", f"{last['ndcg_at_k']:.3f}")
        st.caption(f"{last['question_count']} questions · k={last['k']} · {last['evaluated_at']}")

        name = st.text_input("Save this run as (e.g. v1, v2)", key="save_name")
        if st.button("Save snapshot", use_container_width=True):
            if not name.strip():
                st.warning("Enter a name like v1 or v2.")
            else:
                try:
                    run_eval_script(k=k, save_as=name.strip())
                    st.success(f"Saved as `{name.strip()}`")
                    st.rerun()
                except Exception as e:
                    st.error(str(e))

    saved = load_saved_metrics()
    if saved:
        st.markdown("#### Saved runs")
        st.dataframe(
            [
                {
                    "name": r["name"],
                    "label": r.get("label", r["name"]),
                    "hit@k": f"{r['hit_at_k']:.1%}",
                    "mrr@k": f"{r['mrr_at_k']:.3f}",
                    "recall@k": f"{r['recall_at_k']:.1%}",
                    "saved_at": r.get("saved_at", ""),
                }
                for r in reversed(saved)
            ],
            use_container_width=True,
            hide_index=True,
        )


def main() -> None:
    st.set_page_config(page_title="PDF RAG", page_icon="📄", layout="wide")
    init_db()
    inject_css()
    if "session_id" not in st.session_state:
        convs = list_conversations()
        st.session_state.session_id = (
            convs[0]["session_id"] if convs else create_conversation()
        )

    sidebar()
    tab_chat, tab_eval = st.tabs(["Chat", "Evaluation"])
    with tab_chat:
        page_chat()
    with tab_eval:
        page_metrics()


if __name__ == "__main__":
    main()
