# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FlagLabel is a Tauri v2 desktop app (React 19 + TypeScript frontend, Rust backend) for annotating distance flags in wildlife camera-trap photos. The core annotation is the wire–ground intersection point; since v0.2.0 it also supports three two-endpoint **spans** (vertical, horizontal, flag-to-ground) that mark the flag's known physical dimensions in pixels for distance calibration. Output is one JSON file per image (schema v2). See `README.md` for the user-facing workflow and keyboard shortcuts.

## Commands

Standard `npm` scripts (see `package.json`). Two things that aren't obvious from them:

- `npm run dev` is Vite only — a browser preview won't have Tauri APIs. Use `npm run tauri dev` for the real loop.
- `npm run build` builds web assets only; `npm run tauri build` produces the actual installers.

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

Three commands, intentionally minimal — keep it that way. Note `read_text_file` returns `Option<String>`: a missing file is `None`, not an error.

Image loading uses Tauri's `convertFileSrc` against the asset protocol (configured with `scope: ["**"]` in `tauri.conf.json`) — the frontend never reads image bytes through a custom command.

Plugins enabled: `dialog`, `opener`, `store`, `updater`, `process`. Permissions for these are declared in `src-tauri/capabilities/default.json`; new plugin APIs need their permission added there.

### Persistence

- **Per-image annotations**: JSON file `<site>__<imagestem>.json` in the user-chosen clicks folder, where `site` is the parent folder name of the image. Full schema v2 is documented in README and built by `src/annotations/schema.ts`. v0.2.0 dropped the v1 single-`clicks` format — older files load as empty.
- **App settings**: `tauri-plugin-store` writes `settings.json` in the OS app-data dir. Currently just `clicks_dir`.

## Release process

Releases fire **automatically on a version bump pushed to `main`** and **publish live immediately** — no tag step, no draft, no manual gate, no smoke-test checkpoint before users get the auto-update. Verify a risky release on a branch/`workflow_dispatch` run first.

Full procedure (three version files that must match, CHANGELOG header format, signing-key gotchas, re-running a build): see the `release` skill at `.claude/skills/release/SKILL.md`.

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
