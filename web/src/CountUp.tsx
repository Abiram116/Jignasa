import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'

function useRootRef() {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    ref.current = document.querySelector<HTMLElement>('#root')
  }, [])
  return ref
}

interface CountUpProps {
  to: number
  from?: number
  duration?: number
  startDelay?: number
  className?: string
  decimals?: number
}

export default function CountUp({
  to,
  from = 0,
  duration = 2.5, // nice slow smooth duration
  startDelay = 400,
  className = '',
  decimals,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const rootRef = useRootRef()
  const reduce = useReducedMotion()
  
  // Must use rootRef so it correctly observes the #root scroll container,
  // rather than the window viewport (which never scrolls).
  const isInView = useInView(ref, { once: true, amount: 0.1, root: rootRef })

  const maxDecimals = decimals ?? (() => {
    const str = to.toString()
    return str.includes('.') ? str.split('.')[1].length : 0
  })()

  // Set initial display value immediately
  useEffect(() => {
    if (ref.current) ref.current.textContent = from.toFixed(maxDecimals)
  }, [from, maxDecimals])

  // Run the smooth count animation once in view
  useEffect(() => {
    if (!isInView || !ref.current) return
    const el = ref.current

    if (reduce) {
      el.textContent = to.toFixed(maxDecimals)
      return
    }

    const timeoutId = setTimeout(() => {
      // Use Framer Motion's animate function for a buttery smooth ease-out
      animate(from, to, {
        duration,
        ease: 'easeOut',
        onUpdate: (value) => {
          if (el) el.textContent = value.toFixed(maxDecimals)
        },
      })
    }, startDelay)

    return () => clearTimeout(timeoutId)
  }, [isInView, reduce, from, to, duration, maxDecimals, startDelay])

  return <span className={className} ref={ref} />
}
