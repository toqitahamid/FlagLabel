# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlagLabel is a Tauri v2 desktop app (React 19 + TypeScript frontend, Rust backend) for annotating distance flags in wildlife camera-trap photos. The core annotation is the wire–ground intersection point; since v0.2.0 it also supports three two-endpoint **spans** (vertical, horizontal, flag-to-ground) that mark the flag's known physical dimensions in pixels for distance calibration. Output is one JSON file per image (schema v2). See `README.md` for the user-facing workflow and keyboard shortcuts.

## Commands

```bash
npm run tauri dev      # full dev loop: launches Vite on :1420, builds + runs the Rust app, opens the native window
npm run dev            # Vite only (browser preview won't have Tauri APIs)
npm run build          # tsc + vite build → dist/ (web assets only; doesn't bundle the app)
npm run tauri build    # production bundle (.dmg / .msi / .exe / updater artifacts) into src-tauri/target/release/bundle
```

```bash
npm test               # vitest run — the unit suite over src/annotations/ (62 tests)
npm run test:watch     # vitest in watch mode
```

The pure annotation logic in `src/annotations/` is unit-tested with vitest; `src/App.tsx` (React/canvas glue) is not. There is no linter or formatter configured. TypeScript strictness comes from `tsc` during `npm run build` — note `noImplicitReturns` is **off**, so exhaustiveness in `switch`/`Record` maps is enforced manually with `never` guards, not by the compiler.

Dev port `1420` is hard-required by `vite.config.ts` (`strictPort: true`) because `tauri.conf.json` points `devUrl` at it. Kill stale processes on that port before `tauri dev`.

There is a local skill at `.claude/skills/run-flaglabel/` (driver.sh + SKILL.md) for launching, screenshotting, and keystroke-driving the app on macOS — prefer it over ad-hoc `npm run tauri dev` invocations when you need to verify a change visually. AppleScript cannot read Tauri WKWebView window IDs; the driver works around this with `tell process` + `screencapture -R` on logical bounds.

## Architecture

Almost the entire frontend is one file: **`src/App.tsx`** (~2400 lines). It holds all state (loaded image, annotations, folder list, active annotation type, transect/distance selection, pending span, zoom/pan, selection, dirty flag, settings) as `useState`/`useRef` inside the root `App` component. There is no router, no state library, no component split — keep new UI in this file unless you have a strong reason to extract.

The exception is **`src/annotations/`** — pure, framework-free logic extracted so it can be unit-tested without React or canvas:
- `model.ts` — the `Annotation` discriminated union (`wire_ground` + three span kinds), `SpanType`, and helpers (`canonicalizeSpan`, `countsByTransect`, `countsFromAnnotations`). Exhaustiveness over kinds is enforced with `never` guards and full `Record<>` maps.
- `schema.ts` — `buildAnnotationFile` / `parseAnnotationFile` (schema v2, per-type arrays, per-item validation) and `REFERENCE_DIMENSIONS_CM`.
- `hit-test.ts`, `pending-span.ts`, `collision.ts` — selection hit-testing, the two-click span reducer, and same-(transect, distance, kind) collision detection.

Key invariants:
- Coordinates are stored in **image pixels** (origin top-left), not view pixels: wire-ground points carry `{u, v}`; spans carry two endpoints `{u1, v1, u2, v2}`. Conversion happens in `computeViewParams` and the click handlers — preserve this when touching zoom/pan code.
- The right-rail zoom panel has its own independent magnification (the `ZOOM_*` constants); the main-image zoom (`VIEW_SCALE_*`) is separate. Don't conflate them. Spans can have endpoints placed across both the main image and the zoom panel, and the zoom panel must draw any span whose bounding box intersects its window (AABB test, not endpoint-in-window — a v0.2.0 fix for long flag-to-ground spans).
- Auto-save fires 5 seconds after the last edit when `dirty` is true. The `dirty` check must be the gate — never gate on annotation count, because clearing all annotations on a previously-saved image is a legitimate save (this regression was fixed in v0.1.2; see commit c32e1d9).
- The native menu bar is built programmatically in a `useEffect` on mount via `@tauri-apps/api/menu` — modifying File/Edit shortcuts means editing that effect, not a config file.

