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

**The one non-obvious thing every one of these had to account for**: this
app's actual scroll container is `#root` (`overflow: auto`), not the browser
`window` (`body` has `overflow: hidden` — needed for the chat page's
fixed-viewport layout). Any library that defaults to listening on `window`
scroll (GSAP `ScrollTrigger`, Lenis's `useWindowScroll` mode) will silently
never fire. Every scroll-driven component here explicitly targets `#root`
instead of accepting the default. This was a real, reproducible bug —
not a precaution — see git history around `ScrollFloat.tsx` and
`SmoothScroll.tsx` for the fix.

All motion respects `prefers-reduced-motion` — either via `motion`'s
`useReducedMotion()` hook or an explicit check, never assumed away.

## Homepage components (`src/HomePage.tsx` and friends)

| Component | What it does |
|---|---|
| `PreLoader.tsx` | Blocks the initial reveal until the backend connection *and* eval data are both confirmed ready (`isAppReady`), then plays a sweeping color-layer wipe + spinner-to-checkmark + circular-mask reveal. Exists specifically to remove a race condition that used to show "no evaluation results" on the very first load after starting the server. |
| `TextPressure.tsx` | The big "JIGNASA" wordmark in the manifesto section — variable font weight/width that responds to cursor proximity per character. Pauses its `requestAnimationFrame` loop via `IntersectionObserver` when scrolled off-screen. |
| `BlurText.tsx` | Per-letter/word blur-and-slide reveal. `trigger="mount"` (default) for above-the-fold content like the hero headline — a welcome animation should play on load, not wait for a scroll-into-view event that's never going to happen for content already on screen. `trigger="view"` for below-the-fold use. |
| `ScrollFloat.tsx` | GSAP-scrub section heading reveal, explicitly scoped to `#root` (see above). |
| `CountUp.tsx` | Stepped "odometer" count-up for the eval metrics — big jumps for the first ~80% of the range, single-unit ticks for the last ~20%, rather than a smooth spring (a spring doesn't read as "counting"). |
| `StickyPipeline.tsx` | The "how it works" 5-step zigzag reveal. Originally a GSAP `pin`-based sticky-stack; replaced after it produced layout gaps with these taller multi-line steps — now a simpler Motion `whileInView` scale+slide per step, alternating left/right. |
| `MagicBentoGlow.tsx` | Cursor-following spotlight + border glow on the capabilities grid. Trimmed down from react-bits' `MagicBento` (dropped the particle/tilt/magnetism pieces — high complexity, low payoff for a content grid). |
| `ShinyText.tsx` | Moving shine sweep on the hero eyebrow badge. |
| `SmoothScroll.tsx` | The Lenis+GSAP integration described above. |
| `EvalResultsSection.tsx` | Fetches `GET /api/evaluation/summary` with a retry loop (cold-start backend imports can take longer than a couple seconds) and renders the live retrieval + RAGAS numbers. |

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
