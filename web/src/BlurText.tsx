// Adapted from react-bits (https://github.com/DavidHDev/react-bits), TS-CSS
// variant, BlurText component. MIT+Commons Clause licensed. Pure Motion
// (no GSAP). Changed from the original: renders inline (`as` prop, default
// `span`) instead of always wrapping in a `<p>`, so it can nest inside
// existing headline/emphasis markup instead of replacing it.
//
// `trigger="mount"` (default) plays immediately on mount -- correct for a
// "welcome" animation on above-the-fold content, which is visible
// immediately and was never going to be scrolled into view in the first
// place. `trigger="view"` keeps the old scroll-into-view gate via
// IntersectionObserver for below-the-fold usage.
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'

interface BlurTextProps {
  text: string
  as?: 'span' | 'div'
  className?: string
  delay?: number
  startDelay?: number
  animateBy?: 'words' | 'letters'
  direction?: 'top' | 'bottom'
  trigger?: 'mount' | 'view'
}

export default function BlurText({
  text,
  as = 'span',
  className = '',
  delay = 60,
  startDelay = 0,
  animateBy = 'words',
  direction = 'top',
  trigger = 'mount',
}: BlurTextProps) {
  const reduce = useReducedMotion()
  const elements = useMemo(() => (animateBy === 'words' ? text.split(' ') : text.split('')), [text, animateBy])
  const [inView, setInView] = useState(trigger === 'mount')
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    if (trigger !== 'view' || !ref.current || reduce) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [reduce, trigger])

  const from = direction === 'top' ? { filter: 'blur(14px)', opacity: 0, y: -36 } : { filter: 'blur(14px)', opacity: 0, y: 36 }
  const to = { filter: 'blur(0px)', opacity: 1, y: 0 }

  const Tag = motion[as]

  if (reduce) {
    return <Tag className={className}>{text}</Tag>
  }

  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={className} style={{ display: as === 'div' ? 'flex' : 'inline-flex', flexWrap: 'wrap' }}>
      {elements.map((segment, index) => (
        <motion.span
          key={index}
          initial={from}
          animate={inView ? to : from}
          transition={{ duration: 0.9, delay: (startDelay + index * delay) / 1000, ease: [0.16, 1, 0.3, 1] }}
          style={{ display: 'inline-block', willChange: 'transform, filter, opacity' }}
        >
          {segment}
          {animateBy === 'words' && index < elements.length - 1 ? ' ' : ''}
        </motion.span>
      ))}
    </Tag>
  )
}
