---
name: FlagLabel
description: A precise, keyboard-driven dark labeler for distance-flag calibration in wildlife camera-trap surveys.
colors:
  graphite-app: "#0c0c0d"
  graphite-surface: "#18181b"
  graphite-elevated: "#27272a"
  graphite-zoom: "#08080a"
  border-subtle: "#3f3f46"
  border-strong: "#52525b"
  ink-primary: "#fafafa"
  ink-secondary: "#a1a1aa"
  ink-tertiary: "#71717a"
  surveyor-green: "#34a382"
  surveyor-green-hover: "#3eb691"
  danger: "#b91c1c"
  danger-soft: "#fca5a5"
  warning: "#fbbf24"
  transect-left: "#FF4D4D"
  transect-center: "#FFD93D"
  transect-right: "#4DA6FF"
  crosshair-lime: "#84cc16"
typography:
  title:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
  mono:
    fontFamily: "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.02em"
    fontFeature: "tabular-nums"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "14px"
  xl: "16px"
components:
  button:
    backgroundColor: "{colors.graphite-elevated}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-primary:
    backgroundColor: "{colors.surveyor-green}"
    textColor: "{colors.graphite-app}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.surveyor-green-hover}"
    textColor: "{colors.graphite-app}"
  title-btn:
    backgroundColor: "{colors.graphite-elevated}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "4px 10px"
    typography: "{typography.label}"
  segmented-btn:
    backgroundColor: "{colors.graphite-elevated}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 0"
    typography: "{typography.mono}"
  segmented-btn-tool-active:
    backgroundColor: "{colors.ink-primary}"
    textColor: "{colors.graphite-app}"
  distance-input:
    backgroundColor: "{colors.graphite-elevated}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
    width: "80px"
    typography: "{typography.mono}"
  image-item:
    backgroundColor: "{colors.graphite-surface}"
    textColor: "{colors.ink-secondary}"
    padding: "6px 14px"
    typography: "{typography.mono}"
---

# Design System: FlagLabel

## 1. Overview

**Creative North Star: "The Surveyor's Instrument"**

FlagLabel is a calibrated dark field tool, not a workspace. The whole interface
is built to read like surveying gear: a near-black graphite housing, a single
green that lights only the controls that matter, white data set in tabular
monospace, and three saturated transect colors borrowed straight from the field
markers. Every pixel earns its place by serving one job — landing an annotation
exactly where the researcher means it, thousands of times, from the keyboard.
The screen is dim and steady on purpose: the photo is the bright object, the
chrome recedes around it, and the 360px zoom panel is the lens you actually work
through.

Density is high but never loud. Controls are small, sized to their function, and
spoken in a terse voice — single-letter transect buttons (L/C/R), monospace
distance readouts, compact rails that frame the image rather than compete with
it. Depth comes from tonal layering of the graphite ramp (app → surface →
elevated), not from decoration; shadows appear only when something genuinely
floats above the canvas (a modal). The accent green is rationed: primary action,
current selection, saved state. Nowhere else.

This system explicitly rejects four things. It is **not a consumer photo app**
(no broad gradient toolbars, no playful chrome). It is **not a generic SaaS
dashboard** (no card grids, no hero-metric blocks, no tracked-uppercase eyebrow
over every panel). It is **not academic clunkware** (no mismatched controls, no
missing states, nothing visually unloved). And it is **not a touch UI** (no
oversized tap targets or bottom sheets — this is a pointer-and-keyboard precision
tool).

