# knowledge-base/ — source PDFs (not in git)

Drop PDFs here, then run the `pipeline/` scripts (see `pipeline/README.md`)
to parse, chunk, embed, and index them.

PDFs are gitignored — too large for GitHub. On a fresh clone this folder
will be empty; add your own PDFs and rebuild the index before running the
app, or the RAG/docs chat mode will have nothing to retrieve from.

Currently expected here (referenced by the eval sets in `data/`):
`AI Engineering.pdf`, `Data Science.pdf`, `ML.pdf`, `Python.pdf`.
