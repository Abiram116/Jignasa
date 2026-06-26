// Adapted (heavily trimmed) from react-bits MagicBento
// (https://github.com/DavidHDev/react-bits), MIT+Commons Clause licensed.
// Dropped the particle/tilt/magnetism/click-ripple pieces from the original
// (high complexity, low payoff for a content grid that isn't a generic demo
// card) and kept just the two effects that read as "magic bento" at a
// glance: a cursor-following spotlight glow, and a border that lights up
// near the cursor. Plain CSS transitions for the spotlight movement
// (no GSAP/Motion needed here -- this is mouse-driven, not scroll-driven,
// so none of the scroll-pin risk from elsewhere applies).
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

const SPOTLIGHT_RADIUS = 320
const GLOW_COLOR = '99, 102, 241' // --indigo-500

export function MagicBentoGlow({ gridSelector }: { gridSelector: string }) {
  const spotlightRef = useRef<HTMLDivElement | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const grid = document.querySelector(gridSelector)
    if (!grid) return

    const spotlight = document.createElement('div')
    spotlight.className = 'bento-global-spotlight'
    document.body.appendChild(spotlight)
    spotlightRef.current = spotlight

    const proximity = SPOTLIGHT_RADIUS * 0.5
    const fadeDistance = SPOTLIGHT_RADIUS * 0.75

    const handleMouseMove = (e: MouseEvent) => {
      const rect = grid.getBoundingClientRect()
      const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      const cards = grid.querySelectorAll<HTMLElement>('.feature-card')

      if (!inside) {
        spotlight.style.opacity = '0'
        cards.forEach((c) => c.style.setProperty('--glow-intensity', '0'))
        return
      }

      let minDistance = Infinity
      cards.forEach((card) => {
        const cardRect = card.getBoundingClientRect()
        const cx = cardRect.left + cardRect.width / 2
        const cy = cardRect.top + cardRect.height / 2
        const distance = Math.max(0, Math.hypot(e.clientX - cx, e.clientY - cy) - Math.max(cardRect.width, cardRect.height) / 2)
        minDistance = Math.min(minDistance, distance)

        let intensity = 0
        if (distance <= proximity) intensity = 1
        else if (distance <= fadeDistance) intensity = (fadeDistance - distance) / (fadeDistance - proximity)

        const relX = ((e.clientX - cardRect.left) / cardRect.width) * 100
        const relY = ((e.clientY - cardRect.top) / cardRect.height) * 100
        card.style.setProperty('--glow-x', `${relX}%`)
        card.style.setProperty('--glow-y', `${relY}%`)
        card.style.setProperty('--glow-intensity', String(intensity))
      })

      spotlight.style.left = `${e.clientX}px`
      spotlight.style.top = `${e.clientY}px`
      spotlight.style.opacity = String(
        minDistance <= proximity ? 0.6 : minDistance <= fadeDistance ? ((fadeDistance - minDistance) / (fadeDistance - proximity)) * 0.6 : 0,
      )
    }

    const handleLeave = () => {
      spotlight.style.opacity = '0'
      grid.querySelectorAll<HTMLElement>('.feature-card').forEach((c) => c.style.setProperty('--glow-intensity', '0'))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseleave', handleLeave)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleLeave)
      spotlight.remove()
    }
  }, [gridSelector, reduce])

  return null
}

export const BENTO_GLOW_COLOR = GLOW_COLOR
