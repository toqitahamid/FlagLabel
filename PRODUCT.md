# Product

## Register

product

## Users

Wildlife researchers and field technicians running camera-trap distance-sampling
surveys. They sit down with a batch of reference photos — often a whole site's
worth — and need to mark, with sub-pixel accuracy, where each numbered flag's
wire meets the ground, plus the flag's known physical spans for pixel-per-cm
calibration. The job is repetitive and high-volume: hundreds to thousands of
precise points across many images, tagged by transect (L/C/R) and distance.
Their context is a desk with a mouse and keyboard, long focused sessions, and a
strong incentive to stay in flow rather than reach for the mouse menu.

## Product Purpose

FlagLabel turns one narrow task — distance-flag annotation — into the entire
app. Open an image, pick a transect, tap a distance, click the wire–ground
intersection (or place a two-click span across the flag body); each image
becomes one small JSON file of image-pixel coordinates ready for downstream
camera-calibration code. Success is throughput without error: a researcher
labels a full site faster than any general-purpose image tool would allow,
never loses work, and trusts that every coordinate is exactly where they put
it. The app earns its place by being faster and more precise at this one job
than anything not built for it.

## Brand Personality

Precise, fast, unobtrusive. A surgical instrument, not a workspace. The voice
is terse and exact — monospace data, single-letter controls, no ceremony. It
should feel like a power tool that gets out of the way of marking thousands of
points, rewarding muscle memory and rarely interrupting. Confidence comes from
restraint: nothing on screen that the task doesn't need.

## Anti-references

- **Consumer photo apps** (Lightroom / Photos): heavy chrome, broad toolbars,
  gradient buttons, playful color. Too decorative and too slow for a tight
  labeling loop.
- **Generic SaaS dashboards**: card grids, hero-metric blocks, tracked-uppercase
  eyebrows above every panel, marketing-flavored empty states. This is a tool,
  not a dashboard product.
- **Academic / scientific clunkware** (MATLAB / ImageJ / Tkinter-era): tiny
  mismatched controls, missing interaction states, no keyboard polish, visually
  unloved research software. FlagLabel should feel deliberately crafted, not
  thrown together by a lab.
- **Mobile-first / touch UI**: large tap targets, bottom sheets, swipe gestures.
  This is a mouse-and-keyboard desktop precision tool; the interaction model is
  pointer + shortcuts, not thumbs.

## Design Principles

- **The tool disappears into the task.** Every element on screen exists to serve
  placing or verifying an annotation. If something is decoration, it's noise —
  remove it. The win condition is the researcher forgetting the UI is there.
- **Keyboard-first, mouse-precise.** The full workflow runs from the keyboard
  (transect, distance, type, navigation, auto-advance); the mouse is reserved
  for the one thing it's better at — landing a point exactly. Never make a
  high-frequency action mouse-only.
- **Precision is the product.** Sub-pixel placement, the fixed-magnification zoom
  panel, exact stored pixel coordinates — accuracy is the reason the app exists,
  so affordances that protect it (the zoom panel, collision confirms, visible
  selection) outrank visual flourish.
- **Earned familiarity over invention.** Use standard, predictable affordances
  (segmented controls, real focus rings, native-feeling shortcuts). Don't
  reinvent scrollbars, modals, or form controls for flavor; strangeness costs
  trust in a tool people use for hours.
- **Never lose work, never surprise.** Auto-save, undo, per-image count readouts,
  and clear dirty/saved state mean the researcher can trust the app with a full
  day's labeling. State changes are legible; destructive actions look
  destructive only when they are.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**, keyboard-first. All text meets AA contrast against its
surface (the dark zinc ramp is already tuned for this); the entire workflow is
keyboard-operable by design, with visible `:focus-visible` rings on every
interactive control, and `prefers-reduced-motion` is honored (transitions
collapse to near-instant). Color-vision safety (transect and state indicators
remaining distinguishable without relying on hue) is a worthwhile goal to
validate later, not a committed requirement at this bar.
