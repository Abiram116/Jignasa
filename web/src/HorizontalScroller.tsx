import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { fetchEvaluationSummary } from './api'
import type { EvaluationSummaryResponse } from './types'

gsap.registerPlugin(ScrollTrigger)

interface Step {
  title: string
  desc: string
  tags: string[]
  color: string
}

interface HorizontalScrollerProps {
  steps: Step[]
  onEvalLoaded?: () => void
}

export function HorizontalScroller({ steps, onEvalLoaded }: HorizontalScrollerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  
  // Data state
  const [data, setData] = useState<EvaluationSummaryResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  
  // Scroll scrub states (0 to 1, never reverting)
  const [pipelineProgress, setPipelineProgress] = useState(0)
  const [metricsProgress, setMetricsProgress] = useState(0)
  const maxScrollRef = useRef(0)

  // Fetch evaluation data
  useEffect(() => {
    let cancelled = false
    const attempt = async (attemptsLeft: number): Promise<void> => {
      try {
        const result = await fetchEvaluationSummary()
        if (cancelled) return
        setData(result)
        setStatus(result.retrieval || result.ragas ? 'ready' : 'empty')
        onEvalLoaded?.()
      } catch {
        if (cancelled) return
        if (attemptsLeft > 1) {
          await new Promise((r) => setTimeout(r, 1200))
          if (!cancelled) await attempt(attemptsLeft - 1)
        } else {
          setStatus('error')
          onEvalLoaded?.()
        }
      }
    }
    attempt(12)
    return () => { cancelled = true }
  }, [onEvalLoaded])

  // Setup horizontal scroll hijacking and custom forward-only scrub
  useEffect(() => {
    if (!containerRef.current || !trackRef.current) return
    
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: containerRef.current,
        start: 'top top',
        end: '+=250%',
        pin: true,
        scrub: 0.5,
        onUpdate: (self) => {
           // Enforce forward-only progression
           if (self.progress > maxScrollRef.current) {
               maxScrollRef.current = self.progress
               
               // Pipeline animates during the first 45% of the scroll track
               const pProg = Math.min(1, Math.max(0, self.progress / 0.45))
               setPipelineProgress(pProg)
               
               // Metrics animate during the next 45% of the scroll track
               const mProg = Math.min(1, Math.max(0, (self.progress - 0.5) / 0.45))
               setMetricsProgress(mProg)
           }
        }
      }
    })
    
    // Slide the track horizontally
    tl.to(trackRef.current, {
      xPercent: -50,
      ease: 'none'
    })
    
    return () => {
      tl.kill()
    }
  }, [])

  return (
    <div className="hs-container" ref={containerRef}>
      <div className="hs-track" ref={trackRef}>
        
        {/* ── Slide 1: Pipeline ── */}
        <div className="hs-slide pipeline-slide">
          <div className="hs-content">
            <div className="hs-header">
              <p className="section-eyebrow">Pipeline</p>
              <h2 className="section-title">What happens when you hit send</h2>
              <p className="section-lead">
                Five stages, each designed to either short-circuit for speed or deepen for quality.
              </p>
            </div>
            
            <div className="pipeline-horizontal-grid">
              {steps.map((step, i) => {
                // Calculate local 0-1 progress for this specific step to stagger them
                const startThreshold = i * 0.15
                const localProg = Math.min(1, Math.max(0, (pipelineProgress - startThreshold) / 0.3))
                
                return (
                  <div 
                    key={step.title} 
                    className="pipeline-h-card"
                    style={{
                      opacity: localProg,
                      transform: `translateY(${(1 - localProg) * 30}px) scale(${0.95 + (localProg * 0.05)})`,
                      boxShadow: `0 0 ${localProg * 30}px ${step.color.replace('var(--', 'rgba(var(--').replace(')', ', 0.1)')}`
                    }}
                  >
                    <div className="step-number" style={{ color: step.color }}>
                      {String(i + 1).padStart(2, '0')}
                      <div className="step-glow" style={{ background: step.color, opacity: localProg * 0.2 }} />
                    </div>
                    <h3>{step.title}</h3>
                    <p>{step.desc}</p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: 'auto' }}>
                      {step.tags.map(tag => (
                        <span key={tag} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', color: 'var(--text-3)' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Slide 2: Metrics ── */}
        <div className="hs-slide metrics-slide">
          <div className="hs-content split-layout">
            
            <div className="metrics-left">
              <p className="section-eyebrow">Quality</p>
              <h2 className="section-title" style={{ textAlign: 'left' }}>Measured against real questions</h2>
              <p className="section-lead" style={{ margin: '0 0 2rem 0', textAlign: 'left' }}>
                Retrieval and generation are both benchmarked, not just assumed to work.
                Generated answers are scored with RAGAS for faithfulness and relevancy.
              </p>
              {status === 'loading' && <p>Loading benchmark data...</p>}
            </div>

            <div className="metrics-right">
              {status === 'ready' && data && (
                <div className="metrics-grid">
                  {data.retrieval && (
                    <>
                      <MetricCard 
                        label="Hit @ k" 
                        target={data.retrieval.hit_at_k * 100} 
                        progress={metricsProgress} 
                        suffix="%" 
                        color="var(--sage-400)" 
                      />
                      <MetricCard 
                        label="MRR @ k" 
                        target={data.retrieval.mrr_at_k} 
                        progress={metricsProgress} 
                        decimals={3} 
                        color="var(--cyan-400)" 
                      />
                      <MetricCard 
                        label="Recall @ k" 
                        target={data.retrieval.recall_at_k * 100} 
                        progress={metricsProgress} 
                        suffix="%" 
                        color="var(--indigo-400)" 
                      />
                    </>
                  )}
                  {data.ragas && (
                    <>
                      <MetricCard 
                        label="Faithfulness" 
                        target={data.ragas.faithfulness * 100} 
                        progress={Math.max(0, metricsProgress - 0.2)} // stagger slightly
                        suffix="%" 
                        color="var(--amber-400)" 
                      />
                      <MetricCard 
                        label="Answer Relevancy" 
                        target={data.ragas.answer_relevancy * 100} 
                        progress={Math.max(0, metricsProgress - 0.3)} // stagger slightly
                        suffix="%" 
                        color="var(--rose-400)" 
                      />
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>

      </div>
    </div>
  )
}

function MetricCard({ label, target, progress, suffix = '', decimals = 0, color }: any) {
  // progress goes from 0 to 1.
  // We apply an ease-out curve to the numbers so they count up beautifully
  const easeOut = 1 - Math.pow(1 - progress, 3)
  const currentVal = target * easeOut

  return (
    <div 
      className="metric-card"
      style={{
        opacity: progress * 2, // fade in twice as fast as the numbers finish
        transform: `translateY(${(1 - progress) * 20}px)`,
        borderColor: `color-mix(in srgb, ${color} ${progress * 30}%, transparent)`
      }}
    >
      <div className="metric-value" style={{ color }}>
        {currentVal.toFixed(decimals)}{suffix}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  )
}
