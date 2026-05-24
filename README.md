# FlagLabel

A fast, keyboard-driven desktop labeler for distance-flag calibration in wildlife camera-trap surveys.

Researchers running camera-trap distance sampling place numbered flags along three transects (Left, Center, Right) at known distances, then need to mark exactly where each flag's wire meets the ground in every reference photo. FlagLabel makes that the entire app: open an image, pick a transect, tap a distance, click the wire–ground intersection. The 360 px zoom panel lets you place markers to sub-pixel precision; folder mode walks a whole site of photos without ever leaving the keyboard.

Each image becomes one small JSON file with image-pixel click coordinates and the transect/distance you tagged, ready for downstream camera-calibration code.

Available for macOS (Apple Silicon) and Windows (x64). ~5 MB installer.

---

## Install

Grab the latest installer from the [Releases](https://github.com/toqitahamid/FlagLabel/releases) page.

**macOS** (Apple Silicon): `FlagLabel_<version>_aarch64.dmg`

1. Open the `.dmg` and drag `FlagLabel.app` into `/Applications`.
2. First launch only: right-click the app in `/Applications` → **Open** → **Open anyway**. macOS blocks unsigned apps by default; this exception is remembered.

**Windows** (x64): `FlagLabel_<version>_x64-setup.exe` or `FlagLabel_<version>_x64_en-US.msi`

1. Run the installer. SmartScreen may warn that the publisher is unknown — click **More info → Run anyway**.
2. The app installs to `%LOCALAPPDATA%\FlagLabel` and adds a Start-menu shortcut.

Updates install automatically — when a new version is published, FlagLabel will prompt you on next launch.

---

## Workflow

1. **⌘O** to open a single image, or **⌘⇧O** to open a folder and step through it with `←` / `→`.
2. Pick a transect: **L / C / R** (or buttons `1 / 2 / 3`).
3. Set distance with the number input or **↑ / ↓** (hold shift for 0.5 m steps).
4. Click on the wire–ground intersection — the click lands at the cursor, and a colored dot + label (e.g. `L1`) appears on the main image and in the zoom panel.
5. With **Auto-advance** on (default), distance auto-bumps 1 → 15 then stops.
6. **⌘S** to save, or just keep working — clicks auto-save 5 s after the last edit. The first save asks for a folder; that folder is remembered.

Re-opening an image whose JSON already exists in the saved folder auto-loads the previous clicks. In folder mode, the sidebar shows per-image click counts so you can see at a glance how much of the batch is done.

### Editing existing clicks

Click on a placed marker to select it. While selected:

- **1 / 2 / 3** re-tags it to L / C / R.
- **↑ / ↓** (with ⇧ for 0.5 m) nudges its distance.
- **Delete** / **Backspace** removes it.
- **Esc** clears the selection.

### Zoom and pan

The main image supports trackpad pinch or mouse wheel to zoom around the cursor, and **Space + drag** (or middle-mouse drag) to pan. The 360 px zoom panel on the right stays at its own fixed magnification for precision clicking.

### Keyboard cheatsheet

| Key | Action |
|-----|--------|
| ⌘O / ⌘⇧O | Open image / open folder |
| ⌘S | Save |
| ⌘Z | Undo last click |
| ← / → | Previous / next image in folder |
| 1 / 2 / 3 | Transect L / C / R (or re-tag selected click) |
| ↑ / ↓ | Distance ±1 m (or nudge selected click) |
| ⇧↑ / ⇧↓ | Distance ±0.5 m |
| Delete / ⌫ | Delete selected click |
| Esc | Clear selection / close help |
| A | Toggle auto-advance |
| [ / ] | Zoom-panel radius − / + 5 px |
| = / − | Main-image zoom in / out |
| 0 | Reset main-image zoom |
| Space (drag) | Pan main image |
| ? or ⌘/ | Toggle keyboard help overlay |

Shortcuts that aren't ⌘O/⌘S are ignored while the distance input is focused, so you can type freely.

On Windows, swap **⌘** for **Ctrl** in every shortcut above.

---

## Output format

One JSON file per image, saved as `<site>__<imagestem>.json` in the folder you choose on first save:

```json
{
  "site": "site1",
  "image": "flag_photo.JPG",
  "image_w": 4032,
  "image_h": 3024,
  "click_type": "wire_ground_intersection",
  "note": "Click at the wire-ground intersection (base), not the flag head.",
  "clicks": [
    { "u": 1234.5, "v": 2100.3, "transect": "L", "distance": 1 }
  ]
}
```

`u` and `v` are image-pixel coordinates (origin top-left). `site` is the parent folder name of the source image.

---

## Reporting issues

Bug reports and feature requests are welcome on the [issue tracker](https://github.com/toqitahamid/FlagLabel/issues). Please include your OS version, FlagLabel version (shown in the menu bar → FlagLabel → About), and a screenshot or sample image if the bug is visual.
