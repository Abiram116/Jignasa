import { ScrollReveal } from './ScrollReveal'
import ScrollFloat from './ScrollFloat'

const REPO_URL = 'https://github.com/Abiram116/Jignasa'
const EMAIL = 'sreeabirammandava@gmail.com'
const PHONE = '+91 8309816750'

/**
 * Only rendered on the GitHub Pages showcase build (VITE_STATIC_DEMO=true).
 * This page has no backend behind it, so it isn't just the marketing
 * homepage minus a working chat -- it's the place a recruiter or curious
 * visitor lands instead, so it needs to explain the project, point at how
 * to actually run it, and offer a way to get in touch.
 */
export function StaticShowcaseSection() {
  return (
    <>
      <section className="how-section">
        <p className="section-eyebrow">Guide</p>
        <ScrollFloat containerClassName="section-title">This page is a showcase, not the app</ScrollFloat>
        <p className="section-lead">
          Jignasa is fully local by design: Ollama + FAISS, running on your
          own machine, with no cloud backend. GitHub Pages can only serve
          static files, so there's no live chat to try here. The repo
          includes a one-command Docker setup if you want to run it yourself.
        </p>
        <ScrollReveal>
          <div className="eval-empty-state">
            <p style={{ margin: 0 }}>
              🎥 Demo video coming soon — a full walkthrough of casual chat,
              document Q&amp;A, live web search, and the hybrid mode.
            </p>
          </div>
        </ScrollReveal>
        <ScrollReveal>
          <div className="eval-empty-state" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-start' }}>
            <p style={{ margin: 0 }}>
              <strong>Want to run it?</strong> Clone the repo, then either follow
              the local Quick Start or run <code>docker compose up</code> — see{' '}
              <a href={`${REPO_URL}#quick-start`} target="_blank" rel="noopener noreferrer">
                the README
              </a>{' '}
              and{' '}
              <a href={`${REPO_URL}/blob/master/docs/DEPLOYMENT.md`} target="_blank" rel="noopener noreferrer">
                docs/DEPLOYMENT.md
              </a>.
            </p>
            <p style={{ margin: 0 }}>
              <strong>Want the technical details?</strong> Architecture, prompt
              design, and a real debugging case study live in{' '}
              <a href={`${REPO_URL}/blob/master/docs/TECHNICAL.md`} target="_blank" rel="noopener noreferrer">
                docs/TECHNICAL.md
              </a>.
            </p>
          </div>
        </ScrollReveal>
      </section>

      <section className="how-section" id="contact">
        <p className="section-eyebrow">Recruiters &amp; collaborators</p>
        <ScrollFloat containerClassName="section-title">Get in touch</ScrollFloat>
        <p className="section-lead">
          I built Jignasa end-to-end — RAG pipeline, evaluation, backend,
          and this frontend — as a portfolio project. Happy to talk through
          any of the design decisions above.
        </p>
        <ScrollReveal>
          <div className="hero-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
            <a className="btn-cta-primary" href={`mailto:${EMAIL}`}>
              ✉️ {EMAIL}
            </a>
            <a className="btn-cta-secondary" href={`tel:${PHONE.replace(/\s/g, '')}`}>
              📞 {PHONE}
            </a>
          </div>
        </ScrollReveal>
      </section>
    </>
  )
}
