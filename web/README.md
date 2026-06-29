# Jignasa frontend — design system & component guide

React 19 + TypeScript + Vite. Plain CSS (`src/index.css`), no Tailwind. This
file documents the actual design decisions in the code — colors, type,
motion — not a generic template README (replaced the default Vite one).

## Typography

| Role | Font | Where |
|---|---|---|
| Body / chat UI | **Inter** | `body`, default throughout the chat app — neutral, dense-UI-appropriate |
| Headlines / display | **Fraunces** (variable serif) | Homepage hero, section titles, manifesto — the one distinctive display face, used deliberately rather than the default Inter/Outfit everywhere |
| UI labels / buttons | **Outfit** | Sidebar brand, mode badges, smaller UI chrome |
| The Devanagari "जिज्ञासा" | **Noto Serif Devanagari** | Manifesto signature section only — split into its own `<span>` so it gets a font that actually has Devanagari glyphs, rather than silently falling back to whatever the OS ships (the original bug: it was set to `Outfit`, a Latin-only font) |

All four loaded via one Google Fonts `@import` in `index.css` (line 9).

## Color palette

Dark theme. Base is lifted slightly off pure-black (`#07090f`, not `#000000`)
specifically to read as "deep dark" rather than harsh near-black — see the
comment directly above `:root` in `index.css`.

**Backgrounds** (darkest → lightest): `--void #07090f` → `--cosmos #0b0f1a` →
`--deep #0f1420` → `--surface #141925` → `--raised #1a2133` → `--hover #1f2840`

**Accents** — each color is assigned a *meaning*, not picked decoratively:

| Token | Hex | Meaning |
|---|---|---|
| `--indigo-500` | `#6366f1` | Agent intelligence (primary brand color, CTAs) |
| `--ember-500` | `#f59e0b` | Warmth / curiosity (the "seeker" motif, manifesto accent) |
| `--sage-500` | `#10b981` | Retrieval success |
| `--coral-500` | `#f43f5e` | Web search |
| `--cyan-400` | `#22d3ee` | Live/real-time data |
| `--violet-400` | `#a78bfa` | Privacy / local-only |
| `--rose-400` | `#fb7185` | Caching / speed |

Text hierarchy: `--text-1 #f8f9ff` (brightest) down to `--text-4 #556080`
(dimmest), four steps. Borders are translucent white at increasing opacity
(`--border-1` through `--border-3`, 4%/8%/14%), not separate gray hexes.

A subtle SVG-noise grain layer sits on `body::before` (fixed,
`pointer-events: none`) so the dark base reads as textured depth rather
than a flat fill — see the `redesign-existing-projects` skill's
anti-flat-design guidance if you're wondering why it's there.

## Motion stack

| Library | Used for | Why this one |
|---|---|---|
| `motion` (the React-first successor to Framer Motion) | Component-level enter/hover/stagger animations | First-class React API, used for `BlurText`, `CountUp`, `ScrollReveal`/`StaggerReveal`, `ShinyText`, `MagicBentoGlow`'s reduced-motion check |
| `gsap` + `ScrollTrigger` | Scroll-position-driven reveals | `ScrollFloat` (section headings float in as you scroll to them) |
| `lenis` | Smooth-scroll physics | `SmoothScroll.tsx` — drives GSAP's ticker so `ScrollTrigger` and the smoothed scroll stay in sync |

**Scroll container history, since this flip-flopped more than once**: an
earlier version locked `#root` as its own `overflow: auto` container
(with `body` set to `overflow: hidden`) so the chat page's fixed-viewport
layout would work, and every scroll library had to be explicitly pointed
at `#root` instead of the default `window` — a real, reproducible bug,
not a precaution, since GSAP `ScrollTrigger`/Lenis silently never fire if
they're listening to the wrong scroller. That lock was later **removed**
(it was homepage-only baggage that broke Motion's `whileInView` triggers
on desktop mouse-wheel scroll) — the homepage now scrolls on native
`window`, and Lenis/`ScrollTrigger` both default to `window` too, so they
agree without any explicit scoping. If you're debugging a "scroll
animation never fires" bug here again, confirm which scroller each
library actually targets before assuming `#root` is still the answer —
it was, then it wasn't.

**Font-load race in `ScrollFloat`**: `ScrollTrigger` measures its
element's position once, at creation time. If a custom font (Fraunces/
Outfit) finishes loading and reflows the heading *after* that
measurement, the trigger's start/end bounds go stale — the scrub
animation maps to the wrong scroll range and most characters never reach
their "revealed" state. Visually this showed up as a heading rendering as
just one or two stray letters, and only intermittently, since it's a race
against font-load time. Fixed by gating creation on `document.fonts.ready`.

