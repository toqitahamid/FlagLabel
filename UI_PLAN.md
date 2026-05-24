# FlagLabel — UI Plan

Companion to `PLAN.md` (implementation milestones). This document covers
**what the interface looks like and why** — before any component code gets
written.

The two source skills consulted:

- `design-taste-frontend` (high-end frontend bias-correction)
- `/tufte-design` was requested but is **not installed**; Tufte's principles
  are applied directly from primary sources (*Visual Display*, *Envisioning
  Information*).

---

## 1. Design Philosophy

FlagLabel is a **work surface**, not a landing page. A researcher opens it,
clicks 15–60 flags across a few images, saves, closes. The interface has one
job: **get out of the way of the photograph being labeled.**

Two principles that win every disagreement:

1. **The image is the data. The UI is the frame.** (Tufte: maximize
   data-ink ratio.) The photo + the click markers carry the only meaningful
   color in the whole app. Everything else is neutral.

2. **Speed over surprise.** No motion that the user didn't ask for. No
   delight loops. No skeleton shimmer on a 2-second image load — that's
   distraction, not feedback. (Karpathy: be boring and obvious.)

### Dial overrides from `design-taste-frontend` skill

The skill ships with `DESIGN_VARIANCE=8`, `MOTION_INTENSITY=6`,
`VISUAL_DENSITY=4`. Those are landing-page values and wrong for this tool.
Overriding to:

| Dial | Skill default | FlagLabel | Why |
|---|---|---|---|
| `DESIGN_VARIANCE` | 8 | **3** | Researchers want a predictable tool. Asymmetric whitespace and offset grids in a labeling app slow people down. |
| `MOTION_INTENSITY` | 6 | **2** | Hover effects + click feedback only. No perpetual motion, no spring choreography, no scroll-tied animation. |
| `VISUAL_DENSITY` | 4 | **6** | Dense numeric readout (click counts by transect, current coords, image dims). Monospace for all numbers. |

Surviving rules from the skill that we **do** keep:
- No emojis. Icons via `@phosphor-icons/react` only.
- No `Inter`. Use `Geist` (UI) + `Geist Mono` (numbers).
- No pure black. Zinc-950 background, off-white surfaces.
- One accent color, desaturated. **And it cannot be red/yellow/blue** — those
  are reserved for the L/C/R transect markers on the image. Picking **deep
  emerald** (`#10b981` desaturated to `#34a382`) for the save action and
  active selections.
