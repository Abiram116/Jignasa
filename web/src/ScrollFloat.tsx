// Adapted from react-bits (https://github.com/DavidHDev/react-bits), TS-CSS
// variant, ScrollFloat component. MIT+Commons Clause licensed.
//
// Why this is lower-risk than the GSAP pin pattern that broke the pipeline
// section earlier: this uses `scrub: true` tied to the element's OWN scroll
// progress through the viewport, not `pin: true` with an endTrigger handed
// off to a different element. It never reserves/un-reserves layout space,
// so there's no equivalent failure mode for blank gaps.
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import './ScrollFloat.css'

interface ScrollFloatProps {
  children: string
  as?: 'h2' | 'h3'
  containerClassName?: string
  stagger?: number
}

export default function ScrollFloat({ children, as = 'h2', containerClassName = '', stagger = 0.025 }: ScrollFloatProps) {
  const containerRef = useRef<HTMLHeadingElement>(null)

  const splitText = useMemo<ReactNode>(
    () =>
      children.split(' ').map((word, wordIndex, wordsArray) => (
        <span className="sf-word" key={wordIndex} style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
          {word.split('').map((char, charIndex) => (
            <span className="sf-char" key={charIndex} style={{ display: 'inline-block' }}>
              {char}
            </span>
          ))}
          {wordIndex < wordsArray.length - 1 && (
            <span className="sf-char" style={{ display: 'inline-block' }}>&nbsp;</span>
          )}
        </span>
      )),
    [children],
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let cleanup = () => {}

    import('gsap').then(async ({ gsap }) => {
      if (cancelled) return
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      const chars = el.querySelectorAll('.sf-char')
      const tween = gsap.fromTo(
        chars,
        { opacity: 0, yPercent: 80, scaleY: 1.6, scaleX: 0.85, transformOrigin: '50% 100%' },
        {
          opacity: 1,
          yPercent: 0,
          scaleY: 1,
          scaleX: 1,
          duration: 1,
          ease: 'back.out(1.7)',
          stagger,
          scrollTrigger: {
            trigger: el,
            start: 'top bottom-=10%',
            end: 'bottom center',
            scrub: true,
          },
        },
      )

      cleanup = () => {
        tween.scrollTrigger?.kill()
        tween.kill()
      }
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [reduce, stagger])

  const Tag = as
  return (
    <Tag ref={containerRef} className={`scroll-float ${containerClassName}`}>
      {splitText}
    </Tag>
  )
}
