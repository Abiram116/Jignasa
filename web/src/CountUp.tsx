// Stepped odometer count: big jumps early, fine ticks for last 20%.
// Key fix: IntersectionObserver uses #root as its root (not the viewport)
// because #root is the scroll container — the viewport never scrolls.
// startDelay gives Framer Motion's whileInView reveal time to show the
// element before the count starts (otherwise it counts while opacity=0).
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

export default function CountUp({
  to,
  from = 0,
  duration = 1.8,
  startDelay = 400,
  className = '',
  decimals,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  const [isInView, setIsInView] = useState(false)

  const maxDecimals = decimals ?? (() => {
    const str = to.toString()
    return str.includes('.') ? str.split('.')[1].length : 0
  })()

  // Set initial display value
  useEffect(() => {
    if (ref.current) ref.current.textContent = from.toFixed(maxDecimals)
  }, [from, maxDecimals])

  // Use #root as scroll root so IntersectionObserver fires correctly
  // when #root scrolls (not the window/viewport)
  useEffect(() => {
    if (!ref.current) return

    const scrollRoot = document.querySelector<HTMLElement>('#root')

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      {
        root: scrollRoot ?? null,
        threshold: 0.1,
        rootMargin: '0px',
      },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  // Run the count animation once in view
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
    const timeoutId = setTimeout(() => {
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
    }, startDelay)

    return () => {
      clearTimeout(timeoutId)
      cancelAnimationFrame(raf)
    }
  }, [isInView, reduce, from, to, duration, maxDecimals, startDelay])

  return <span className={className} ref={ref} />
}