- No card overuse: separation via 1px `border-slate-200` dividers, not boxed
  containers. (Skill Rule 4 + Tufte's "small multiples without frames.")
- Forms: label above input, mono digits.
- Phosphor icons at `weight="regular"` (no duotone, no bold).

Rules we **explicitly reject** for this app:
- No "Liquid Glass" / glassmorphism panels. We need pixel-clear edges next to
  pixel-precise click targets.
- No magnetic buttons / cursor pull. Pixel-precision tool — the cursor must
  go where the user puts it, full stop.
- No bento grid. We have one image and one zoom panel, not a feature gallery.
- No scroll-triggered anything. The window doesn't scroll.

---

## 2. Color System

Two-tier system. Almost everything is in tier 1. The dots on the image are
tier 2.

### Tier 1 — UI chrome (neutral)

```
bg-app          #0c0c0d   (Zinc-950, app background)
bg-surface      #18181b   (Zinc-900, panels)
bg-elevated     #27272a   (Zinc-800, inputs, dropdowns)
border-subtle   #3f3f46   (Zinc-700, 1px dividers)
border-strong   #52525b   (Zinc-600, focused inputs)
text-primary    #fafafa   (Zinc-50)
text-secondary  #a1a1aa   (Zinc-400)
text-tertiary   #71717a   (Zinc-500, metadata, hints)
accent          #34a382   (desaturated emerald — save, active selection)
warning         #d97706   (amber, undo)
danger          #b91c1c   (deep red, clear-all confirm only)
```

Dark theme by default. Pixel-edit tools (Photoshop, Lightroom, Figma) all
default to dark because it stops the UI from interfering with color
judgement on the image. Same logic here.

### Tier 2 — Click markers (the ONLY saturated color in the app)

These match the notebook exactly so the visual language is unchanged for
the user:

```
transect L      #FF4D4D   (red)
transect C      #FFD93D   (yellow)
transect R      #4DA6FF   (blue)
```

Black 1px outer ring on each marker so they remain legible against any
photo content (snow, foliage, dirt).

---

## 3. Typography

```
font-sans   Geist (UI labels, buttons, body)
font-mono   Geist Mono (all numbers, coordinates, distances, file paths)
```

Type scale (intentionally narrow — this is a tool, not editorial):

```
text-xs     11px  metadata, secondary labels, status bar
text-sm     13px  inputs, buttons, body
text-base   15px  primary instructions
text-lg     17px  image title only
```

No display sizes. No `text-6xl`. The image is the headline.

Numbers: **always** `font-mono tabular-nums`. Coordinates, distances, click
counts, image dimensions, file size. This is non-negotiable for a tool that
shows changing numbers — non-tabular digits jitter and slow the eye.

---

## 4. Layout (window, 1280×800 default)

ASCII wireframe of the main window. Annotations on the right.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ FlagLabel — site1 / flag_photo.JPG · 4032×3024              · saved 14:32:08 │  ← titlebar (native, custom)
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│                                                  ┌───────────────────────┐   │
│                                                  │                       │   │
│                                                  │                       │   │
│                                                  │      ZOOM PANEL       │   │
│                                                  │      (follows cursor) │   │
│                                                  │                       │   │
│                                                  │                       │   │
│         MAIN IMAGE                               │                       │   │
│         (fit-to-window)                          │   ╶───────────────╴   │   │  ← 1px crosshair
│                                                  │           |           │   │     marking center
│         · click target (wire-ground)             │                       │   │
│         · all overlays render here               │                       │   │
│                                                  └───────────────────────┘   │
│                                                                              │
│                                                  Transect [L ▾]              │
│                                                  Distance [3.0    ] m        │
│                                                  ☑ auto-advance              │
│                                                  Zoom ●───────○──────  80px  │
│                                                                              │
│                                                  ─────────────────────────   │  ← 1px divider, not a card
│                                                                              │
│                                                  L 5 · C 8 · R 4 = 17 clicks │  ← live counts, mono digits
│                                                                              │
│                                                  [ undo ]    [ save ]        │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ /…/photos/site1/flag_photo.JPG  ·  17 clicks  ·  unsaved changes             │  ← status bar
└──────────────────────────────────────────────────────────────────────────────┘
```

Key layout decisions:

- **Image takes ~70% of horizontal width on the left.** It is the work
  surface. Right rail is ~360px fixed, never resizes — predictable target
  for the cursor.
- **Zoom panel is at the TOP of the right rail**, not below the controls.
  Reason: the user's eye-line tracks between the photo and the zoom panel
  hundreds of times per session. They sit next to each other. Controls go
  below — accessed rarely (transect change, save).
- **No card / panel boxing.** The right rail is just stacked elements
  separated by space and a single 1px divider above the click totals. (Skill
  Rule 4; Tufte: remove non-data-ink.)
- **Status bar** at the bottom shows file path, click count, dirty-state.
  Mono. Tiny. Always visible. Same as Sublime / VS Code.
- **No left sidebar in v1.** Image switching is via a separate
  cmd-shift-O dialog (see §6). Adding a thumbnail strip is a v2 idea.

### Window chrome (Tauri-specific)

- Custom titlebar (Tauri `decorations: false`) with the image title and
  saved-status indicator. Native traffic lights on macOS (Tauri supports
  this via `titleBarStyle: "Overlay"`).
- Window remembers last size/position on close.
- Minimum window size: 960×600. Below that the right rail wraps under the
  image — but we don't optimize for it.

---

## 5. Components (concrete specs)

### 5.1 Main image canvas
- HTML `<canvas>`, fit-to-window with `object-contain` semantics
  (preserve aspect ratio, letterbox if needed).
- Letterbox color = `bg-app` (no contrast against window — invisible bars).
- Crosshair cursor when hovered.
- Click markers: 8px filled circle, 1px black outer ring, transect color
  fill. Label `{T}{distance}` (e.g. `L3`) in 9px mono white with a black
  pill background `bg-black/65`, offset +8/-8px from the click.

### 5.2 Zoom panel
- Square, edge-aligned to right rail width (~360×360px).
- Same image, scaled so a 80px-radius window around cursor fills the panel.
- 1px lime crosshair (`#84cc16`) — high contrast against most photo content
  without competing with the L/C/R marker colors.
- Hovering inside the zoom panel itself: cursor doesn't drive the panel
  (it freezes on the last main-canvas position). Clicking inside the zoom
  panel records at image-pixel coordinates, not panel coordinates.

### 5.3 Metadata controls (right rail middle)
- **Transect**: segmented control (L | C | R), not a dropdown. Three
  buttons in a row, each 1/3 width. Selected = filled with transect color,
  unselected = outlined zinc. Tells the user the color mapping at a glance.
  Click or press `1` / `2` / `3` to change.
- **Distance**: numeric input, mono font, step 1.0. `↑` / `↓` arrows on
  keyboard increment. Width: enough for `99.9` plus the `m` unit suffix.
- **Auto-advance**: a single checkbox. When on, distance increments through
  `[1, 2, 3, …, 15]` after each click.
- **Zoom window size**: slider, 15 → 300px, default 80. Show current value
  in mono next to the slider (`80px`).

### 5.4 Click count readout
- Single line: `L 5 · C 8 · R 4 = 17 clicks` — mono digits, transect letters
  colored by their transect color. The whole readout is one line, not three
  bars. (Tufte: data density. One line carries 4 numbers + their meaning.)
- Sparkbar idea, deferred to v2: a tiny 15-cell row showing which distances
  (1m, 2m, …, 15m) have at least one click on each transect. Gives instant
  visual confirmation of coverage gaps.

### 5.5 Actions
- **Save** (primary, accent emerald): `cmd-S` / `ctrl-S`. After save,
  briefly (1s) changes label to `saved · 14:32:08` then back to `save`. No
  toast, no modal.
- **Undo** (secondary, amber outline): `cmd-Z`. Removes last click only;
  not a multi-step history in v1.
- **Clear all** (danger, hidden behind menu): NOT in the primary rail.
  Lives in the app menu under `File → Clear clicks…` with a confirm
  dialog. Too easy to nuke a 60-click session by accident.

### 5.6 Status bar (bottom)
- Three segments separated by ` · `:
  - File path (truncate from left if too long: `…/site1/flag_photo.JPG`)
  - Click count
  - Save state: `saved` or `unsaved changes`
- All mono, `text-xs`, `text-tertiary`.

### 5.7 Image switcher (cmd-O / cmd-shift-O)
- v1: Native file-open dialog only (`cmd-O` opens a new image).
- v2 idea: `cmd-shift-O` opens a quick switcher showing all images in the
  current `photos/<site>/` directory with done/in-progress/todo state
  inferred from existing JSON files. **Deferred.**

---

## 6. Interaction & Motion

`MOTION_INTENSITY = 2` budget. Total list of allowed animations:

| Where | Animation | Duration | Easing |
|---|---|---|---|
| Click marker appearing | `opacity 0 → 1` + `scale 0.6 → 1` | 100ms | `ease-out` |
| Save button success state | label crossfade `save ↔ saved · HH:MM:SS` | 150ms | `ease` |
| Zoom panel re-center on cursor move | none — instant | — | — |
| Distance auto-advance | none — instant | — | — |
| Hover states on buttons | `bg-elevated → bg-elevated/80`, instant | 80ms | `ease` |
| Active/press feedback | `scale(0.98)` on `:active` | — | — |

**No** spring physics. **No** stagger. **No** layout transitions. **No**
infinite loops. The zoom panel must keep up with the cursor at 60+ Hz; any
ease on its update is a bug.

---

## 7. Keyboard shortcuts (the real interface)

A pixel-labeling tool lives or dies by its keyboard. Default bindings:

```
1 / 2 / 3       set transect to L / C / R
↑ / ↓           increment / decrement distance by 1.0
shift-↑ / -↓    increment / decrement by 0.5
space           toggle auto-advance
[ / ]           shrink / grow zoom window
cmd-Z           undo last click
cmd-S           save JSON
cmd-O           open image
cmd-shift-O     quick-switch image (v2)
esc             cancel hover (freezes zoom panel)
```

Shortcuts are listed in `Help → Keyboard Shortcuts` (cheatsheet modal, mono
font, two columns). Not in the main UI — they'd clutter it.

---

## 8. States we MUST design (skill Rule 5, mandatory)

| State | Design |
|---|---|
| **First launch, no image opened** | Centered single-line instruction: `Open an image to begin · cmd-O`. Right rail is hidden until an image is loaded. |
| **Image loading** | The image area stays the previous color (`bg-app`) with a 13px mono `loading 4032×3024…` in the center. **No skeleton shimmer** — image loads in <500ms locally; a shimmer would flash and look broken. |
| **Image failed to load** | Centered red-tinted text: `Could not read /path/to/file.JPG · {error}`. Toolbar disabled. |
| **Resume — JSON exists for this image** | On image load, clicks render immediately. Status bar shows `saved · loaded N clicks from disk`. |
| **Unsaved changes when opening another image** | Native confirm dialog: `You have N unsaved clicks. Save before opening another image?` `[Save] [Discard] [Cancel]` |
| **Unsaved changes when closing window** | Same dialog. |
| **Window too small (<960×600)** | Right rail wraps below the image; we don't crash, but we don't optimize. |

---

## 9. What we are NOT building in v1

Already in `PLAN.md` §8 but worth restating from a UI standpoint:

- No light theme.
- No image thumbnail strip.
- No annotated-PNG export (you confirmed not needed).
- No batch operations across images.
- No multi-step undo (one level only).
- No per-click notes / freeform metadata.
- No mouse-cursor decorations or magnetic effects.
- No splash screen / onboarding tour.

These all go to `IDEAS.md` if they come up later.

---

## 10. Pre-flight check (skill §10)

- [x] No emojis, anywhere.
- [x] Mobile collapse: N/A — desktop window, min 960×600.
- [x] No `h-screen` in any sense (Tauri window controls height).
- [x] Empty / loading / error states designed (§8).
- [x] Cards minimized; dividers and spacing carry hierarchy.
- [x] No perpetual animations (MOTION_INTENSITY=2 budget).
- [x] Mono digits everywhere numbers change.
- [x] One accent color, saturation < 80% (emerald `#34a382` ≈ 49%).
- [x] No purple, no neon, no gradient text, no Inter.
- [x] L/C/R red/yellow/blue are reserved exclusively for image markers —
      never appear in chrome.

---

Ready to pair this with M1 of `PLAN.md` (scaffold Tauri+React+TS, open
empty window) — first real component to build is the main image canvas
(M2), at which point the layout in §4 starts taking shape.
