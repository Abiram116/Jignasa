// Originally adapted from react-bits CountUp (spring-based). Rewritten as a
// stepped "odometer" count instead: big jumps early (0, 10, 20, 30...) that
// settle into single-unit increments for the last ~20% as it nears the
// target -- a smooth spring doesn't read as "counting," discrete ticks do.
//
// startDelay: ms to wait after entering view before starting the count.
// This matters when the CountUp is wrapped in a Framer Motion whileInView
// reveal: without the delay the count finishes before opacity reaches 1.
import { useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  to: number
  from?: number
  duration?: number
  startDelay?: number
  className?: string
  decimals?: number
}

const COARSE_STEPS = 8
const COARSE_FRACTION = 0.8
const COARSE_TIME_SHARE = 0.45

export default function CountUp({ to, from = 0, duration = 1.8, startDelay = 350, className = '', decimals }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const [isInView, setIsInView] = useState(false)

  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px -5% 0px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const maxDecimals = decimals ?? (() => {
    const str = to.toString()
    return str.includes('.') ? str.split('.')[1].length : 0
  })()

  useEffect(() => {
    if (!ref.current) return
    ref.current.textContent = (from).toFixed(maxDecimals)
  }, [from, maxDecimals])

  useEffect(() => {
    if (!isInView || !ref.current) return
    const el = ref.current

    if (reduce) {
      el.textContent = to.toFixed(maxDecimals)
      return
    }

    const range = to - from
    const coarseEnd = from + range * COARSE_FRACTION
    const unit = Math.pow(10, -maxDecimals)
    const fineSteps = Math.max(1, Math.round((to - coarseEnd) / unit))

    const coarseDuration = duration * 1000 * COARSE_TIME_SHARE
    const fineDuration = duration * 1000 * (1 - COARSE_TIME_SHARE)

    let raf: number
    let timeoutId: ReturnType<typeof setTimeout>

    const runAnimation = () => {
      const start = performance.now()

      const tick = (now: number) => {
        const elapsed = now - start

        if (elapsed < coarseDuration) {
          const progress = elapsed / coarseDuration
          const stepIndex = Math.min(COARSE_STEPS, Math.floor(progress * COARSE_STEPS))
          const value = from + (coarseEnd - from) * (stepIndex / COARSE_STEPS)
          el.textContent = value.toFixed(maxDecimals)
          raf = requestAnimationFrame(tick)
          return
        }

        const fineElapsed = elapsed - coarseDuration
        if (fineElapsed >= fineDuration) {
          el.textContent = to.toFixed(maxDecimals)
          return
        }

        const fineProgress = fineElapsed / fineDuration
        const stepIndex = Math.min(fineSteps, Math.floor(fineProgress * fineSteps))
        const value = coarseEnd + stepIndex * unit
        el.textContent = Math.min(value, to).toFixed(maxDecimals)
        raf = requestAnimationFrame(tick)
      }

      raf = requestAnimationFrame(tick)
    }

    timeoutId = setTimeout(runAnimation, startDelay)
    return () => {
      clearTimeout(timeoutId)
      cancelAnimationFrame(raf)
    }
  }, [isInView, reduce, from, to, duration, maxDecimals, startDelay])

  return <span className={className} ref={ref} />
}