### Rust backend (`src-tauri/src/lib.rs`)

Three commands, intentionally minimal:
- `write_text_file(path, content)` — creates parent dirs, writes UTF-8
- `read_text_file(path)` — returns `Option<String>` (None if file missing, not an error)
- `list_images_in_dir(path)` — sorted `.jpg/.jpeg/.png`, skips dotfiles

Image loading uses Tauri's `convertFileSrc` against the asset protocol (configured with `scope: ["**"]` in `tauri.conf.json`) — the frontend never reads image bytes through a custom command.

Plugins enabled: `dialog`, `opener`, `store`, `updater`, `process`. Permissions for these are declared in `src-tauri/capabilities/default.json`; new plugin APIs need their permission added there.

### Persistence

- **Per-image annotations**: JSON file `<site>__<imagestem>.json` in the user-chosen clicks folder. Schema v2 carries `schema_version`, `reference_dimensions_cm`, and one array per annotation type (`wire_ground_points`, `flag_vertical_spans`, `flag_horizontal_spans`, `flag_to_ground_spans`); full schema is documented in README and built by `src/annotations/schema.ts`. v0.2.0 dropped the v1 single-`clicks` format — older files load as empty. `site` is the parent folder name of the image.
- **App settings**: `tauri-plugin-store` writes `settings.json` in the OS app-data dir. Currently just `clicks_dir`.

## Release process

Releases are **automatic on a version bump pushed to `main`** — no tag step. `.github/workflows/release.yml` triggers on a push to `main` that touches `package.json`, `src-tauri/tauri.conf.json`, or `src-tauri/Cargo.toml`. A `check` job reads the version from `package.json`, fails loudly if the three version files disagree, and skips if a release for that version already exists (so re-pushing `main` is idempotent). When the version is new it runs `tauri-action` on macOS-latest (aarch64) and windows-latest in parallel and **publishes** a live GitHub release (tag `vX.Y.Z`) with the matching CHANGELOG section as the body, uploading installers + `latest.json` for the updater.

To cut a release:
1. Bump the version in **three** files — they must match exactly, or the `check` job fails the run:
   - `package.json` (`version`)
   - `src-tauri/tauri.conf.json` (`version`)
   - `src-tauri/Cargo.toml` (`[package].version`) — and run `cargo check` or `npm run tauri build` once so `Cargo.lock` updates
2. Add a `## vX.Y.Z` section to `CHANGELOG.md`. The release workflow extracts text between `## vX.Y.Z` and the next `## v` heading via awk — the header format must be exact, or the release body falls back to a generic message.
3. Commit and push to `main`. That's it — the workflow tags, builds, and publishes automatically.

The release **publishes live immediately** (no draft/manual gate), so the auto-updater picks it up as soon as the build finishes. There is no smoke-test checkpoint before users see it — verify on a branch/`workflow_dispatch` run first if a release is risky. The updater endpoint is `https://github.com/toqitahamid/FlagLabel/releases/latest/download/latest.json`. To re-run a build manually (e.g. after a transient CI failure) without bumping again, use the **Run workflow** button on the Actions tab (`workflow_dispatch`); it re-derives the version from `package.json` and skips if that release already exists.

Two release-time gotchas that have bitten before:
- The `TAURI_SIGNING_PRIVATE_KEY` secret must be the **raw** minisign key with no trailing newline and no double-base64 wrapping. If macOS builds fail with a base64 decode error, the secret is malformed.
- The signing key's pubkey embedded in `tauri.conf.json` (`plugins.updater.pubkey`) must match the private key — rotating one without the other breaks auto-update on already-installed clients.

## macOS distribution

The app is **not** notarized with an Apple Developer ID. First-launch on a downloaded `.dmg` will fail with "FlagLabel is damaged" because of Gatekeeper quarantine. The README documents the `xattr -dr com.apple.quarantine` workaround — keep that section accurate if install behavior changes.

## Memory / context

This repo has a claude-mem corpus with substantial history (architecture map, prior bugfixes, release-process pitfalls). When picking up an unfamiliar area, prefer `mem-search` over re-reading large files.

## Agent skills

### Issue tracker

GitHub Issues at github.com/toqitahamid/FlagLabel (uses `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.
