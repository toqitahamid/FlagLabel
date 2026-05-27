# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlagLabel is a Tauri v2 desktop app (React 19 + TypeScript frontend, Rust backend) for clicking the wire–ground intersection of distance flags in wildlife camera-trap photos. Output is one JSON file per image. See `README.md` for the user-facing workflow and keyboard shortcuts.

## Commands

```bash
npm run tauri dev      # full dev loop: launches Vite on :1420, builds + runs the Rust app, opens the native window
npm run dev            # Vite only (browser preview won't have Tauri APIs)
npm run build          # tsc + vite build → dist/ (web assets only; doesn't bundle the app)
npm run tauri build    # production bundle (.dmg / .msi / .exe / updater artifacts) into src-tauri/target/release/bundle
```

There is no test suite, linter, or formatter configured. TypeScript strictness comes from `tsc` during `npm run build`.

Dev port `1420` is hard-required by `vite.config.ts` (`strictPort: true`) because `tauri.conf.json` points `devUrl` at it. Kill stale processes on that port before `tauri dev`.

There is a local skill at `.claude/skills/run-flaglabel/` (driver.sh + SKILL.md) for launching, screenshotting, and keystroke-driving the app on macOS — prefer it over ad-hoc `npm run tauri dev` invocations when you need to verify a change visually. AppleScript cannot read Tauri WKWebView window IDs; the driver works around this with `tell process` + `screencapture -R` on logical bounds.

## Architecture

The entire frontend is one file: **`src/App.tsx`** (~1800 lines). It holds all state (loaded image, clicks, folder list, transect/distance selection, zoom/pan, selection, dirty flag, settings) as `useState`/`useRef` inside the root `App` component. There is no router, no state library, no component split — keep new UI in this file unless you have a strong reason to extract.

Key invariants in `App.tsx`:
- Click coordinates `{u, v}` are stored in **image pixels** (origin top-left), not view pixels. Conversion happens in `computeViewParams` and the click handlers — preserve this when touching zoom/pan code.
- The right-rail zoom panel has its own independent magnification (the `ZOOM_*` constants); the main-image zoom (`VIEW_SCALE_*`) is separate. Don't conflate them.
- Auto-save fires 5 seconds after the last edit when `dirty` is true. The `dirty` check must be the gate — never gate on `clicks.length`, because clearing all clicks on a previously-saved image is a legitimate save (this regression was fixed in v0.1.2; see commit c32e1d9).
- The native menu bar is built programmatically in a `useEffect` on mount via `@tauri-apps/api/menu` — modifying File/Edit shortcuts means editing that effect, not a config file.

### Rust backend (`src-tauri/src/lib.rs`)

Three commands, intentionally minimal:
- `write_text_file(path, content)` — creates parent dirs, writes UTF-8
- `read_text_file(path)` — returns `Option<String>` (None if file missing, not an error)
- `list_images_in_dir(path)` — sorted `.jpg/.jpeg/.png`, skips dotfiles

Image loading uses Tauri's `convertFileSrc` against the asset protocol (configured with `scope: ["**"]` in `tauri.conf.json`) — the frontend never reads image bytes through a custom command.

Plugins enabled: `dialog`, `opener`, `store`, `updater`, `process`. Permissions for these are declared in `src-tauri/capabilities/default.json`; new plugin APIs need their permission added there.

### Persistence

- **Per-image clicks**: JSON file `<site>__<imagestem>.json` in the user-chosen clicks folder. Schema is documented in README. `site` is the parent folder name of the image.
- **App settings**: `tauri-plugin-store` writes `settings.json` in the OS app-data dir. Currently just `clicks_dir`.

## Release process

Releases are driven by pushing a `vX.Y.Z` tag. `.github/workflows/release.yml` runs `tauri-action` on macOS-latest (aarch64) and windows-latest in parallel, creates a **draft** GitHub release with the matching CHANGELOG section as the body, and uploads installers + `latest.json` for the updater.

To cut a release:
1. Bump the version in **three** files — they must match:
   - `package.json` (`version`)
   - `src-tauri/tauri.conf.json` (`version`)
   - `src-tauri/Cargo.toml` (`[package].version`) — and run `cargo check` or `npm run tauri build` once so `Cargo.lock` updates
2. Add a `## vX.Y.Z` section to `CHANGELOG.md`. The release workflow extracts text between `## vX.Y.Z` and the next `## v` heading via awk — the header format must be exact, or the release body falls back to a generic message.
3. Commit, tag `vX.Y.Z`, push tag.
4. The workflow creates a draft release. Publish it manually after smoke-testing the installers. The updater endpoint is `https://github.com/toqitahamid/FlagLabel/releases/latest/download/latest.json` — drafts don't count as "latest", so the auto-update prompt only fires once the release is published.

Two release-time gotchas that have bitten before:
- The `TAURI_SIGNING_PRIVATE_KEY` secret must be the **raw** minisign key with no trailing newline and no double-base64 wrapping. If macOS builds fail with a base64 decode error, the secret is malformed.
- The signing key's pubkey embedded in `tauri.conf.json` (`plugins.updater.pubkey`) must match the private key — rotating one without the other breaks auto-update on already-installed clients.

## macOS distribution

The app is **not** notarized with an Apple Developer ID. First-launch on a downloaded `.dmg` will fail with "FlagLabel is damaged" because of Gatekeeper quarantine. The README documents the `xattr -dr com.apple.quarantine` workaround — keep that section accurate if install behavior changes.

## Memory / context

This repo has a claude-mem corpus with substantial history (architecture map, prior bugfixes, release-process pitfalls). When picking up an unfamiliar area, prefer `mem-search` over re-reading large files.
