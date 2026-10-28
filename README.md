# FlagLabel

A keyboard-driven annotation tool for distance-flag calibration in wildlife camera-trap surveys.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.4.0-informational.svg)](https://github.com/toqitahamid/FlagLabel/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Web-lightgrey.svg)](#installation)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-24C8DB.svg)](https://tauri.app)
[![Web app](https://img.shields.io/badge/web%20app-flaglabel.vercel.app-34a382.svg)](https://flaglabel.vercel.app)

## Overview

Camera-trap distance sampling needs to know how far an animal is from the camera. To calibrate each trail camera, researchers place numbered flags at known ground distances along three transects (Left, Center, Right) in front of the camera and take reference photos. Marking exactly where each flag's wire meets the ground in those photos ties image pixels to known metric distances, which downstream code uses for camera calibration and distance estimation.

FlagLabel is built for that one task. Open an image, pick a transect, set a distance, and click the wire–ground intersection. You can also mark the flag's known physical dimensions in pixels: a vertical or horizontal span across the flag body, or a flag-to-ground span from the flag top down to the wire base. These give downstream code several pixel-per-centimeter references for distance calibration. A 360 px zoom panel supports sub-pixel placement, and folder mode steps through a whole site of photos from the keyboard.

Each image produces one small JSON file with image-pixel coordinates for every annotation, the transect and distance tagged on each, and the flag's known real-world dimensions.

FlagLabel was used to produce the [camtrap-distance-flags](https://huggingface.co/datasets/toqi/camtrap-distance-flags) dataset.

## Features

- Annotation types, each tagged with a transect (`L`/`C`/`R`) and a distance in meters:
  - wire–ground (ground-contact) points, one click each
  - flag-body spans: vertical, horizontal, and flag-to-ground (two clicks each)
  - boxes around the whole flag
  - masks, either proposed by an optional SAM3 segmentation service or traced by hand as polygons
- Keyboard-driven: every tool, transect, distance step, and navigation action has a shortcut.
- 360 px zoom panel at fixed magnification; span endpoints, box corners, and polygon vertices can be placed on either the main image or the zoom panel.
- Folder mode with per-image annotation counts, so you can see how much of a batch is done.
- Auto-save 5 s after the last edit; re-opening an image reloads its saved annotations.
- One JSON file per image (schema v2) with image-pixel coordinates.
- Desktop app for macOS (Apple Silicon) and Windows (x64), about a 5 MB installer, with automatic updates. A web build with a shared central dataset is also available.

## Installation

### Desktop (macOS and Windows)

Download the latest installer from the [Releases](https://github.com/toqitahamid/FlagLabel/releases) page.

**macOS** (Apple Silicon): `FlagLabel_<version>_aarch64.dmg`

1. Open the `.dmg` and drag `FlagLabel.app` into `/Applications`.
2. Remove the quarantine attribute (see the note below).
3. Double-click to open.

> **macOS: first launch**
>
> FlagLabel is not notarized with an Apple Developer ID, so Gatekeeper blocks it on first launch with "FlagLabel is damaged and can't be opened". Remove the quarantine attribute macOS adds to downloaded files:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/FlagLabel.app
> ```
>
> If you skipped this step, you can still launch the app from **System Settings → Privacy & Security → Open Anyway** after the block dialog appears.

**Windows** (x64): `FlagLabel_<version>_x64-setup.exe` or `FlagLabel_<version>_x64_en-US.msi`

1. Run the installer. SmartScreen may warn that the publisher is unknown. Click **More info → Run anyway**.
2. The app installs to `%LOCALAPPDATA%\FlagLabel` and adds a Start-menu shortcut.

Updates install automatically. When a new version is published, FlagLabel prompts you on the next launch.

### Web

The web build runs at [flaglabel.vercel.app](https://flaglabel.vercel.app). It stores images and annotations in a shared central dataset so several labelers can work on the same project without installing anything. Sign-in is by a one-time code sent to your email, and accounts are created by an administrator. The desktop app works offline, needs no account, and reads images from a local folder.

## Usage

1. Open a single image (**⌘O**) or a folder (**⌘⇧O**) and step through it with **←** / **→**.
2. Pick an annotation type: **Q** wire–ground point (default), **W** vertical span, **E** horizontal span, **R** flag-to-ground span, **T** box, **Y** mask, **P** hand-drawn polygon.
3. Pick a transect with **1** / **2** / **3** (L / C / R) and set the distance with the number input or **↑** / **↓** (hold **⇧** for 0.5 m steps).
4. Place the annotation: one click for a point, two clicks for a span or box, or vertex-by-vertex clicks for a polygon.
5. Save with **⌘S**, or keep working: annotations auto-save 5 s after the last edit. The first save asks for a folder, which is remembered.

The [user guide](docs/user-guide.md) covers each annotation type, editing existing annotations, zoom and pan, and per-user tool access on the web build.

### Keyboard shortcuts

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

Shortcuts other than ⌘O and ⌘S are ignored while the distance input is focused, so you can type freely. On Windows, use **Ctrl** in place of **⌘**.

## Output format

FlagLabel writes one JSON file per image, saved as `<site>__<imagestem>.json` in the folder you choose on first save:

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

- All coordinates are image pixels with the origin at the top-left.
- `wire_ground_points` each hold a single click, `u`/`v`.
- The three span arrays (`flag_vertical_spans`, `flag_horizontal_spans`, `flag_to_ground_spans`) each hold two endpoints, `u1`/`v1` → `u2`/`v2`.
- `flag_boxes` uses the same two-point shape. `u1`/`v1` is always the top-left corner and `u2`/`v2` the bottom-right, whichever corner was clicked first.
- `flag_masks` has a different geometry. `rings` is a list of closed rings (a mask can be split into several pieces or have a hole); each ring is a list of `[u, v]` vertices rounded to 1 decimal. `score` is the model's confidence for an accepted SAM3 candidate and is exactly `1` for a hand-drawn polygon. SAM3 scores are below 1 in practice, so `score == 1` identifies a traced outline. A hand-drawn mask always has a single ring.
- Every annotation carries its own `transect` (`L`/`C`/`R`) and `distance` (meters). Any array can be empty.
- `reference_dimensions_cm` records the flag's known real-world sizes in centimeters, so calibration code can turn pixel spans into a distance estimate.
- `site` is the parent folder name of the source image.

**Schema versions.** Schema v2 was introduced in FlagLabel 0.2.0. Files written before that used a single `clicks` array with a `click_type` field; 0.2.0 dropped support for them and treats them as empty. `flag_boxes` and `flag_masks` were added later as additive keys with no version bump: older files without them still load, and a reader that only knows the four original arrays can ignore the new keys. `schema_version` is reserved for a breaking layout change. See [ADR 0001](docs/adr/0001-clicks-json-schema-v2-span-annotations.md) for the design record.

## Optional: SAM3 mask segmentation

Mask suggestions are optional. They need a SAM3 segmentation service running on a separate GPU server, reached over an SSH tunnel; FlagLabel never runs a model itself. All other annotation types, including hand-drawn polygon masks, work without it.

Set up the tunnel so the service is reachable locally:

```bash
ssh -N -L 8765:127.0.0.1:8765 <gpu-host>
```

The app defaults to `http://127.0.0.1:8765`. If your tunnel uses a different port, change the URL in the **Segment** section of the right rail; on desktop it is remembered between launches.

With the tunnel up, draw a flag box (**T**), select it, and press **M**. The app uploads the image once per photo (the embedding is cached and reused for every box in that photo), then asks for masks inside the box. Up to three ranked candidates come back. At 15 m a flag can be smaller than a single mask cell, so which blob is the flag is ambiguous, and you choose rather than the app guessing. Refine with clicks, then press **Enter** to accept.

If the service restarts mid-session, the app re-uploads the image and retries once. If it cannot be reached at all, the rail says so; check the tunnel.

When segmentation does not find the flag, or the service is not available, trace the outline by hand with the polygon tool (**P**). It writes the same `flag_masks` entry, marked with `"score": 1`.

## Development

FlagLabel is a [Tauri 2](https://tauri.app) desktop app with a React and TypeScript frontend built with Vite. The same frontend is deployed as the web build, backed by Supabase.

Prerequisites:

- Node.js (CI uses Node 20) and npm
- Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform, for the desktop app

Commands:

```bash
npm install          # install dependencies
npm run dev          # Vite dev server for the frontend (http://localhost:1420)
npm run build        # type-check and build the frontend into dist/
npm test             # run the Vitest test suite
npm run tauri dev    # run the desktop app in development mode
npm run tauri build  # build desktop installers
```

The web build reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` at build time. Copy [`.env.example`](.env.example) to `.env.local` and fill in the values from the Supabase project's API settings. The desktop app does not use these.

Design records for the annotation schema, the web target, and web authentication are in [docs/adr](docs/adr). Release notes are in [CHANGELOG.md](CHANGELOG.md).

## Related resources

- [CamTrap Measure](https://github.com/toqitahamid/camtrap-measure) uses FlagLabel annotations.
- [camtrap-distance](https://github.com/toqitahamid/camtrap-distance): code for the paper "Reference-Conditioned Distance Intervals on Unseen Camera Traps".
- [camtrap-distance-flags](https://huggingface.co/datasets/toqi/camtrap-distance-flags): the flag annotation dataset produced with FlagLabel.

## Reporting issues

Bug reports and feature requests are welcome on the [issue tracker](https://github.com/toqitahamid/FlagLabel/issues). Please include your OS version, your FlagLabel version (shown under menu bar → FlagLabel → About), and a screenshot or sample image if the bug is visual.

## Citation

If you use FlagLabel, please cite the software. Citation metadata is also in [CITATION.cff](CITATION.cff).

```bibtex
@software{sarker2026flaglabel,
  title   = {FlagLabel: Annotation Tool for Camera-Trap Calibration Flags},
  author  = {Sarker, Toqi Tahamid and Islam, Taminul and Morelock, Seth J. and Bastille-Rousseau, Guillaume and Ahmed, Khaled R.},
  year    = {2026},
  version = {0.4.0},
  url     = {https://github.com/toqitahamid/FlagLabel},
  license = {MIT}
}
```

The accompanying paper:

```bibtex
@inproceedings{sarker2026reference,
  title     = {Reference-Conditioned Distance Intervals on Unseen Camera Traps},
  author    = {Sarker, Toqi Tahamid and Islam, Taminul and Morelock, Seth J. and Bastille-Rousseau, Guillaume and Ahmed, Khaled R.},
  booktitle = {Computer Vision for Ecology Workshop, European Conference on Computer Vision (ECCV)},
  year      = {2026}
}
```

## License

FlagLabel is released under the [MIT License](LICENSE).

## Acknowledgments

FlagLabel was developed at Southern Illinois University Carbondale. Mask suggestions use a separately hosted [SAM 3](https://github.com/facebookresearch/sam3) segmentation service.
