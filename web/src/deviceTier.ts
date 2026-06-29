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

function measureFrameRate(durationMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') {
      resolve(false)
      return
    }
    let frames = 0
    const start = performance.now()
    const tick = () => {
      frames++
      const elapsed = performance.now() - start
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

function start() {
  if (started) return
  started = true

  if (staticHeuristic()) {
    notify(true)
    return
  }
  measureFrameRate().then(notify)
}

/** Synchronous best-guess: the static heuristic until the real frame-rate
 * measurement resolves (~600ms after first call), then the measured result. */
export function isLowPowerDevice(): boolean {
  start()
  return resolved ?? staticHeuristic()
}

/** Subscribes to the eventual measured result. Calls back immediately with
 * the current best guess, then again once (if) the measurement changes it. */
export function subscribeLowPowerDevice(listener: Listener): () => void {
  start()
  listeners.push(listener)
  if (resolved !== null) listener(resolved)
  return () => {
    const i = listeners.indexOf(listener)
    if (i >= 0) listeners.splice(i, 1)
  }
}
