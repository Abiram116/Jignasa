import { useEffect, useState } from 'react'
import { fetchEvaluationSummary } from './api'
import type { EvaluationSummaryResponse } from './types'
import { ScrollReveal, StaggerReveal } from './ScrollReveal'
import ScrollFloat from './ScrollFloat'
import CountUp from './CountUp'

type LoadState = 'loading' | 'ready' | 'empty' | 'error'

// Generous window: on a fresh `./run_all.sh` start, the backend is still
// importing heavy deps (docling, faiss, sentence-transformers) when the
// frontend's first fetch fires. A short retry window (the original 3x700ms
// = ~2s) wasn't enough to cover that cold start -- bumped once already to
// 12x1200ms (~14s), and confirmed (real user report on a slower machine)
// that STILL isn't always enough: a slower CPU/disk doing first-time
// PyTorch/Docling imports can take longer than either window. Bumped again
// to a genuinely generous ~40s initial burst, and -- more importantly --
// this no longer gives up permanently after that. See BACKGROUND_RETRY_MS
// below: once the initial burst is exhausted, it keeps trying quietly
// forever at a slower cadence, so the section self-heals the moment the
// backend actually comes up, with no page reload needed.
const RETRY_ATTEMPTS = 20
const RETRY_DELAY_MS = 2000
const BACKGROUND_RETRY_MS = 5000

// GitHub Pages showcase build (`VITE_STATIC_DEMO=true npm run build`) has
// no backend to fetch from -- it serves a frozen snapshot from the last
// real evaluation run instead (web/public/eval-snapshot.json). Local/Docker
// builds always fetch live from GET /api/evaluation/summary.
const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === 'true'

/**
 * Homepage section showing the project's actual measured quality, fetched
 * live from GET /api/evaluation/summary rather than hardcoded -- so it
 * reflects whatever was last actually run (see data/evaluations/README.md
 * for the full methodology and caveats).
 */
export function EvalResultsSection({ onLoaded }: { onLoaded?: () => void }) {
  const [data, setData] = useState<EvaluationSummaryResponse | null>(null)
  const [status, setStatus] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    if (STATIC_DEMO) {
      fetch(`${import.meta.env.BASE_URL}eval-snapshot.json`)
        .then((res) => res.json())
        .then((result: EvaluationSummaryResponse) => {
          if (cancelled) return
          setData(result)
          setStatus(result.retrieval || result.ragas ? 'ready' : 'empty')
          onLoaded?.()
        })
        .catch(() => {
          if (!cancelled) {
            setStatus('error')
            onLoaded?.()
          }
        })
      return () => {
        cancelled = true
      }
    }

    // Background retry: runs after the initial burst gives up, forever,
    // at a slower cadence -- doesn't call onLoaded() again (that already
    // fired once, unblocking the preloader) and doesn't touch `cancelled`
    // timing beyond checking it, so it can't re-block anything. Just
    // quietly updates the section in place the moment the backend
    // actually responds, instead of leaving a wrong "no results" message
    // on screen forever until the user manually reloads.
    const backgroundRetry = async (): Promise<void> => {
      if (cancelled) return
      await new Promise((r) => setTimeout(r, BACKGROUND_RETRY_MS))
      if (cancelled) return
      try {
        const result = await fetchEvaluationSummary()
        if (cancelled) return
        setData(result)
        setStatus(result.retrieval || result.ragas ? 'ready' : 'empty')
      } catch {
        if (!cancelled) await backgroundRetry()
      }
    }

    const attempt = async (attemptsLeft: number): Promise<void> => {
      try {
        const result = await fetchEvaluationSummary()
        if (cancelled) return
        setData(result)
        setStatus(result.retrieval || result.ragas ? 'ready' : 'empty')
        onLoaded?.()
      } catch {
        if (cancelled) return
        if (attemptsLeft > 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          if (!cancelled) await attempt(attemptsLeft - 1)
        } else {
          // Distinct from "empty" (genuinely no eval has ever been run) --
          // this means the backend never responded after ~40s of retries,
          // most likely still cold-starting on a slower machine. Keep
          // trying quietly in the background instead of giving up for good.
          setStatus('error')
          onLoaded?.()
          backgroundRetry()
        }
      }
    }

    attempt(RETRY_ATTEMPTS)
    return () => {
      cancelled = true
    }
  }, [])

  const hasRetrieval = !!data?.retrieval
  const hasRagas = !!data?.ragas

  return (
    <section className="eval-results-section">
      <p className="section-eyebrow">Quality</p>
      <ScrollFloat containerClassName="section-title">Measured against real questions</ScrollFloat>
      <p className="section-lead">
        Retrieval and generation are both benchmarked, not just assumed to work.
      </p>

      {status === 'loading' ? null : status === 'empty' ? (
        <ScrollReveal className="eval-empty-state">
          <p>No benchmark results recorded yet. Check back after the next evaluation run.</p>
        </ScrollReveal>
      ) : status === 'error' ? (
        <ScrollReveal className="eval-empty-state">
          <p>
            Still connecting to the backend — this section updates itself
            automatically once it's reachable, no need to reload.
          </p>
        </ScrollReveal>
      ) : (
        <div className="eval-results-groups">
          {hasRetrieval && data!.retrieval && (
            <StaggerReveal
              className="eval-stat-row"
              staggerMs={70}
              items={[
                { key: 'hit', label: 'Hit @ k', value: data!.retrieval.hit_at_k * 100, decimals: 0, suffix: '%', color: 'var(--sage-400)' },
                { key: 'mrr', label: 'MRR @ k', value: data!.retrieval.mrr_at_k, decimals: 3, suffix: '', color: 'var(--cyan-400)' },
                { key: 'recall', label: 'Recall @ k', value: data!.retrieval.recall_at_k * 100, decimals: 0, suffix: '%', color: 'var(--indigo-400)' },
              ]}
              renderItem={(m) => (
                <>
                  <div className="eval-stat-value" style={{ color: m.color }}>
                    <CountUp to={m.value} decimals={m.decimals} startDelay={500} />{m.suffix}
                  </div>
                  <div className="eval-stat-label">{m.label}</div>
                </>
              )}
              itemClassName="eval-stat"
            />
          )}

          {hasRagas && data!.ragas && (
            <>
              <StaggerReveal
                className="eval-stat-row"
                staggerMs={70}
                items={[
                  { key: 'faith', label: 'Faithfulness', value: data!.ragas.faithfulness, decimals: 3, color: 'var(--ember-400)' },
                  { key: 'relevancy', label: 'Answer relevancy', value: data!.ragas.answer_relevancy, decimals: 3, color: 'var(--violet-400)' },
                  { key: 'precision', label: 'Context precision', value: data!.ragas.context_precision, decimals: 3, color: 'var(--rose-400)' },
                  { key: 'recall', label: 'Context recall', value: data!.ragas.context_recall, decimals: 3, color: 'var(--sage-400)' },
                ]}
                renderItem={(m) => (
                  <>
                    <div className="eval-stat-value" style={{ color: m.color }}>
                      <CountUp to={m.value} decimals={m.decimals} />
                    </div>
                    <div className="eval-stat-label">{m.label}</div>
                  </>
                )}
                itemClassName="eval-stat"
              />
              <p className="eval-meta">
                Judged locally by {data!.ragas.judge_llm} ({data!.ragas.question_count} questions). Local-judge
                scores are directional, not a universal benchmark.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
