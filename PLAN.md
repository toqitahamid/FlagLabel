# FlagLabel — Implementation Plan

A cross-platform desktop app for clicking wire-ground intersections of flags in
camera-trap images, with per-click metadata (transect + distance) and OTA updates.

Replaces the `1_flag_labeling.ipynb` Jupyter notebook in the CTDS v3 pipeline.

---

## 1. Goal

A single binary that a researcher can launch, open a camera-trap photo, click
flag wire-ground points with `(transect, distance)` metadata, and save a JSON
file with the **exact same schema** the v3 calibration notebook already consumes.
No regression vs. the notebook UX; some quality-of-life wins on top.

**Success criterion for v1:** Open a real `cam02` image, click 15 flags across
L/C/R transects with a working zoom panel, save the JSON, and load it
unchanged into `2_calibration.ipynb` to produce a calibration JSON.

---

## 2. Assumptions (state, don't assume silently)

1. **Single user, local-only.** No auth, no cloud sync, no multi-user labels.
2. **Desktop only.** Primary target macOS (user's machine); Tauri gives
   Windows/Linux builds for free, but they are not validated in v1.
3. **Tauri v2** (current stable, has the official `tauri-plugin-updater`).
4. **Frontend = React + TypeScript + Vite + plain HTML `<canvas>`.** Not
   `react-konva` / `fabric.js` — those add weight for what is essentially
   "draw image, draw circles, capture clicks." Canvas API is sufficient.
5. **JSON schema is frozen** — must match what the notebook writes today
   (see §5). Any change requires updating the calibration notebook too.
6. **OTA hosting = GitHub Releases.** Free, signed, no infra. Auto-update via
   `latest.json` at a known URL.
7. **Photos are read in-place from disk** (the existing `data/photos/...`
   tree). We do not copy or re-encode them.

If any of these are wrong, say so before I start.

---

## 3. Why Tauri + Canvas (and what we are NOT using)

| Choice | Rejected alternative | Why |
|---|---|---|
| Tauri v2 | Electron | 10x smaller binaries (~5–10 MB vs. 100+ MB), signed OTA built-in. |
| Tauri v2 | egui / iced / slint (pure Rust GUI) | Image + canvas + custom widgets is 5x more code in pure Rust than in HTML/Canvas. |
| Tauri v2 | Expo / React Native | Mobile-first; wrong form factor for pixel-precise clicking on 4000×3000 images. |
| HTML `<canvas>` | react-konva, fabric.js, pixi.js | One image + ~50 dots. Native canvas is ~80 lines. Libraries add weight, abstractions we don't need. |
| GitHub Releases for OTA | Self-hosted server | Free, signed, no DevOps. |

---

## 4. Architecture (boring on purpose)

```
FlagLabel/
├── src-tauri/                 # Rust backend
│   ├── src/
│   │   ├── main.rs            # Tauri setup + commands
│   │   └── io.rs              # load_image, save_json, load_json (3 functions)
│   ├── tauri.conf.json        # window size, updater config, signing pubkey
│   └── Cargo.toml
├── src/                       # React + TS frontend
│   ├── App.tsx                # top-level layout
│   ├── components/
│   │   ├── ImageCanvas.tsx    # main image + click capture + dot overlay
│   │   ├── ZoomPanel.tsx      # magnified follower
│   │   └── MetadataBar.tsx    # transect dropdown, distance input, save/undo
│   ├── state.ts               # zustand store (clicks, current image, metadata)
│   └── types.ts               # Click, ClickFile (matches notebook JSON)
├── package.json
├── PLAN.md                    # this file
└── README.md                  # user-facing how-to
```

**Frontend ↔ Backend boundary is tiny** (3 Tauri commands):

- `load_image(path: String) -> {width, height, data_url}`
- `save_clicks(path: String, payload: ClickFile)`
- `load_clicks(path: String) -> Option<ClickFile>`

Everything else (zoom math, click capture, dot rendering, auto-advance) lives
in the frontend. Backend is a thin file-I/O shim.

---

## 5. JSON Schema (DO NOT change without updating the notebook)

This is exactly what `1_flag_labeling.ipynb`'s `on_save()` writes today, so the
calibration notebook keeps working unchanged:

```json
{
  "site": "site1",
  "image": "flag_photo.JPG",
  "image_w": 4032,
  "image_h": 3024,
  "click_type": "wire_ground_intersection",
  "note": "Click at the wire-ground intersection (base), not the flag head.",
  "clicks": [
    { "u": 1234.5, "v": 2100.3, "transect": "L", "distance": 3.0 }
  ]
}
```

Filename convention: `{SITE}__{IMAGE_STEM}.json` written to the user's chosen
`clicks/` directory.

---

## 6. UX parity checklist (must match notebook before adding anything new)

- [ ] Open image from disk
- [ ] Resume: if JSON for this image exists, load existing clicks
- [ ] Transect dropdown: L / C / R, color-coded (red / yellow / blue)
- [ ] Distance field, default 1.0, step 1.0
- [ ] Auto-advance distance through 1..15 m after each click
- [ ] Hover main image → zoom panel updates live around cursor
- [ ] Click in zoom panel records at zoom-panel coords (same image, exact pixel)
- [ ] Click in main image also records
- [ ] Zoom window size slider (15–300 px half-size)
- [ ] Undo last click
- [ ] Clear all (in memory only; JSON unchanged until Save)
- [ ] Save → writes JSON in notebook-compatible schema
- [ ] Each click renders a colored dot + `{transect}{distance}` label
- [ ] Remember last-used clicks/photos folder across launches

---

## 7. OTA Updates

Tauri v2 official updater:

1. `cargo install tauri-cli` then `cargo tauri signer generate` → keypair.
   Public key into `tauri.conf.json`; private key kept off-repo.
2. `tauri.conf.json` updater block points to:
   `https://github.com/<user>/FlagLabel/releases/latest/download/latest.json`
3. CI (GitHub Actions) on git tag:
   - Build for macOS arm64 + x86_64
   - Sign with private key (from GH secret)
   - Generate `latest.json` with version + signature + download URLs
   - Attach to the GH Release
4. App on launch calls `check()` → if newer, downloads + verifies sig +
   installs on next restart.

**v1 stops at step 1–2 wired into config.** CI (step 3) is a follow-up once
the app is actually usable.

---

## 8. Milestones (each one a verifiable goal, not a vibes-check)

### M1 — Skeleton boots
- `npm create tauri-app@latest` with React+TS template, name `FlagLabel`.
- `npm run tauri dev` opens an empty window on macOS.
- **Verify:** window opens, hot-reload works.

### M2 — Load + display an image
- File-open dialog → Rust reads bytes → frontend gets a data URL.
- Image renders on a canvas at fit-to-window scale.
- **Verify:** can open `data/photos/site1/flag_photo.JPG` and see it.

### M3 — Click capture + dot overlay
- Click anywhere on the image → record `(u, v)` in image-pixel coords.
- Draw a colored dot + label at that point.
- **Verify:** click 3 times, see 3 dots in correct positions when window is
  resized (i.e., we store image-space, not screen-space).

### M4 — Zoom panel
- Hover main canvas → zoom canvas re-renders a window around the cursor.
- Click in zoom canvas also records, at image-pixel coords (not zoom coords).
- Zoom window size slider.
- **Verify:** zoom matches the notebook's behavior side-by-side on the same image.

### M5 — Metadata bar + auto-advance
- Transect dropdown (L/C/R), distance number input.
- Auto-advance distance 1..15.
- **Verify:** workflow of clicking 15 flags on one transect feels at least
  as fast as the notebook.

### M6 — Save / Load / Resume
- Save writes JSON in §5 schema to user-chosen path.
- On open, if a matching JSON exists, load existing clicks.
- Remember last-used folders (photos + clicks) in app settings.
- Undo, Clear All.
- **Verify (acceptance):**
  1. Label an image in FlagLabel, save, close the app, reopen, reload the
     same image → all clicks restored exactly.
  2. The saved `.json` is byte-compatible with the schema in §5 — so
     `2_calibration.ipynb` can still read it unchanged. (FlagLabel itself
     does no calibration; this is just a schema-compatibility check.)

### M7 — OTA wiring (config only)
- Add `tauri-plugin-updater`, generate signing keys, point `tauri.conf.json`
  at a placeholder GH Releases URL.
- App calls `check()` on startup; logs result; no UI yet.
- **Verify:** app builds, no panic on launch, `check()` returns "no updates"
  against an empty `latest.json`.

### M8 — Build + ship a `.dmg`
- `npm run tauri build` produces a signed macOS bundle.
- Install on the user's machine, replace notebook in real workflow.
- **Verify:** label one full site (e.g., cam02 first + last image) end-to-end
  using only the app. Calibration runs clean on the output.

**Anything beyond M8** (Windows builds, GH Actions CI for OTA releases,
keyboard shortcuts, batch image queue, undo stack >1 deep, multi-monitor
zoom panel, dark mode) is **out of scope for v1** and goes into a `IDEAS.md`
when we get there.

---

## 9. Decisions (resolved 2026-05-24)

1. **Repo visibility:** public. OTA URL is a public GH Releases asset, no
   auth needed in the updater request.
2. **Display name:** `FlagLabel` (one word, same as folder/repo).
3. **Last folder memory:** yes — persist last `photos/` and `clicks/` paths
   in Tauri's app config store.
4. **Annotated PNG export:** out of scope for v1. Will not implement.
5. **Calibration integration:** none. FlagLabel only does labeling. Schema
   in §5 is kept compatible with `2_calibration.ipynb` so the downstream
   notebook keeps working unchanged — but FlagLabel itself contains zero
   calibration code.

Ready to start at M1.
