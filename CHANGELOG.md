# Changelog

## v0.2.1

### Annotation guidance
- A live help line under the annotation-type selector now spells out how to place the active type (e.g. "Top → bottom edge of the flag · 2 clicks" for a vertical span), and switches to "Click the second point to finish · Esc to cancel" while a span is half-placed. It's always visible, so it works whether you reach for the mouse or the keyboard.
- Each annotation-type button carries a tooltip with the same directional hint.
- The empty-state tagline now mentions both wire-ground points and flag spans, instead of only the wire-ground intersection.

## v0.2.0

### Span annotations for flag calibration
- Three new annotation types join the wire-ground point, so you can mark a flag's known physical dimensions in pixels for distance calibration:
  - **Vertical span** (`W`): top-to-bottom edge of the flag body.
  - **Horizontal span** (`E`): left-to-right edge of the flag body (a fallback when the flag's bottom edge isn't visible at far distance).
  - **Flag-to-ground span** (`R`): flag-body top down to the wire-ground intersection, the longest and most pixel-precise reference.
- Pick the active type with `Q` / `W` / `E` / `R` or the rail buttons. Each annotation is independent, so far flags can carry only the spans that are visible.
- Spans are placed with two clicks: the first pins one end, a ghost line follows the cursor, the second completes it. `Esc` cancels. Endpoints can be placed across both the main image and the zoom panel, and panning or zooming mid-span doesn't cancel it.
- The flag-to-ground span renders dashed so it stays distinct from the short vertical span that shares its top endpoint.
- Placing a second annotation with the same transect, distance, and type prompts a confirm (replace / keep both / cancel), now for wire-ground points too.

### Output format (schema v2)
- Each annotation type is written to its own array (`wire_ground_points`, `flag_vertical_spans`, `flag_horizontal_spans`, `flag_to_ground_spans`), with a `reference_dimensions_cm` block carrying the flag's known true sizes. `schema_version` is now `2`.
- Note: this drops the old v1 format. Files saved before v0.2.0 (which used a single `clicks` array) load as empty.

### Polish
- The annotation-type selector is a 2x2 grid; selecting a tool gives it a clear inverse fill, distinct from the data-colored L/C/R transect selection.
- The folder sidebar counts and the distance sparkline now reflect spans, not just wire-ground: the sidebar counts every annotation kind (so spans-only images no longer read as unlabeled), and the sparkline shows the active type's distribution by distance.
- **clear all** is now a button with a destructive (red) hover state instead of plain text.
- Consistent rail key hints and a simplified counts footer.

## v0.1.3

### Always-visible Save and Undo
- **Save** and **Undo** have moved to the titlebar, so they stay visible at any window size. On short windows the rail used to clip the bottom buttons; the titlebar never does.
- The right rail's middle sections (Transect, Distance, Zoom radius) now scroll independently when the window is short. Counts and the **clear all** link stay pinned at the bottom of the rail.

### Polish
- Empty state shows a one-line tagline ("Mark the wire-ground intersection of each distance flag.") so it's obvious what to do on first launch.
- The "saved at HH:MM:SS" indicator in the titlebar is now a quiet tertiary color instead of bright accent green; the amber "unsaved" warning still pops.
- Keyboard focus rings on every interactive control (buttons, segmented Transect, distance input, slider, checkbox, sidebar rows) for accessibility.
- Help modal has a layered shadow and a subtle slide-up entrance; backdrop fade is slightly longer for a smoother appearance.
- Zoom-radius slider thumb has a softer border and drop shadow, with a hover halo.
- All animations respect `prefers-reduced-motion`.
- Status bar gets a touch more horizontal breathing room.
- Color tokens cleaned up: `--warning`, `--danger-soft`, `--bg-zoom`, plus radius and transition tokens replace previously hard-coded values throughout the stylesheet.

### Fixes
- macOS title bar: removed the duplicate "FlagLabel" label that was rendering inside the app on top of the native window title, and forced the window to dark theme so the OS title bar no longer renders white against the app's dark UI.

## v0.1.2

### Fixes
- Saving an empty click list now works. Previously, if you cleared all clicks on an image that already had a saved JSON, neither manual save, auto-save, nor navigation would overwrite the file — the on-disk JSON kept your old clicks. Save fires whenever there are unsaved changes, regardless of whether the change adds or removes.

## v0.1.1

### Faster batch labeling
- **Folder mode** (⌘⇧O / Ctrl+Shift+O) — open an entire site of images and step through with `←` / `→`. The sidebar shows per-image click counts so you can see how much of the batch is done.
- **Auto-save** — clicks save automatically 5 seconds after your last edit. No more lost work if you switch images.

### Edit existing clicks
Click any placed marker to select it, then:
- **1 / 2 / 3** to re-tag the transect
- **↑ / ↓** to nudge the distance (⇧ for 0.5 m)
- **Delete** / **Backspace** to remove
- **Esc** to deselect

### Zoom and pan the main image
- Trackpad pinch or mouse wheel zooms around the cursor
- **Space + drag** (or middle-mouse drag) to pan
- **=** / **−** to zoom in/out, **0** to reset
- The 360 px right-rail zoom panel keeps its own fixed magnification for precision clicks

### Quality-of-life
- Native macOS / Windows menu bar with all the standard File and Edit shortcuts
- Keyboard help overlay (**?** or **⌘/**)
- Distance sparkline in the right rail shows how many clicks you've placed at each distance
- Output JSON now includes `created_at` and `app_version` metadata

### Now available on Windows
First release with native Windows x64 installers (`.exe` and `.msi`) alongside the macOS `.dmg`.

---

**Upgrading from v0.1.0?** Existing installs will auto-update on next launch. Your saved clicks JSON format is unchanged.

## v0.1.0

Initial release. macOS Apple Silicon only.

- Single-image click capture with image-pixel coordinate storage
- 360 px zoom panel with freeze-on-leave behavior
- Transect (L/C/R) and distance metadata with full keyboard shortcuts
- Save / load / undo / clear with persistent clicks folder
- OTA auto-updater
