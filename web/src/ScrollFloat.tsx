// Adapted from react-bits (https://github.com/DavidHDev/react-bits), TS-CSS
// variant, ScrollFloat component. MIT+Commons Clause licensed.
//
// Why this is lower-risk than the GSAP pin pattern that broke the pipeline
// section earlier: this uses `scrub: true` tied to the element's OWN scroll
// progress through the viewport, not `pin: true` with an endTrigger handed
// off to a different element. It never reserves/un-reserves layout space,
// so there's no equivalent failure mode for blank gaps.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { isLowPowerDevice, subscribeLowPowerDevice } from './deviceTier'
import './ScrollFloat.css'

interface ScrollFloatProps {
  children: string
  as?: 'h2' | 'h3'
  containerClassName?: string
  stagger?: number
}

const MOTION_TAG = { h2: motion.h2, h3: motion.h3 }

export default function ScrollFloat({ children, as = 'h2', containerClassName = '', stagger = 0.025 }: ScrollFloatProps) {
  const containerRef = useRef<HTMLHeadingElement>(null)
  // Starts as the fast static-heuristic guess, then updates (re-rendering,
  // and tearing down any active GSAP tween via the effect below) once the
  // real frame-rate measurement resolves a few hundred ms after load --
  // see deviceTier.ts for why a one-time guess at mount isn't enough.
  const [lowPower, setLowPower] = useState(() => isLowPowerDevice())
  useEffect(() => subscribeLowPowerDevice(setLowPower), [])

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
    // Skip the whole per-character GSAP scrub setup on weaker hardware --
    // not just lighter, but a different code path entirely: no GSAP
    // bundle import/execution, no dozens of individually-tweened+layered
    // characters, no scroll-tick recalculation. Falls back to the single
    // whileInView fade rendered below instead.
    if (lowPower) return

    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let cleanup = () => {}

    import('gsap').then(async ({ gsap }) => {
      if (cancelled) return
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      // Wait for web fonts before measuring -- ScrollTrigger reads the
      // element's position/size at creation time. If a custom font (e.g.
      // Fraunces/Outfit) finishes loading and reflows the heading *after*
      // that measurement, the trigger's start/end bounds go stale: the
      // scrub animation maps to the wrong scroll range and most characters
      // never reach their "revealed" state, which is what showed up as
      // headings rendering as just one or two stray letters. This only
      // happened intermittently because it's a race against font load
      // time, which varies by network/device speed.
      if (document.fonts?.ready) {
        await document.fonts.ready
      }
      if (cancelled) return

      const chars = el.querySelectorAll('.sf-char')
      // will-change is applied/removed here (not as a permanent CSS rule)
      // so each character is only a separate GPU-promoted layer while its
      // reveal is actually active. Left on permanently, every heading on
      // the page keeps dozens of small layers alive for as long as the
      // page is open -- a real cost on weaker mobile GPUs, compounding
      // with everything else animating (the canvas star field, ambient
      // orbs, Lenis/ScrollTrigger scroll updates) into visible jank.
      const promote = () => gsap.set(chars, { willChange: 'transform, opacity' })
      const demote = () => gsap.set(chars, { willChange: 'auto' })

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
            onEnter: promote,
            onEnterBack: promote,
            onLeave: demote,
            onLeaveBack: demote,
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
  }, [stagger, lowPower])

  if (lowPower) {
    const MotionTag = MOTION_TAG[as]
    return (
      <MotionTag
        className={`scroll-float ${containerClassName}`}
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.5 }}
      >
        {children}
      </MotionTag>
    )
  }

  const Tag = as
  return (
    <Tag ref={containerRef} className={`scroll-float ${containerClassName}`}>
      {splitText}
    </Tag>
  )
}