**Key Characteristics:**
- Dark graphite housing (#0c0c0d) with tonal layering for depth, not shadow.
- One rationed accent: Surveyor's Green (#34a382) for action, selection, saved.
- Monospace, tabular-aligned data everywhere a number lives.
- Three field-marker data colors (red/yellow/blue) for L/C/R transects only.
- Small radii (4–8px), fast transitions (80–140ms), nothing rounded or slow.
- Keyboard-first: every control has a visible `:focus-visible` ring.

## 2. Colors

A near-black graphite field, one rationed green accent, white data, and three
saturated marker colors reserved strictly for transect identity.

### Primary
- **Surveyor's Green** (#34a382): The single accent. Used for primary-action
  buttons (Save), the active-image left border, the checked checkbox, the focus
  ring, and the help-section headers. **Hover:** Surveyor's Green Hover
  (#3eb691). It is never decoration.

### Secondary
- **Ink White** (#fafafa, `ink-primary`): Primary text, and the inverse fill on
  the *selected annotation tool* (a deliberate neutral inverse, kept distinct
  from the green so "which tool" and "which transect" read as different kinds of
  choice).

### Tertiary — Transect Data Colors
Used only on the photo canvas, in the counts readout, and as the active-transect
button fill. They encode identity (which transect), never decoration.
- **Marker Red** (#FF4D4D): Transect **L** (Left).
- **Marker Amber** (#FFD93D): Transect **C** (Center).
- **Marker Blue** (#4DA6FF): Transect **R** (Right).
- **Crosshair Lime** (#84cc16): The live placement crosshair on the canvas only.

### Neutral — The Graphite Ramp
- **Graphite App** (#0c0c0d): The deepest layer — app background and canvas
  matte.
- **Graphite Zoom** (#08080a): Even deeper, the zoom-panel canvas backing.
- **Graphite Surface** (#18181b): Rails, titlebar, statusbar, modals — the
  second tonal layer.
- **Graphite Elevated** (#27272a): Buttons, inputs, segmented controls — the
  interactive layer.
- **Border Subtle** (#3f3f46) / **Border Strong** (#52525b): Dividers at rest;
  the strong step on hover.
- **Ink Secondary** (#a1a1aa): Labels and secondary text. **Ink Tertiary**
  (#71717a): Hints, units, inactive/untouched items.

### Semantic
- **Danger** (#b91c1c) / **Danger Soft** (#fca5a5): The Clear-all action shows
  neutral at rest and turns danger-red only on hover; destructive error text.
- **Warning Amber** (#fbbf24): The "unsaved / dirty" save-state indicator.

### Named Rules
**The Rationed Green Rule.** Surveyor's Green appears only on action, current
selection, and saved/checked state. If green is doing decoration, it is wrong.

**The Data-Color Lockbox Rule.** Red/Amber/Blue exist only to mean L/C/R. Never
use a transect color for a button, a border, or emphasis. Their job is identity.

## 3. Typography

**UI Font:** Geist (with -apple-system, Segoe UI, system-ui fallbacks)
**Data/Mono Font:** Geist Mono (with SF Mono, Menlo, Consolas)

**Character:** One precise grotesque for the interface, one matching monospace
for everything numeric. The pairing is deliberately close in spirit (both Geist)
so the screen reads as a single calibrated instrument; the only contrast that
matters is proportional-UI versus tabular-data. Base size is a compact 13px —
this is a dense desktop tool, not a reading surface.

### Hierarchy
- **Title** (Geist 600, 14px, -0.01em): Modal titles (keyboard help, collision
  confirm). The largest type in the app — there is no display tier by design.
- **Body** (Geist 400, 13px, 1.4): Default UI text, button labels, intro and
  empty-state copy. Prose blocks cap around 38–60ch (empty-state tagline,
  error text).
- **Label** (Geist 500, 11px, +0.02em, often lowercase): Rail section labels,
  title-bar buttons, checkbox rows. Lowercase by choice — quiet, not shouting.
- **Mono / Data** (Geist Mono 400, 10–13px, tabular-nums): Every number and
  path — distances, per-image counts, the status-bar file path, image-list
  filenames, the distance input. **The defining texture of the app.**
- **Section Eyebrow** (Geist 600, 10px, +0.08em, uppercase, Surveyor's Green):
  Used *only* inside the keyboard-help modal to label groups. Not a page-level
  scaffold — it lives in one overlay, deliberately.

### Named Rules
**The Tabular Numerals Rule.** Every numeric readout uses Geist Mono with
`font-variant-numeric: tabular-nums`. Counts, distances, and coordinates must
never reflow horizontally as their digits change. Numbers that jitter read as
amateur instrumentation.

## 4. Elevation

Flat by default, with depth carried by **tonal layering of the graphite ramp**,
not by shadow. Surfaces stack by lightness — app (#0c0c0d) → surface (#18181b) →
elevated (#27272a) — and borders (subtle → strong on hover) draw the edges.
Shadows are reserved exclusively for elements that genuinely float above the
canvas: the keyboard-help and collision-confirm modals, and the slider thumb.

### Shadow Vocabulary
- **Modal Lift** (`box-shadow: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 24px
  rgba(0,0,0,0.35), 0 24px 60px rgba(0,0,0,0.45)`): The only "big" shadow.
  Doubled drop-shadow plus a 1px inset top highlight, used on modals over the
  blurred backdrop.
- **Thumb Lift** (`box-shadow: 0 1px 2px rgba(0,0,0,0.4)`): The radius/zoom
  slider thumb; deepens slightly on hover with a faint focus halo.

### Named Rules
**The Tonal-Depth Rule.** Panels and controls are flat at rest. To raise an
element, step it up the graphite ramp and strengthen its border — do not add a
drop shadow. Shadows mean "floating over the photo," and only modals do that.

## 5. Components

Components are **quiet and exact**: restrained controls, monospace data, crisp
small radii, fast transitions. Nothing shouts; every control is sized to its job
and gives precise, immediate feedback (an 80ms hover shift, a 2% scale on press).

### Buttons
- **Shape:** Small radii — title-bar buttons and segmented controls at 4px
  (`rounded.sm`), standard `.btn` and the clear-all link at 6px (`rounded.md`).
- **Primary:** Surveyor's Green fill, Graphite-App text, weight 500
  (Save / open-folder CTAs). **Hover:** Surveyor's Green Hover.
- **Default / Ghost:** Graphite-Elevated fill, secondary-ink text, subtle border;
  hover lifts text to Ink White, border to Border-Strong, surface to
  Graphite-Surface.
- **Press:** Uniform `transform: scale(0.98)` on `:active`.
- **Disabled:** 40% opacity, `cursor: not-allowed`, no hover response. Primary
  keeps its green fill but flattens.

### Segmented Controls
The signature control type, used two ways:
- **Transect (L/C/R):** A 3-up grid of single mono letters. The active segment
  fills with its **transect data color** (red/amber/blue) — selection carries
  identity.
- **Tool grid (wire-ground / vertical / horizontal / flag-to-ground):** A 2×2
  grid of word labels. The active tool fills with **Ink White inverse**,
  deliberately distinct from the transect colors so "which tool" and "which
  transect" never look like the same kind of choice.

### Inputs / Fields
- **Distance input:** 80px-wide Geist Mono field, Graphite-Elevated fill, 4px
  radius, native number spinners stripped. **Focus:** border shifts to Surveyor's
  Green plus a soft `0 0 0 2px rgba(52,163,130,0.25)` glow.
- **Checkbox (auto-advance):** Custom 14px box, Graphite-Elevated at rest; checked
  fills Surveyor's Green with a Graphite-App checkmark.
- **Slider (zoom radius):** 4px track, 14px white circular thumb with Thumb-Lift
  shadow; `grab` → `grabbing` cursor, 1.1× scale on `:active`.

### List Items (Folder Sidebar)
- Geist Mono filename + tabular count, 6px×14px padding, secondary ink. Untouched
  images drop to tertiary ink. **Active:** Graphite-Elevated fill with a 2px
  **Surveyor's Green left border** (the one sanctioned left-accent in the
  system — it marks current selection, not decoration). **Hover:** elevated fill,
  ink lifts to white.

### Modals (Help / Collision)
- Graphite-Surface panel, subtle border, 8px radius (`rounded.lg`), Modal-Lift
  shadow over a `blur(2px)` darkened backdrop. Enter with a 180ms ease-out
  rise-and-settle (`translateY(8px) scale(0.985)` → rest). **Modals are the
  exception, not the reflex** — used only for keyboard help and the
  same-(transect, distance, kind) collision confirm.

### Status & Save State
- **Status bar:** 28px mono strip, tertiary ink, right-to-left ellipsis on the
  file path so the filename stays visible.
- **Save state:** Mono indicator — Warning Amber when dirty, Ink Tertiary when
  saved. State is always legible, never hidden.

### Focus (keyboard a11y)
- Every interactive control shows a `:focus-visible` ring:
  `0 0 0 2px var(--graphite-app), 0 0 0 4px var(--surveyor-green)`. The whole
  workflow is keyboard-operable, so the ring is load-bearing, not cosmetic.

## 6. Do's and Don'ts

### Do:
- **Do** ration Surveyor's Green to action, current selection, and saved/checked
  state only. If you reach for green as decoration, use a graphite step instead.
- **Do** set every number in Geist Mono with `tabular-nums` so readouts never
  reflow as digits change.
- **Do** convey depth by stepping up the graphite ramp (app → surface →
  elevated) and strengthening the border. Reserve drop shadows for modals.
- **Do** keep radii small: 4px on compact controls, 6px on standard buttons, 8px
  on modals. Full-pill is allowed only for nothing here — this app has no pills.
- **Do** give every interactive control a visible `:focus-visible` ring and a
  hover state; the keyboard path must always be visible.
- **Do** keep the transect colors (red #FF4D4D / amber #FFD93D / blue #4DA6FF)
  exclusively for L/C/R identity, on the canvas and counts.

### Don't:
- **Don't** look like a **consumer photo app** — no broad gradient toolbars, no
  playful chrome, no decorative color over the photo.
- **Don't** look like a **generic SaaS dashboard** — no card grids, no
  hero-metric blocks, and no tracked-uppercase eyebrow over every panel (the one
  uppercase eyebrow lives inside the help modal and stays there).
- **Don't** look like **academic clunkware** — no mismatched controls, no
  half-built states, nothing visually unloved.
- **Don't** build for **touch** — no oversized tap targets, bottom sheets, or
  swipe gestures; this is a pointer-and-keyboard precision tool.
- **Don't** use a transect data color for a button, border, or emphasis. It means
  L/C/R and nothing else.
- **Don't** add a `border-left` greater than the one 2px Surveyor's-Green
  active-item marker; no colored side-stripes as decoration anywhere else.
- **Don't** introduce gradient text, glassmorphism panels, or border-radius above
  8px on any control. If it looks rounded or glassy, it's off-instrument.
- **Don't** reach for a modal first. Exhaust inline and rail-based affordances;
  only keyboard-help and the collision confirm earn an overlay.
