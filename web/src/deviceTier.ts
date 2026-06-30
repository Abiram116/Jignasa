/**
 * Detects whether this device should get the cheaper rendering path for
 * purely decorative animation (fewer canvas particles, no per-character
 * GSAP scrub, frozen ambient backgrounds) -- never content or correctness.
 *
 * Why this isn't just navigator.hardwareConcurrency/deviceMemory: CPU core
 * count measures parallelism, not single-core or GPU speed. A budget
 * "octa-core" phone commonly pairs 8 CPU cores with a much weaker GPU than
 * a flagship's -- core count alone doesn't catch it. There's no browser
 * API that reports GPU tier directly, so instead this measures actual
 * frame rate for a short window right after load: a direct measurement of
 * the real bottleneck (rendering/compositing speed), not a guess from
 * declared hardware specs that can be misleading.
 *
 * The hardwareConcurrency/deviceMemory check still runs first as a fast,
 * free pre-filter -- it catches genuinely ancient/low-spec devices
 * instantly, before spending even one frame on measurement. The FPS
 * sample is the authoritative signal for everything else, including
 * "many cores, weak GPU" devices the static check would miss.
 */

type Listener = (lowPower: boolean) => void

let resolved: boolean | null = null
let started = false
const listeners: Listener[] = []

function staticHeuristic(): boolean {
  if (typeof navigator === 'undefined') return false

  const cores = navigator.hardwareConcurrency
  if (typeof cores === 'number' && cores > 0 && cores <= 4) return true

  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof memory === 'number' && memory <= 4) return true

  return false
}

function measureFrameRate(durationMs = 600, warmupFrames = 10): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      resolve(false)
      return
    }
    let warmup = 0
    let frames = 0
    let start = 0
    const tick = (now: number) => {
      // Discard the first several frames before timing anything -- a rAF
      // loop's own first callbacks are irregular on essentially every
      // device (still settling into the browser's steady frame cadence),
      // so counting them in would bias the result low independent of
      // actual hardware capability.
      if (warmup < warmupFrames) {
        warmup++
        if (warmup === warmupFrames) start = now
        requestAnimationFrame(tick)
        return
      }
      frames++
      const elapsed = now - start
      if (elapsed < durationMs) {
        requestAnimationFrame(tick)
      } else {
        const fps = frames / (elapsed / 1000)
        // A healthy device sustains close to 60fps even doing nothing
        // special yet. Comfortably below that during this idle sample
        // (not even under animation load) is a strong signal the device
        // will struggle once real animation work is added on top.
        resolve(fps < 45)
      }
    }
    requestAnimationFrame(tick)
  })
}

function notify(value: boolean) {
  resolved = value
  for (const listener of listeners) listener(value)
}

/** Waits for the page to be reasonably settled before measuring -- running
 * the sample during initial page load (fonts loading, GSAP/Lenis dynamic
 * imports, React still rendering the rest of the tree, the canvas star
 * field initializing) measures that startup contention, not steady-state
 * rendering performance, and produces false positives on capable devices
 * (confirmed: a flagship Android phone in Chrome was being flagged
 * low-power purely from measurement timing, not actual hardware limits). */
function waitForIdlePeriod(): Promise<void> {
  return new Promise((resolveIdle) => {
    const afterLoad = () => {
      const ric = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback
      if (ric) {
        ric(() => resolveIdle(), { timeout: 1500 })
      } else {
        // Safari has no requestIdleCallback -- a fixed delay after load is
        // the next best thing.
        setTimeout(resolveIdle, 800)
      }
    }
    if (document.readyState === 'complete') {
      afterLoad()
    } else {
      window.addEventListener('load', afterLoad, { once: true })
    }
  })
}

async function start() {
  if (started) return
  started = true

  if (staticHeuristic()) {
    notify(true)
    return
  }
  await waitForIdlePeriod()
  const lowPower = await measureFrameRate()
  notify(lowPower)
}

/** Synchronous best-guess: the static heuristic until the real frame-rate
 * measurement resolves (~600ms after first call), then the measured result. */
export function isLowPowerDevice(): boolean {
  void start()
  return resolved ?? staticHeuristic()
}

/** Subscribes to the eventual measured result. Calls back immediately with
 * the current best guess, then again once (if) the measurement changes it. */
export function subscribeLowPowerDevice(listener: Listener): () => void {
  void start()
  listeners.push(listener)
  if (resolved !== null) listener(resolved)
  return () => {
    const i = listeners.indexOf(listener)
    if (i >= 0) listeners.splice(i, 1)
  }
}
