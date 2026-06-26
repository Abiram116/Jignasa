import { useEffect, useRef } from 'react'
import ShinyText from './ShinyText'
import BlurText from './BlurText'
import ScrollFloat from './ScrollFloat'
import { MagicBentoGlow } from './MagicBentoGlow'
import { SmoothScroll } from './SmoothScroll'
import { StaggerReveal } from './ScrollReveal'
import { StickyPipeline } from './StickyPipeline'
import { EvalResultsSection } from './EvalResultsSection'

interface HomePageProps {
  onEnter: () => void
  onEvalLoaded?: () => void
  triggerHeroAnimations?: boolean
}

/* ── Star field ── */
function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animId: number

    const STAR_COLORS: [number, number, number][] = [
      [200, 210, 255],
      [200, 210, 255],
      [200, 210, 255],
      [34,  211, 238],
      [251, 113, 133],
      [251, 191,  36],
      [167, 139, 250],
    ]

    const stars: { x: number; y: number; r: number; o: number; speed: number; color: [number, number, number] }[] = []

    const resize = () => {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    for (let i = 0; i < 280; i++) {
      const colorIdx = Math.floor(Math.random() * STAR_COLORS.length)
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.4 + 0.2,
        o: Math.random() * 0.7 + 0.1,
        speed: Math.random() * 0.0006 + 0.0002,
        color: STAR_COLORS[colorIdx],
      })
    }

    let t = 0
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      t += 0.008
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
    desc: 'Queries your documents using Hypothetical Document Embedding: it generates what the answer should look like, then finds real chunks that match. Far smarter than keyword search.',
    badge: 'Powered by FAISS + BGE',
    badgeColor: 'var(--indigo-400)',
  },
  {
    icon: '🌐',
    iconClass: 'cyan',
    title: 'Live web search',
    desc: 'Pulls from DuckDuckGo in real-time when you ask about current events, recent news, or anything beyond your documents. No API key needed.',
    badge: 'DuckDuckGo, no tracking',
    badgeColor: '#22d3ee',
  },
  {
    icon: '⚡',
    iconClass: 'ember',
    title: 'Hybrid synthesis',
    desc: 'Combines document context and web results concurrently: parallel threads, one coherent answer. Cites both `[Doc p.4]` and `[Web 2]` in the same response.',
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
    desc: 'Repeated queries return instantly from SQLite cache: 7 days for docs, 6 hours for web. Token stats and the cached flag persist across page reloads.',
    badge: 'SQLite WAL',
    badgeColor: '#fb7185',
  },
  {
    icon: '📊',
    iconClass: 'sage',
    title: 'Measured, not just claimed',
    desc: 'Retrieval is benchmarked with Hit@k, MRR, and nDCG. Generated answers are scored with RAGAS for faithfulness and relevancy. See the live results below.',
    badge: 'Hit@k · MRR · RAGAS',
    badgeColor: 'var(--sage-400)',
  },
]

const steps = [
  {
    title: 'Your message arrives',
    desc: 'Guardrails check length and block injection patterns. The system classifies intent (casual, web, or document), or you override with the mode selector.',
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
    desc: 'Short queries go straight to FAISS. Conversational ones rewrite via LLM. Then HyDE generates a hypothetical passage, since its embedding often matches real chunks far better than the raw question.',
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
    desc: 'The LLM receives system prompt, prior conversation turns, and grounded context. It streams each token over SSE, so you see the answer build live, with sources collapsed below.',
    tags: ['Ollama SSE', 'Chat memory', 'Source attribution'],
    color: 'var(--sage-400)',
  },
]

export default function HomePage({ onEnter, onEvalLoaded, triggerHeroAnimations = false }: HomePageProps) {
  const featuresRef = useRef<HTMLDivElement>(null)

  return (
    <div className={`homepage ${triggerHeroAnimations ? 'first-load' : ''}`}>
      <SmoothScroll />
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
        {/* Eyebrow — CSS cinematic-reveal delay 0.15s */}
        <div className="hero-eyebrow">
          <span className="eyebrow-dot" />
          <ShinyText text="Fully local · Privacy-first · Open source" color="var(--text-2)" />
        </div>

        {/* Headline — CSS cinematic-reveal delay 0.35s */}
        <div className="hero-headline">
          <h1>
            <BlurText text="Ask anything." animateBy="letters" delay={55} startDelay={0} />
            <BlurText
              text="Know everything."
              as="div"
              className="headline-accent"
              animateBy="letters"
              delay={55}
              startDelay={700}
              direction="bottom"
            />
          </h1>
        </div>

        {/* Subtitle — CSS cinematic-reveal delay 0.6s */}
        <p className="hero-subtitle">
          Jignasa, <em><BlurText text="the seeker" animateBy="words" delay={120} /></em> in Sanskrit, reads your PDFs,
          searches the live web, and converses naturally, all on your machine.
        </p>

        {/* CTA — CSS cinematic-reveal delay 0.8s */}
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

        {/* Mode pills — CSS cinematic-reveal delay 1.0s */}
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

        {/* Scroll hint — CSS cinematic-reveal delay 1.3s */}
        <div
          className="scroll-hint"
          onClick={() => featuresRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          <span className="scroll-arrow">↓</span>
          <span>Discover</span>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="features-section bento-section" ref={featuresRef}>
        <MagicBentoGlow gridSelector=".features-section" />
        <p className="section-eyebrow">Capabilities</p>
        <ScrollFloat containerClassName="section-title">Built for depth, not just speed</ScrollFloat>
        <p className="section-lead">
          Every part of the retrieval pipeline was designed to get the best answer
          from your documents, not just the fastest one.
        </p>

        <StaggerReveal
          className="feature-grid feature-grid-bento"
          itemClassName={(_item, i) => `feature-card${[0, 3, 4].includes(i) ? ' feature-card-wide' : ''}`}
          staggerMs={70}
          items={features.map((f) => ({ key: f.title, f }))}
          renderItem={({ f }) => (
            <>
              <div className={`feature-icon ${f.iconClass}`}>{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <div className="feature-badge" style={{ color: f.badgeColor }}>
                <span style={{ opacity: 0.5 }}>▸</span>
                {f.badge}
              </div>
            </>
          )}
        />
      </section>

      {/* ── How it works ── */}
      <section className="how-section">
        <p className="section-eyebrow">Pipeline</p>
        <ScrollFloat containerClassName="section-title">What happens when you hit send</ScrollFloat>
        <p className="section-lead">
          Five stages, each designed to either short-circuit for speed
          or deepen for quality.
        </p>
        <StickyPipeline steps={steps} />
      </section>

      {/* ── Evaluation results ── */}
      <EvalResultsSection onLoaded={onEvalLoaded} />

      {/* ── Agent manifesto ── */}
      <section className="manifesto-section">
        <div className="manifesto-box">
          <div className="manifesto-glow-bg" />
          <div className="manifesto-sparkle">✦</div>
          <p className="manifesto-devanagari">जिज्ञासा</p>
          <p className="manifesto-gloss">the desire to know, to seek, to understand deeply</p>
          <p className="manifesto-body">
            Jignasa isn't a chatbot. It's an agent that actively retrieves, synthesises,
            and reasons, not just autocompletes. Every response is grounded in real
            sources: your PDFs, the live web, or both at once.
          </p>
          <button className="btn-cta-primary manifesto-cta" onClick={onEnter}>
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
