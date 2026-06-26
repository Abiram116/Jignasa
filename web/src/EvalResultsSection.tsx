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
// = ~2s) isn't enough to cover that cold start, which is exactly why this
// only failed on the very first load after starting the server and never
// after a reload (by then the backend was already up).
const RETRY_ATTEMPTS = 12
const RETRY_DELAY_MS = 1200

/**
 * Homepage section showing the project's actual measured quality, fetched
 * live from GET /api/evaluation/summary rather than hardcoded -- so it
 * reflects whatever was last actually run (see data/evaluations/README.md
 * for the full methodology and caveats).
 */
export function EvalResultsSection() {
  const [data, setData] = useState<EvaluationSummaryResponse | null>(null)
  const [status, setStatus] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    const attempt = async (attemptsLeft: number): Promise<void> => {
      try {
        const result = await fetchEvaluationSummary()
        if (cancelled) return
        setData(result)
        setStatus(result.retrieval || result.ragas ? 'ready' : 'empty')
      } catch {
        if (cancelled) return
        if (attemptsLeft > 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
          if (!cancelled) await attempt(attemptsLeft - 1)
        } else {
          setStatus('error')
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

      {status === 'loading' ? null : status === 'empty' || status === 'error' ? (
        <ScrollReveal className="eval-empty-state">
          <p>No benchmark results recorded yet. Check back after the next evaluation run.</p>
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
