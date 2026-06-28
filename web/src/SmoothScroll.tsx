import { useEffect } from 'react'
import { useReducedMotion } from 'motion/react'
import Lenis from 'lenis'

/**
 * Global smooth-scroll for the homepage, bound to the real scroll
 * container (#root -- body has overflow:hidden, see ScrollFloat.tsx for
 * why that matters). This is the standard GSAP+Lenis integration: Lenis
 * drives the scroll physics, GSAP's ticker drives Lenis's RAF loop, and
 * ScrollTrigger is told to recompute on every Lenis scroll tick. Any
 * ScrollTrigger elsewhere on the page (ScrollFloat headings) that points
 * `scroller: '#root'` automatically stays in sync with this -- no per
 * component smooth-scroll setup needed.
 *
 * Mounted once at the top of HomePage; destroyed on unmount (leaving /chat
 * on native scroll, untouched).
 */
export function SmoothScroll() {
  const reduce = useReducedMotion()

  useEffect(() => {
    if (reduce) return
    const root = document.querySelector<HTMLElement>('#root')
    if (!root) return

    let lenis: Lenis | null = null
    let cancelled = false
    let tick: ((time: number) => void) | null = null

    const lenisInstance = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 2,
      wheelMultiplier: 1,
      lerp: 0.1,
      syncTouch: true,
      syncTouchLerp: 0.075,
    })
    lenis = lenisInstance

    import('gsap').then(async ({ gsap }) => {
      if (cancelled) {
        lenisInstance.destroy()
        return
      }
      const { ScrollTrigger } = await import('gsap/ScrollTrigger')
      gsap.registerPlugin(ScrollTrigger)

      lenisInstance.on('scroll', ScrollTrigger.update)
      tick = (time: number) => lenisInstance.raf(time * 1000)
      gsap.ticker.add(tick)
      gsap.ticker.lagSmoothing(0)
    })

    return () => {
      cancelled = true
      if (tick) {
        import('gsap').then(({ gsap }) => gsap.ticker.remove(tick!))
      }
      lenis?.destroy()
    }
  }, [reduce])

  return null
}
