# FlagLabel

A fast, keyboard-driven desktop labeler for distance-flag calibration in wildlife camera-trap surveys.

Researchers running camera-trap distance sampling place numbered flags along three transects (Left, Center, Right) at known distances, then need to mark exactly where each flag's wire meets the ground in every reference photo. FlagLabel makes that the entire app: open an image, pick a transect, tap a distance, click the wire–ground intersection. You can also mark the flag's known physical dimensions in pixels — a vertical or horizontal span across the flag body, or a flag-to-ground span from the flag top down to the wire base — giving downstream code several pixel-per-centimeter references for distance calibration. The 360 px zoom panel lets you place every point to sub-pixel precision; folder mode walks a whole site of photos without ever leaving the keyboard.

Each image becomes one small JSON file with image-pixel coordinates for every annotation, the transect/distance you tagged, and the flag's known real-world dimensions, ready for downstream camera-calibration code.

Available for macOS (Apple Silicon) and Windows (x64). ~5 MB installer.

---

## Install

Grab the latest installer from the [Releases](https://github.com/toqitahamid/FlagLabel/releases) page.

**macOS** (Apple Silicon): `FlagLabel_<version>_aarch64.dmg`

1. Open the `.dmg` and drag `FlagLabel.app` into `/Applications`.
2. Remove the quarantine flag macOS adds to anything downloaded from the web:

   ```bash
   xattr -dr com.apple.quarantine /Applications/FlagLabel.app
   ```

   Without this, macOS will refuse to open the app with *"FlagLabel is damaged and can't be opened"* — FlagLabel isn't notarized with an Apple Developer ID, so Gatekeeper blocks it on first launch.

3. Double-click to open. If you skipped step 2, you can still launch it via **System Settings → Privacy & Security → Open Anyway** after the block dialog appears.

**Windows** (x64): `FlagLabel_<version>_x64-setup.exe` or `FlagLabel_<version>_x64_en-US.msi`

1. Run the installer. SmartScreen may warn that the publisher is unknown — click **More info → Run anyway**.
2. The app installs to `%LOCALAPPDATA%\FlagLabel` and adds a Start-menu shortcut.

Updates install automatically — when a new version is published, FlagLabel will prompt you on next launch.

---

## Workflow

1. **⌘O** to open a single image, or **⌘⇧O** to open a folder and step through it with `←` / `→`.
2. Pick what to mark with **Q / W / E / R / T / Y / P** (or the rail buttons): a **wire–ground point** (`Q`, the default); a **vertical** (`W`), **horizontal** (`E`), or **flag-to-ground** (`R`) span; a **box** (`T`) around the whole flag; an accepted **mask** (`Y`, for selecting one — SAM3 masks are created from a box, see below); or a hand-drawn **polygon** (`P`), which produces a mask by tracing.
   > The **box**, **mask** and **polygon** tools (`T` / `Y` / `P`, and the `M` / `C` mask keys) are granted per user on the web build — not by the admin role. Someone who already has them can grant or revoke access in **Manage users**; the change takes effect the next time the person loads FlagLabel. Boxes and masks already saved in a file stay visible and are preserved on save for everyone.
3. Pick a transect: **L / C / R** (or buttons `1 / 2 / 3`), and set distance with the number input or **↑ / ↓** (hold shift for 0.5 m steps).
4. Place the annotation:
   - **Wire–ground point** — one click at the wire–ground intersection. A colored dot + label (e.g. `L1`) appears on the main image and in the zoom panel.
   - **Spans** — two clicks: the first pins one end, a ghost line follows the cursor, the second completes it. Endpoints can land on either the main image or the zoom panel; **Esc** cancels a half-placed span. Each flag carries the spans independently, so far flags can hold only the ones still visible.
   - **Box** — two clicks on opposite corners, with a live rubber-band rectangle in between. Either corner can go first; the box is stored top-left → bottom-right regardless. Corners can land on either the main image or the zoom panel, and **Esc** cancels a half-drawn box.
   - **Mask** — not clicked directly. Select a box you've drawn and press **M**; the SAM3 service segments the flag inside it and proposes up to three candidate masks. Press **C** to cycle candidates, click to add a positive refinement point (**⇧click** for negative, **Del** to undo the last one), and **Enter** to accept. **Esc** discards without saving anything. The accepted mask inherits the box's transect and distance, and the prompt box is deleted automatically — the mask replaces it. (To re-mask a flag later, draw a fresh box.) See [Mask segmentation](#mask-segmentation-sam3).
   - **Polygon** — the manual fallback for flags SAM3 can't segment (too small, too far, too low-contrast). Press **P**, then click the flag's outline vertex by vertex; a solid line joins the placed vertices while a dashed segment follows the cursor and a dashed hint shows where the outline would close. **Enter** closes it (3 vertices minimum) into a mask, **Del** / **⌫** removes the last vertex, and **Esc** discards the whole outline. Vertices can land on either the main image or the zoom panel — the panel is usually where a distant flag's edge is actually visible. The transect and distance are captured on the **first** click and kept for the whole outline, so changing the rail selection mid-trace won't retag it; the rail hint shows the pair it will commit with. Hand-drawn masks are stored exactly like segmented ones, but always with `"score": 1` (see [Output format](#output-format)).
5. **⌘S** to save, or just keep working — annotations auto-save 5 s after the last edit. The first save asks for a folder; that folder is remembered.

Re-opening an image whose JSON already exists in the saved folder auto-loads the previous annotations. In folder mode, the sidebar shows per-image annotation counts so you can see at a glance how much of the batch is done.

### Editing existing annotations

Click on a placed marker or span to select it. While selected:

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
| ⌘Z | Undo last annotation |
| ← / → | Previous / next image in folder |
| Q / W / E / R / T / Y / P | Annotation type: wire–ground / vertical / horizontal / flag→ground / box / mask / hand-drawn polygon |
| click ×2 | Place a span (endpoint 1, then endpoint 2) or a box (two opposite corners) |
| 1 / 2 / 3 | Transect L / C / R (or re-tag selected annotation) |
| ↑ / ↓ | Distance ±1 m (or nudge selected annotation) |
| ⇧↑ / ⇧↓ | Distance ±0.5 m |
| Delete / ⌫ | Delete selected annotation (or undo the last refinement point / polygon vertex) |
| M | Segment the selected flag box (SAM3) |
| C | Cycle candidate masks |
| ↵ | Accept the shown candidate mask, or close a hand-drawn polygon (3+ vertices) |
| ⇧click | Add a negative refinement point |
| Esc | Cancel a mask session / hand-drawn polygon / half-placed span or box / clear selection / close help |
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
  "schema_version": 2,
  "site": "site1",
  "image": "flag_photo.JPG",
  "image_w": 4032,
  "image_h": 3024,
  "reference_dimensions_cm": {
    "flag_body_h": 6.35,
    "flag_body_w": 8.89,
    "wire_total": 53.34,
    "wire_above_ground": 49.53,
    "wire_buried": 3.81
  },
  "created_at": "2026-06-03T09:30:00.000Z",
  "app_version": "0.4.0",
  "wire_ground_points": [
    { "u": 1234.5, "v": 2100.3, "transect": "L", "distance": 1 }
  ],
  "flag_vertical_spans": [
    { "u1": 1230.0, "v1": 1990.0, "u2": 1232.0, "v2": 2060.0, "transect": "L", "distance": 1 }
  ],
  "flag_horizontal_spans": [],
  "flag_to_ground_spans": [
    { "u1": 1231.0, "v1": 1985.0, "u2": 1234.5, "v2": 2100.3, "transect": "L", "distance": 1 }
  ],
  "flag_boxes": [
    { "u1": 1225.0, "v1": 1982.0, "u2": 1240.0, "v2": 2062.0, "transect": "L", "distance": 1 }
  ],
  "flag_masks": [
    {
      "rings": [[[1226.0, 1983.0], [1239.0, 1983.0], [1239.0, 2061.0], [1226.0, 2061.0]]],
      "score": 0.94,
      "transect": "L",
      "distance": 1
    }
  ]
}
```

All coordinates are image pixels with the origin at the top-left. `wire_ground_points` each hold a single click `u`/`v`; the three span arrays each hold two endpoints, `u1`/`v1` → `u2`/`v2`. `flag_boxes` uses the same two-point shape, where `u1`/`v1` is the box's **top-left** corner and `u2`/`v2` its **bottom-right** — always in that order, whichever corner was clicked first. `flag_masks` is the one array with a different geometry: `rings` is a **list of closed rings** (a mask can be split into several pieces, or have a hole), each ring a list of `[u, v]` vertices rounded to 1 decimal, plus a `score`. `score` is the model's confidence for an accepted SAM3 candidate, and is **exactly `1`** for a hand-drawn polygon (`P`) — SAM3 scores are below 1 in practice, so `score == 1` is how a downstream consumer tells a traced outline from a segmented one. A hand-drawn mask always has a single ring. Every annotation carries its own `transect` (`L`/`C`/`R`) and `distance` (meters), and any array can be empty. `reference_dimensions_cm` records the flag's known real-world sizes (centimeters) so calibration code can turn pixel spans into a distance estimate; `site` is the parent folder name of the source image.

> **Schema v2** (FlagLabel 0.2.0+). Files written before that used a single `clicks` array with a `click_type` field; v0.2.0 dropped support and treats those as empty.
>
> `flag_boxes` and `flag_masks` were both added later as purely **additive** keys, with no version bump: files written before them simply lack the arrays and still load, and a reader that only knows the four original arrays can ignore the new keys safely. `schema_version` is reserved for a breaking layout change.

---

## Mask segmentation (SAM3)

Masks come from a SAM3 segmentation service running on a GPU box, reached over an SSH tunnel — the app never runs a model itself. Set the tunnel up so the service is reachable locally:

```
ssh -N -L 8765:127.0.0.1:8765 <gpu-host>
```

The app defaults to `http://127.0.0.1:8765`. If your tunnel uses a different port, change the URL in the **Segment** section of the right rail; on desktop it is remembered between launches.

With the tunnel up: draw a flag box (**T**), select it, and press **M**. The app uploads the image once per photo (the embedding is cached and reused for every box in that photo), then asks for masks inside the box. Up to three candidates come back, ranked — at 15 m a flag can be smaller than a single mask cell, so which blob *is* the flag is genuinely ambiguous and you choose rather than the app guessing. Refine with clicks, then **Enter** to accept.

If the service restarts mid-session the app re-uploads the image and retries once, so you shouldn't notice. If it can't be reached at all, the rail says so — check the tunnel.

When segmentation just won't find the flag — or the service isn't available at all — trace the outline by hand with the polygon tool (**P**) instead. It writes the same `flag_masks` entry, marked with `"score": 1`.

---

## Reporting issues

Bug reports and feature requests are welcome on the [issue tracker](https://github.com/toqitahamid/FlagLabel/issues). Please include your OS version, FlagLabel version (shown in the menu bar → FlagLabel → About), and a screenshot or sample image if the bug is visual.
