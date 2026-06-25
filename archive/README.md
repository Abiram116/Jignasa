# archive/ — retired code, kept for reference only

Nothing here is imported or run by the live app. Kept so the project's
history is traceable, not because it's still useful day-to-day.

| File | Why it's here |
|---|---|
| `streamlit_app.py` | Original Streamlit UI, superseded by the React (`web/`) + FastAPI (`api/`) app. Nothing currently references it. |
| `rag_with_langchain.ipynb` | Original notebook used to build the index. Superseded by `pipeline/` — see `pipeline/README.md` for why (the notebook silently degraded chunk quality on 3 of 4 PDFs due to a crash-recovery fallback). **Do not use this notebook to rebuild the index.** |
