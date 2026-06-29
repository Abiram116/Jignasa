import { ScrollReveal } from './ScrollReveal'
import ScrollFloat from './ScrollFloat'

const REPO_URL = 'https://github.com/Abiram116/Jignasa'
const EMAIL = 'sreeabirammandava@gmail.com'

const decisions = [
  {
    title: 'Finding answers is instant — and stays instant as the library grows',
    summary: 'Searching your documents is both exact and fast, and deleting a document never slows the system down, no matter how many others exist.',
    detail: "Technically: retrieval uses FAISS's exact search (IndexFlatIP), which at this scale is both faster and more accurate than the \"approximate\" alternatives. Every chunk also carries a stable ID, so deleting a document removes exactly its IDs in one step instead of rebuilding the entire search index from scratch.",
  },
  {
    title: "One bad PDF can't bring anything else down",
    summary: "If a document is huge, corrupted, or weird, only that one upload fails — it can't crash or slow down the rest of the app.",
    detail: 'Technically: each PDF is parsed in its own disposable process, so a memory leak or crash in the parsing library is contained and reclaimed by the OS when it exits, rather than accumulating in the long-running server. A failed parse is reported as failed, never silently swapped for a worse result.',
  },
  {
    title: "Answers can point to the exact page they came from",
    summary: 'Citations say "page 12 of this PDF," not just "somewhere in this document" — because the system actually understands document structure.',
    detail: "Technically: text is split using the document's real layout (headings, sections, pages), not a fixed-character cut. An earlier version silently fell back to character-based splitting whenever the smarter parser failed — quietly lowering quality for 94% of one test corpus with no visible error. That failure mode is now impossible: a parse failure is always surfaced.",
  },
  {
    title: 'The accuracy numbers on this page are measured, not guessed',
    summary: "Retrieval accuracy and answer quality are both benchmarked against real test questions and shown live above, not just asserted.",
    detail: 'Technically: retrieval is scored with Hit@k, MRR, and nDCG; generated answers are scored with RAGAS using a local judge model. Both come from the same evaluation pipeline that produced the numbers shown live on this page.',
  },
  {
    title: "The app doesn't blindly trust what it reads",
    summary: 'Whether it comes from you, your documents, or the open web, content is checked before it can influence what the model says.',
    detail: "Technically: user messages are checked for prompt-injection attempts before reaching the model. Separately, text the model didn't author — retrieved document chunks, web search results — is sanitized before being used, since a malicious PDF or web page warrants defusing in place rather than rejecting the whole request. A real path-traversal bug was found in a security review and fixed before release.",
  },
  {
    title: 'Bring your own API key, and it never gets stored anywhere',
    summary: 'If you choose to use a cloud model (OpenAI/Anthropic/Gemini) instead of the local one, your key stays in your browser and is never saved to a database or log file.',
    detail: 'Technically: the key is attached fresh to each request and never written to disk — verified by tracing every code path the key touches, not just assumed correct.',
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
        <p className="section-lead" style={{ maxWidth: '700px' }}>
          Jignasa is local-first by design — Ollama and FAISS running on your
          own machine, with no cloud backend to host. GitHub Pages serves
          static files only, so there's no live chat here.
        </p>
        
        <ScrollReveal>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <a className="btn-cta-primary" href={`${REPO_URL}#quick-start`} target="_blank" rel="noopener noreferrer">
              Run it locally →
            </a>
            <a className="btn-cta-secondary" href={`${REPO_URL}/blob/master/docs/TECHNICAL.md`} target="_blank" rel="noopener noreferrer">
              Read technical write-up
            </a>
          </div>
        </ScrollReveal>
      </section>

      <section className="how-section">
        <p className="section-eyebrow">Engineering decisions</p>
        <ScrollFloat containerClassName="section-title">Built around real problems, not a feature list</ScrollFloat>
        <p className="section-lead" style={{ maxWidth: '700px' }}>
          Each one in plain language first — the "technically" line underneath
          is for anyone who wants the implementation detail.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '3.5rem', marginTop: '3rem', maxWidth: '800px', margin: '3rem auto 0 auto' }}>
          {decisions.map((d) => (
            <ScrollReveal key={d.title}>
              <div style={{ paddingLeft: '1.5rem', borderLeft: '2px solid var(--border-1)', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '-5px', top: '8px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--indigo-400)', boxShadow: '0 0 10px var(--indigo-400)' }} />
                <h3 style={{ fontSize: '1.25rem', fontFamily: 'Outfit, sans-serif', color: 'var(--text-1)', marginBottom: '0.6rem', fontWeight: 500, letterSpacing: '-0.01em' }}>
                  {d.title}
                </h3>
                <p style={{ color: 'var(--text-2)', fontSize: '0.95rem', lineHeight: 1.7, marginBottom: '0.75rem' }}>
                  {d.summary}
                </p>
                <p style={{ color: 'var(--text-4)', fontSize: '0.82rem', lineHeight: 1.6 }}>
                  {d.detail}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
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
            <a 
              className="btn-cta-primary" 
              href={typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? `mailto:${EMAIL}` : `https://mail.google.com/mail/?view=cm&fs=1&to=${EMAIL}`} 
              target="_blank" 
              rel="noopener noreferrer"
            >
              ✉️ Send Email
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
