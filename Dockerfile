# Jignasa API image. Builds and serves the FastAPI backend, and serves the
# pre-built React frontend (web/dist/) as static files so a self-host user
# only needs to run this one container (plus the separate `ollama` service
# in docker-compose.yml) -- no `npm run dev` needed.
#
# Heavy ML deps here (docling, sentence-transformers, torch) make this a
# genuinely large image and a slow first build -- that's the same
# dependency set the project needs locally, not something Docker adds.
FROM python:3.11-slim

# System libraries docling/pymupdf need for PDF parsing. OCR is disabled in
# this project's pipeline config (DO_OCR=False, see pipeline/_parse_one_pdf.py),
# so no Tesseract/OCR system deps are pulled in here.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# uv for dependency installation, matching uv.lock for reproducible builds.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /usr/local/bin/

WORKDIR /app

# Install Python deps first (cache-friendly: only re-installs when these
# two files change, not on every source edit).
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

# App source. knowledge-base/ and rag_index/ are NOT copied here -- they're
# mounted as volumes in docker-compose.yml so a user's own PDFs and the
# index they build persist across container rebuilds.
COPY api/ ./api/
COPY pipeline/ ./pipeline/
COPY scripts/ ./scripts/
COPY web/dist/ ./web/dist/

RUN uv sync --frozen

# Don't run the app as root. UID 1000 matches the default first user on
# most Linux/macOS hosts, so the bind-mounted knowledge-base/ and
# rag_index/ volumes (owned by your host user) are still writable -- if you
# hit a permission error there, `chown -R 1000:1000 knowledge-base rag_index`
# on the host fixes it (see docs/DEPLOYMENT.md).
RUN useradd -m -u 1000 jignasa && chown -R jignasa:jignasa /app
USER jignasa

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