All motion respects `prefers-reduced-motion` — either via `motion`'s
`useReducedMotion()` hook or an explicit check, never assumed away.

## Homepage components (`src/HomePage.tsx` and friends)

| Component | What it does |
|---|---|
| `PreLoader.tsx` | Blocks the initial reveal until the backend connection *and* eval data are both confirmed ready (`isAppReady`), then plays a sweeping color-layer wipe + spinner-to-checkmark + circular-mask reveal. Exists specifically to remove a race condition that used to show "no evaluation results" on the very first load after starting the server. |
| `TextPressure.tsx` | The big "JIGNASA" wordmark in the manifesto section — variable font weight/width that responds to cursor proximity per character. Pauses its `requestAnimationFrame` loop via `IntersectionObserver` when scrolled off-screen. |
| `BlurText.tsx` | Per-letter/word blur-and-slide reveal. `trigger="mount"` (default) for above-the-fold content like the hero headline — a welcome animation should play on load, not wait for a scroll-into-view event that's never going to happen for content already on screen. `trigger="view"` for below-the-fold use. |
| `ScrollFloat.tsx` | GSAP-scrub per-character heading reveal. Gates creation on `document.fonts.ready` (see "Performance" below for why). Falls back to a single Motion `whileInView` fade entirely on devices `deviceTier.ts` flags as low-power. |
| `CountUp.tsx` | Stepped "odometer" count-up for the eval metrics — big jumps for the first ~80% of the range, single-unit ticks for the last ~20%, rather than a smooth spring (a spring doesn't read as "counting"). |
| `StickyPipeline.tsx` | The "how it works" 5-step zigzag reveal. Originally a GSAP `pin`-based sticky-stack; replaced after it produced layout gaps with these taller multi-line steps — now a simpler Motion `whileInView` scale+slide per step, alternating left/right. |
| `MagicBentoGlow.tsx` | Cursor-following spotlight + border glow on the capabilities grid. Trimmed down from react-bits' `MagicBento` (dropped the particle/tilt/magnetism pieces — high complexity, low payoff for a content grid). |
| `ShinyText.tsx` | Moving shine sweep on the hero eyebrow badge. |
| `SmoothScroll.tsx` | The Lenis+GSAP integration described above. Also refreshes `ScrollTrigger` on window resize, for mobile address-bar collapse/expand (see "Performance" below). |
| `EvalResultsSection.tsx` | Fetches `GET /api/evaluation/summary` with a retry loop (cold-start backend imports can take longer than a couple seconds) and renders the live retrieval + RAGAS numbers. On the static showcase build, fetches a static JSON snapshot instead (see "GitHub Pages showcase build" below). |
| `deviceTier.ts` | Not a component — a shared hardware-tier detector several of the above read from. See "Performance" below. |
| `StaticShowcaseSection.tsx` | Only rendered on the GitHub Pages build. See "GitHub Pages showcase build" below. |

Several of these (`BlurText`, `CountUp`, `ShinyText`, `MagicBentoGlow`'s
glow effect) are adapted from [react-bits](https://github.com/DavidHDev/react-bits)
(MIT+Commons Clause), ported from its Tailwind variant to plain CSS and
trimmed to what this project actually needed — see each file's header
comment for specifics on what changed and why.

## Chat page (`src/ChatInterface.tsx`)

Extracted from `App.tsx` as its own component (was ~1250 lines inline).
Visual approach deliberately landed on **minimalist, not glassmorphic** —
an earlier pass tried gradient user bubbles + frosted-glass assistant
bubbles + a floating glass input pill, then reverted to transparent
borderless assistant text and a flat bottom-anchored input bar. The
glass/gradient combination is exactly the "AI-generated" tell the design
skills below warn about; the revert reads more like confident editorial
chat than a templated SaaS demo.

Sidebar is collapsible (`AnimatePresence` + spring slide), message bubbles
animate in with a spring (`opacity/y/scale` + `layout` prop for automatic
re-flow when content shifts).

## GitHub Pages showcase build (`StaticShowcaseSection.tsx`)

The same `HomePage.tsx` is reused for both the real app's homepage and the
GitHub Pages showcase — set `VITE_STATIC_DEMO=true` at build time
(`vite.config.ts` reads it for the `base` path, `main.tsx` reads it for the
router's `basename`) and a few things branch:

- **CTAs point at the GitHub repo instead of `/chat`** — there's no backend
  behind this build, GitHub Pages only serves static files.
- **`EvalResultsSection.tsx` fetches a static JSON snapshot**
  (`public/eval-snapshot.json`, generated once from a real evaluation run)
  instead of live-polling `GET /api/evaluation/summary`, since there's no
  API to poll.
- **`StaticShowcaseSection.tsx` renders additional content** not shown on
  the real homepage: a plain-language explanation that this is a
  showcase not a hosted instance, an "Engineering decisions" section
  written deliberately in two layers — a plain-language sentence anyone
  can follow, then a smaller "technically:" line underneath for whoever
  wants the implementation detail — and a contact section. This two-layer
  structure exists because this page has two real audiences at once
  (recruiters skimming for depth, and anyone non-technical just trying to
  understand the project), and one register doesn't serve both: pure
  jargon loses the second audience, pure plain-language loses the
  "did they actually think about this" signal the first audience is
  looking for.

Deployed via `.github/workflows/deploy-pages.yml` on every push that
touches `web/**`, running `VITE_STATIC_DEMO=true npm run build` and
publishing the result with `actions/deploy-pages`.

## Performance: adaptive rendering for weaker devices (`deviceTier.ts`)

All of the decorative-only animation on the homepage (the canvas star
field, the per-character `ScrollFloat` heading reveal, the ambient-orb and
aurora-band backgrounds) is cheap enough to be invisible cost on a
capable device, but compounds into real, user-visible stutter on a weaker
one — found via direct testing (Chrome DevTools CPU throttling, and a
real budget Android phone) after a report of "the page feels glitchy on
my phone but not on yours."

**Why this isn't solved by checking `navigator.hardwareConcurrency`
(CPU core count) alone**: a budget "octa-core" phone commonly pairs 8 CPU
cores with a much weaker GPU than a flagship's. Core count measures
parallelism, not single-core or GPU speed — it missed exactly the device
this was meant to catch. There's no browser API that reports GPU tier
directly, so `deviceTier.ts` instead **measures actual frame rate** for a
short window right after the page loads (plain `requestAnimationFrame`
timing, no canvas/GPU work involved in the measurement itself) and uses
that as the real signal. The cheap static check (`hardwareConcurrency`/
`navigator.deviceMemory`) still runs first, since it's free and instantly
catches genuinely ancient hardware before spending even one frame on
measurement — but the frame-rate sample is what's authoritative.

This is reactive, not a one-time guess at mount: components subscribe via
`subscribeLowPowerDevice()` and switch rendering path if the measurement
resolves a few hundred milliseconds after their first render — `HomePage.tsx`
toggles a `.low-power` class on `<html>` (CSS freezes the ambient-orb/
aurora-band `animation`), the star field rebuilds with far fewer
particles, and `ScrollFloat` tears down its GSAP setup entirely and
re-renders as a single Motion `whileInView` fade instead of per-character
spans.

Two other things fixed in the same pass, unrelated to device tier:
- **`ScrollFloat`'s font-load race**: `ScrollTrigger` measures element
  position once, at creation time. A custom font finishing its load and
  reflowing the heading *after* that measurement leaves the trigger's
  scroll-range stale — most characters never reach "revealed." Fixed by
  gating creation on `document.fonts.ready`.
- **`filter: blur()` on large, always-animating backgrounds** (the
  ambient orbs, the aurora bands) is one of the more expensive things to
  ask a mobile GPU to do every frame, forever, regardless of scroll
  position. The orbs were converted to a `radial-gradient` (same soft-glow
  look, no blur filter at all); the aurora bands' blur radius was reduced
  (they still need *some* blur, since their gradient only fades
  left-right, not vertically).

## Design methodology

Three Claude Code skills were used to guide this work, not just installed
and ignored:

- **`frontend-design`** (Anthropic) — the "spend your boldness in one
  place" principle is why the manifesto section (oversized Devanagari +
  animated conic-gradient border) is the one dramatic visual moment, while
  everything else stays comparatively quiet.
- **`vercel-react-best-practices`** — performance patterns (avoiding
  unnecessary re-renders, correct effect dependencies) in the newer
  components.
- **`web-design-guidelines`** (Vercel) — accessibility/UX audit checks.

If you're extending the homepage, match the existing pattern: one new
file per motion behavior, isolated from the big render trees in
`HomePage.tsx`/`ChatInterface.tsx`, with a header comment explaining *why*
it exists if the reason isn't obvious from the code alone.
