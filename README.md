# FlagLabel

Desktop app for clicking wire–ground intersections of flags in wildlife camera-trap images. Outputs a JSON file per image, designed to drop into the existing CTDS calibration pipeline (`2_calibration.ipynb`) without changes.

Built with Tauri 2 + React + TypeScript. macOS only for now.

---

## Install

1. Grab the latest `FlagLabel_<version>_aarch64.dmg` from `src-tauri/target/release/bundle/dmg/` (after a build) or from a GitHub Release once one is cut.
2. Open the `.dmg` and drag `FlagLabel.app` into `/Applications`.
3. First launch only: right-click the app in `/Applications` → **Open** → **Open anyway**. macOS blocks unsigned apps by default; this exception is remembered.

The bundle is ~5 MB. There is no Apple Developer ID code signature — that is a separate (paid) signing identity from the updater signing key.

---

## Workflow

1. **⌘O** — open an image (JPG/PNG).
2. Pick a transect: **L / C / R** (or buttons `1 / 2 / 3`).
3. Set distance with the number input or **↑ / ↓** (hold shift for 0.5 m steps).
4. Click on the wire–ground intersection — the click lands at the cursor, and a colored dot + label (e.g. `L1`) appears on the main image and in the zoom panel.
5. With **Auto-advance** on (default), distance auto-bumps 1 → 15 then stops.
6. **⌘S** to save. The first save asks for a folder; that folder is remembered.

Re-opening an image whose JSON already exists in the saved folder auto-loads the previous clicks.

### Keyboard cheatsheet

| Key | Action |
|-----|--------|
| ⌘O | Open image |
| ⌘S | Save |
| ⌘Z | Undo last click |
| 1 / 2 / 3 | Transect L / C / R |
| ↑ / ↓ | Distance ±1 m |
| ⇧↑ / ⇧↓ | Distance ±0.5 m |
| Space | Toggle auto-advance |
| [ / ] | Zoom radius − / + 5 px |

Shortcuts that aren't ⌘O/⌘S are ignored while the distance input is focused, so you can type freely.

---

## Output format

One JSON file per image, named `<site>__<imagestem>.json`:

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

`u` and `v` are image-pixel coordinates (origin top-left). `site` is the parent folder of the source image. This is byte-compatible with what `1_flag_labeling.ipynb` writes, so the downstream calibration notebook reads it unchanged.

---

## Develop

Requires Node 20+ and a recent Rust toolchain.

```bash
npm install
npm run tauri dev
```

The webview supports hot reload for `src/`. Rust changes in `src-tauri/` trigger a recompile (~10–30 s).

### Build a signed `.dmg`

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.flaglabel/signing.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" \
npm run tauri build
```

Outputs land in `src-tauri/target/release/bundle/`:

- `dmg/FlagLabel_<ver>_aarch64.dmg` — installer
- `macos/FlagLabel.app` — bundle
- `macos/FlagLabel.app.tar.gz` + `.sig` — signed updater payload

### Updater signing key

The Tauri OTA updater requires a keypair. The private key lives outside the repo at `~/.flaglabel/signing.key`; the public key is embedded in `src-tauri/tauri.conf.json`. **Back up the private key.** Losing it means existing installs can never auto-update — they will reject any update signed by a different key.

To regenerate (only do this if you're starting fresh — it invalidates all existing installs):

```bash
npx tauri signer generate -w ~/.flaglabel/signing.key
```

Then copy the printed public key into `tauri.conf.json` → `plugins.updater.pubkey`.

---

## Project layout

```
src/                 React UI (App.tsx, App.css)
src-tauri/
  src/lib.rs         Rust commands (file I/O)
  tauri.conf.json    Window + updater config
  capabilities/      Plugin permissions
PLAN.md              Implementation milestones (M1–M8)
UI_PLAN.md           UI design rationale
```
