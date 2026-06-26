import { motion, useReducedMotion } from 'motion/react'

interface Step {
  title: string
  desc: string
  tags: string[]
  color: string
}

/**
 * Isolated motion leaf component. Originally used a GSAP ScrollTrigger pin
 * (the canonical sticky-stack skeleton), but that pattern pins each card
 * until the LAST card arrives -- fine for short 100dvh-tall cards, but with
 * these taller multi-line steps it left a large blank gap between the
 * pinned card and the next one's natural document position. Replaced with
 * a simpler, layout-safe alternative: each step alternates left/right
 * (zigzag) and scales+slides in from its own side on scroll-into-view via
 * Motion's whileInView -- no position:fixed/pin math, so no layout-gap
 * failure mode, while still reading as a confident, sequential reveal.
 */
export function StickyPipeline({ steps }: { steps: Step[] }) {
  const reduce = useReducedMotion()

  return (
    <div className="steps-list">
      {steps.map((s, i) => {
        const fromSide = i % 2 === 0 ? -40 : 40
        const content = (
          <>
            <div className="step-glow" style={{ background: `radial-gradient(circle, ${s.color}22 0%, transparent 70%)` }} />
            <div className="step-num-big" style={{ color: s.color, textShadow: `0 0 30px ${s.color}55` }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div className="step-content">
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              <div className="step-tags">
                {s.tags.map((tag) => (
                  <span className="step-tag" key={tag} style={{ borderColor: `${s.color}33`, color: s.color }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </>
        )

        if (reduce) {
          return <div className={`step-item step-item-${i % 2 === 0 ? 'left' : 'right'}`} key={s.title}>{content}</div>
        }

        return (
          <motion.div
            className={`step-item step-item-${i % 2 === 0 ? 'left' : 'right'}`}
            key={s.title}
            initial={{ opacity: 0, x: fromSide, scale: 0.96 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            {content}
          </motion.div>
        )
      })}
    </div>
  )
}
