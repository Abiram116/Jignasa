import { animate, useInView, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'


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
  const reduce = useReducedMotion()
  
  // Use standard viewport intersection
  const isInView = useInView(ref, { once: true, amount: 0.1 })

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
