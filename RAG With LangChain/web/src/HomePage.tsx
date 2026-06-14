import { useEffect, useRef } from 'react'

interface HomePageProps {
  onEnter: () => void
  isFirstLoad?: boolean
}

/* ── Star field with shooting stars + coloured star varieties ── */
function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number

    // Color palette for stars — mostly white-blue with occasional vivid specks
    const STAR_COLORS: [number, number, number][] = [
      [200, 210, 255], // default cool-white
      [200, 210, 255],
      [200, 210, 255],
      [34,  211, 238], // cyan
      [251, 113, 133], // rose
      [251, 191,  36], // amber
      [167, 139, 250], // violet
    ]

    const stars: {
      x: number; y: number; r: number; o: number
      speed: number; color: [number, number, number]
    }[] = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // Seed 280 stars
    for (let i = 0; i < 280; i++) {
      const colorIdx = Math.floor(Math.random() * STAR_COLORS.length)
      stars.push({
        x:     Math.random() * canvas.width,
        y:     Math.random() * canvas.height,
        r:     Math.random() * 1.4 + 0.2,
        o:     Math.random() * 0.7 + 0.1,
        speed: Math.random() * 0.0006 + 0.0002,
        color: STAR_COLORS[colorIdx],
      })
    }

    let t = 0
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      t += 0.008

      /* ── Stars ── */
      for (const s of stars) {
        const pulse = Math.sin(t * s.speed * 800 + s.x) * 0.3 + 0.7
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${s.color[0]},${s.color[1]},${s.color[2]},${s.o * pulse})`
        ctx.fill()
      }

      animId = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="starfield"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0 }}
    />
  )
}

/* ── Aurora borealis bands ── */
function AuroraLayer() {
  return (
    <div className="aurora-layer" aria-hidden="true">
      <div className="aurora-band aurora-band-1" />
      <div className="aurora-band aurora-band-2" />
      <div className="aurora-band aurora-band-3" />
      <div className="aurora-band aurora-band-4" />
    </div>
  )
}

const features = [
  {
    icon: '🧠',
    iconClass: 'indigo',
    title: 'PDF RAG with HyDE',
    desc: 'Queries your documents using Hypothetical Document Embedding — generating what the answer should look like, then finding real chunks that match. Far smarter than keyword search.',
    badge: 'Powered by FAISS + BGE',
    badgeColor: 'var(--indigo-400)',
  },
  {
    icon: '🌐',
    iconClass: 'cyan',
    title: 'Live web search',
    desc: 'Pulls from DuckDuckGo in real-time when you ask about current events, recent news, or anything beyond your documents — no API key needed.',
    badge: 'DuckDuckGo, no tracking',
    badgeColor: '#22d3ee',
  },
  {
    icon: '⚡',
    iconClass: 'ember',
    title: 'Hybrid synthesis',
    desc: 'Combines document context and web results concurrently — parallel threads, single coherent answer. Cites both `[Doc p.4]` and `[Web 2]` in one response.',
    badge: 'Concurrent retrieval',
    badgeColor: 'var(--ember-400)',
  },
  {
    icon: '🔒',
    iconClass: 'violet',
    title: 'Fully local',
    desc: 'Runs Qwen3:8b via Ollama. Your documents and queries never leave your machine. No cloud, no data collection, no subscriptions.',
    badge: 'Ollama + qwen3:8b',
    badgeColor: '#a78bfa',
  },
  {
    icon: '💾',
    iconClass: 'rose',
    title: 'Prompt caching',
    desc: 'Repeated queries return instantly from SQLite cache — 7 days for docs, 6 hours for web. Token stats and cached flag persist across page reloads.',
    badge: 'SQLite WAL',
    badgeColor: '#fb7185',
  },
  {
    icon: '📊',
    iconClass: 'sage',
    title: 'Retrieval evaluation',
    desc: 'Built-in benchmarking suite measuring Hit@k, MRR, nDCG, and more — no LLM calls needed. Track quality across index versions.',
    badge: 'Hit@k · MRR · nDCG',
    badgeColor: 'var(--sage-400)',
  },
]

const steps = [
  {
    title: 'Your message arrives',
    desc: 'Guardrails check length and block injection patterns. The system classifies intent — casual, web, or document — or you override with the mode selector.',
    tags: ['Guardrails', 'Intent classifier', 'Mode override'],
    color: 'var(--indigo-400)',
  },
  {
    title: 'Cache consulted first',
    desc: 'A SHA-256 hash of your normalised query checks SQLite. Hit? Tokens stream instantly from cache with a green badge. Miss? Continue to retrieval.',
    tags: ['SQLite cache', 'TTL-aware', 'Token streaming'],
    color: '#22d3ee',
  },
  {
    title: 'Query transformation',
    desc: 'Short queries go straight to FAISS. Conversational ones rewrite via LLM. Then HyDE generates a hypothetical passage — its embedding often matches real chunks far better than the raw question.',
    tags: ['Query rewrite', 'HyDE', 'Dynamic routing'],
    color: '#a78bfa',
  },
  {
    title: 'Retrieval & grounding',
    desc: 'FAISS finds the closest 5 document chunks using cosine similarity. Web mode fetches 8 live results. Hybrid does both concurrently in parallel threads.',
    tags: ['FAISS top-k', 'DuckDuckGo', 'ThreadPoolExecutor'],
    color: 'var(--ember-400)',
  },
  {
    title: 'Qwen generates, token by token',
    desc: 'The LLM receives system prompt, prior conversation turns, and grounded context. It streams each token over SSE — you see the answer build live, with sources collapsed below.',
    tags: ['Ollama SSE', 'Chat memory', 'Source attribution'],
    color: 'var(--sage-400)',
  },
]

export default function HomePage({ onEnter, isFirstLoad = true }: HomePageProps) {
  const featuresRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`homepage ${isFirstLoad ? 'first-load' : ''}`}>
      <StarField />
      <AuroraLayer />

      {/* Ambient orbs */}
      <div className="ambient-bg">
        <div className="ambient-orb a" />
        <div className="ambient-orb b" />
        <div className="ambient-orb c" />
      </div>

      {/* ── Hero ── */}
      <section className="hero">
        {/* Eyebrow */}
        <div className="hero-eyebrow">
          <span className="eyebrow-dot" />
          Fully local · Privacy-first · Open source
        </div>

        {/* Headline */}
        <div className="hero-headline">
          <h1>
            Ask anything.
            <span className="headline-accent">Know everything.</span>
          </h1>
        </div>

        {/* Subtitle */}
        <p className="hero-subtitle">
          Jignasa — <em>the seeker</em> in Sanskrit — is an AI agent that reads your PDFs,
          searches the live web, and converses naturally. All running on your machine,
          with no data ever leaving it.
        </p>

        {/* CTA */}
        <div className="hero-actions">
          <button className="btn-cta-primary" onClick={onEnter}>
            Start a conversation
            <span style={{ fontSize: '1.1rem' }}>→</span>
          </button>
          <button
            className="btn-cta-secondary"
            onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
          >
            See how it works
          </button>
        </div>

        {/* Mode pills */}
        <div className="hero-modes">
          {[
            { icon: '✦', label: 'Casual chat',  color: '#c084fc', glow: 'rgba(192,132,252,0.2)' },
            { icon: '📄', label: 'PDF RAG',      color: '#60a5fa', glow: 'rgba(96,165,250,0.2)'  },
            { icon: '🌐', label: 'Live web',     color: '#34d399', glow: 'rgba(52,211,153,0.2)'  },
            { icon: '⚡', label: 'Hybrid',       color: '#fbbf24', glow: 'rgba(251,191,36,0.2)'  },
          ].map((m) => (
            <div
              className="hero-mode-pill"
              key={m.label}
              style={{ '--pill-glow': m.glow } as React.CSSProperties}
            >
              <span className="pill-icon">{m.icon}</span>
              <span style={{ color: m.color, fontWeight: 600 }}>{m.label}</span>
            </div>
          ))}
        </div>

        {/* Scroll hint — now glowing */}
        <div
          className="scroll-hint"
          onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span className="scroll-arrow">↓</span>
          <span>Discover</span>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <div className="stats-bar">
        <div className="stats-grid">
          {[
            { num: '2040',  label: 'chunks indexed',  cls: 'accent' },
            { num: '4',     label: 'knowledge PDFs',  cls: 'cyan'   },
            { num: '0',     label: 'cloud calls',     cls: 'sage'   },
            { num: '100%',  label: 'local inference', cls: 'rose'   },
          ].map((s) => (
            <div className="stat-item" key={s.label}>
              <span className={`stat-num ${s.cls}`}>{s.num}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ── */}
      <section className="features-section" ref={featuresRef}>
        <p className="section-eyebrow">Capabilities</p>
        <h2 className="section-title">Built for depth, not just speed</h2>
        <p className="section-lead">
          Every part of the retrieval pipeline was designed to get the best answer
          from your documents, not just the fastest one.
        </p>

        <div className="feature-grid">
          {features.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className={`feature-icon ${f.iconClass}`}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <div className="feature-badge" style={{ color: f.badgeColor }}>
                <span style={{ opacity: 0.5 }}>▸</span>
                {f.badge}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="how-section">
        <p className="section-eyebrow">Pipeline</p>
        <h2 className="section-title">What happens when you hit send</h2>
        <p className="section-lead">
          Five stages, each designed to either short-circuit for speed
          or deepen for quality.
        </p>

        <div className="steps-list">
          {steps.map((s, i) => (
            <div className="step-item" key={s.title}>
              <div className="step-line-col">
                <div className="step-num" style={{ color: s.color, borderColor: `${s.color}33`, boxShadow: `0 0 12px ${s.color}22` }}>{i + 1}</div>
                {i < steps.length - 1 && <div className="step-connector" style={{ background: `linear-gradient(180deg, ${s.color}44 0%, transparent 100%)` }} />}
              </div>
              <div className="step-content">
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
                <div className="step-tags">
                  {s.tags.map((tag) => (
                    <span className="step-tag" key={tag} style={{ borderColor: `${s.color}22`, color: s.color }}>{tag}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Agent manifesto ── */}
      <section style={{
        position: 'relative', zIndex: 1,
        padding: '4rem 2rem 5rem',
        maxWidth: 700, margin: '0 auto', textAlign: 'center',
      }}>
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--r-xl)',
          padding: '2.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{
            fontSize: '2.5rem', marginBottom: '1rem',
            filter: 'drop-shadow(0 0 20px rgba(99,102,241,0.6))',
            animation: 'manifesto-glow 3s ease-in-out infinite',
          }}>✦</div>
          <blockquote style={{
            fontFamily: "'Outfit', sans-serif",
            fontSize: 'clamp(1rem, 2vw, 1.3rem)',
            fontWeight: 600,
            color: 'var(--text-1)',
            letterSpacing: '-0.02em',
            lineHeight: 1.5,
            marginBottom: '1rem',
          }}>
            "जिज्ञासा" — the desire to know, to seek, to understand deeply.
          </blockquote>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-2)', lineHeight: 1.7 }}>
            Jignasa isn't a chatbot. It's an agent that actively retrieves, synthesises,
            and reasons — not just autocompletes. Every response is grounded in real
            sources: your PDFs, the live web, or both at once.
          </p>
          <button
            className="btn-cta-primary"
            onClick={onEnter}
            style={{ marginTop: '1.5rem', display: 'inline-flex' }}
          >
            Begin seeking →
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="home-footer">
        <p className="footer-brand">Jignasa</p>
        <p>Built with FastAPI · React · FAISS · Ollama · LangChain</p>
        <p style={{ marginTop: '0.35rem' }}>
          Fully local. Zero telemetry. Your knowledge stays yours.
        </p>
      </footer>
    </div>
  )
}
