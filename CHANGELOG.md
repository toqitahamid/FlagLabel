# Changelog

## Unreleased

### Fixes
- Title bar polish on macOS: removed the duplicate "FlagLabel" label that was rendering inside the app on top of the native window title, and forced the window to dark theme so the OS title bar no longer renders white against the app's dark UI.

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
