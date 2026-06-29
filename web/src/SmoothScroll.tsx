import { useEffect } from 'react'
import Lenis from 'lenis'

/**
 * Global smooth-scroll for the homepage, bound to native window scroll
 * (Lenis has no `wrapper` option set, so it defaults to window -- this
 * also lets Motion's `whileInView` triggers, which watch the real window
 * scroll, fire correctly). This is the standard GSAP+Lenis integration:
 * Lenis drives the scroll physics, GSAP's ticker drives Lenis's RAF loop,
 * and ScrollTrigger is told to recompute on every Lenis scroll tick.
 *
 * Also refreshes ScrollTrigger on window resize. This matters specifically
 * on mobile: Chrome/Safari's address bar collapsing and expanding as you
 * scroll changes the viewport height without a page reload, which can
 * leave ScrollTrigger holding stale trigger positions mid-session --
 * visible as a blank gap at the bottom of the page that "snaps" back to
 * normal once something forces a recalculation.
 *
 * Mounted once at the top of HomePage; destroyed on unmount (leaving /chat
 * on native scroll, untouched).
 */
export function SmoothScroll() {

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('#root')
    if (!root) return

    let lenis: Lenis | null = null
    let cancelled = false
    let tick: ((time: number) => void) | null = null
    let handleResize: (() => void) | null = null

    const lenisInstance = new Lenis({
      duration: 1.1,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 2,
      wheelMultiplier: 1,
      lerp: 0.1
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

      handleResize = () => ScrollTrigger.refresh()
      window.addEventListener('resize', handleResize)
    })

    return () => {
      cancelled = true
      if (tick) {
        import('gsap').then(({ gsap }) => gsap.ticker.remove(tick!))
      }
      if (handleResize) {
        window.removeEventListener('resize', handleResize)
      }
      lenis?.destroy()
    }
  }, [])

  return null
}
