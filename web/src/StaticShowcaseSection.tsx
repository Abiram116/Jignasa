import { ScrollReveal, StaggerReveal } from './ScrollReveal'
import ScrollFloat from './ScrollFloat'

const REPO_URL = 'https://github.com/Abiram116/Jignasa'
const EMAIL = 'sreeabirammandava@gmail.com'

const decisions = [
  {
    title: 'Exact search, then ID-mapped for O(1) deletes',
    body: "Retrieval runs on FAISS's IndexFlatIP — exact brute-force cosine search, not an approximate index. At this corpus size (a few thousand chunks), exact search is sub-millisecond with zero recall loss; HNSW/IVF only earn their keep past roughly 100K vectors, where they'd be trading accuracy for speed that isn't needed yet. The index is wrapped in an IndexIDMap so every vector carries a stable ID — deleting a document removes exactly its vectors via index.remove_ids(), independent of how many other documents exist, instead of re-embedding the whole corpus on every delete.",
  },
  {
    title: 'Process-per-document parsing, not a long-lived worker',
    body: "Docling's layout model doesn't fully release memory between documents in the same process. Each PDF is parsed in its own subprocess, so the OS reclaims everything when it exits — a crash or leak on one document can't degrade the next, and a failed parse is reported as failed, never silently downgraded to a worse extraction. Uploads and incremental index updates follow the same isolation, which keeps the long-lived API server's memory flat regardless of session length.",
  },
  {
    title: 'Structural chunking, not length-based splitting',
    body: 'Chunks come from a layout-aware parser that tracks page numbers and section headings, not a fixed-character splitter. An earlier iteration silently fell back to length-based splitting whenever the structural parser failed on a large PDF — no error, just lower-quality chunks for 94% of one corpus. That failure mode is now impossible: a parse failure is surfaced, not masked by a fallback path.',
  },
  {
    title: 'Verified, not just shipped',
    body: 'Retrieval quality is measured with Hit@k, MRR, and nDCG against a held-out question set; generation quality is scored with RAGAS using a local judge model. Both are shown live on this page, sourced from the same evaluation pipeline rather than a one-time number written into a README.',
  },
  {
    title: 'Defense-in-depth on the parts that touch untrusted input',
    body: "User input runs through structural and substring injection checks before reaching the model. Content the model didn't author — retrieved document chunks, web search results — is separately sanitized before being embedded into a prompt, since a malicious PDF or web page is a different threat model than a malicious user message and deserves a different response (defuse in place, not reject the whole request). A path-traversal issue in the static file route was caught in a self-review pass and fixed before it shipped.",
  },
  {
    title: 'Bring-your-own-key, with the key never persisted',
    body: 'An optional cloud fallback (OpenAI, Anthropic, Gemini) lets someone try the system without running a local model. The key lives in the browser only, is attached per-request, and is never written to the chat database or server logs — verified directly, not just assumed, by tracing every code path the key touches.',
  },
]

/**
 * Only rendered on the GitHub Pages showcase build (VITE_STATIC_DEMO=true).
 * This page has no backend behind it, so it isn't just the marketing
 * homepage minus a working chat -- it's the place a recruiter or curious
 * visitor lands instead, so it needs to explain the project, point at how
 * to actually run it, surface the engineering decisions behind it, and
 * offer a way to get in touch.
 */
export function StaticShowcaseSection() {
  return (
    <>
      <section className="how-section">
        <p className="section-eyebrow">About this page</p>
        <ScrollFloat containerClassName="section-title">A showcase, not a hosted instance</ScrollFloat>
        <p className="section-lead">
          Jignasa is local-first by design — Ollama and FAISS running on your
          own machine, with no cloud backend to host. GitHub Pages serves
          static files only, so there's no live chat here. The repository
          includes a Docker setup for running it yourself.
        </p>
        <ScrollReveal>
          <div className="eval-empty-state" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
            <p style={{ margin: 0 }}>
              <strong>Run it locally:</strong> clone the repository, then follow
              the Quick Start or run <code>docker compose up</code> — see{' '}
              <a href={`${REPO_URL}#quick-start`} target="_blank" rel="noopener noreferrer">
                the README
              </a>{' '}
              and{' '}
              <a href={`${REPO_URL}/blob/master/docs/DEPLOYMENT.md`} target="_blank" rel="noopener noreferrer">
                docs/DEPLOYMENT.md
              </a>.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Full technical write-up:</strong> architecture, prompt
              design, a real debugging case study, and a security audit with
              fixes live in{' '}
              <a href={`${REPO_URL}/blob/master/docs/TECHNICAL.md`} target="_blank" rel="noopener noreferrer">
                docs/TECHNICAL.md
              </a>.
            </p>
          </div>
        </ScrollReveal>
      </section>

      <section className="how-section">
        <p className="section-eyebrow">Engineering decisions</p>
        <ScrollFloat containerClassName="section-title">Built around real failure modes, not defaults</ScrollFloat>
        <p className="section-lead">
          Each of these started as a problem encountered while building this
          system, not a feature picked off a list. The full reasoning for
          each is documented in the repository, not just asserted here.
        </p>
        <StaggerReveal
          className="feature-grid"
          staggerMs={70}
          items={decisions.map((d) => ({ key: d.title, d }))}
          renderItem={({ d }) => (
            <>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </>
          )}
          itemClassName="feature-card"
        />
      </section>

      <section className="how-section">
        <ScrollReveal>
          <div className="eval-empty-state">
            <p style={{ margin: 0 }}>
              Demo recording in progress — a walkthrough of document retrieval,
              live web search, and the hybrid mode will be linked here.
            </p>
          </div>
        </ScrollReveal>
      </section>

      <section className="how-section" id="contact" style={{ textAlign: 'center', alignItems: 'center' }}>
        <p className="section-eyebrow">Recruiters &amp; hiring managers</p>
        <ScrollFloat containerClassName="section-title">Let's talk</ScrollFloat>
        <p className="section-lead" style={{ maxWidth: '600px', margin: '0 auto 2rem auto' }}>
          I built Jignasa end-to-end — retrieval pipeline, evaluation
          framework, backend, and frontend — to demonstrate how I approach
          a complete system, not just a model call. Open to full-time
          engineering roles; happy to walk through any decision above in
          more depth.
        </p>
        <ScrollReveal>
          <div className="hero-actions" style={{ justifyContent: 'center' }}>
            <a className="btn-cta-primary" href={`mailto:${EMAIL}`}>
              ✉️ {EMAIL}
            </a>
            <a className="btn-cta-secondary" href={REPO_URL} target="_blank" rel="noopener noreferrer">
              View source on GitHub
            </a>
          </div>
        </ScrollReveal>
      </section>
    </>
  )
}
