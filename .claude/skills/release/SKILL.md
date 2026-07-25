---
name: release
description: Cut a FlagLabel release. Use when bumping the version, publishing a new build, editing CHANGELOG.md for a release, re-running a failed release build, or debugging the release/updater workflow (signing keys, latest.json, tauri-action).
---

# Release process

Releases are **automatic on a version bump pushed to `main`** — no tag step. `.github/workflows/release.yml` triggers on a push to `main` that touches `package.json`, `src-tauri/tauri.conf.json`, or `src-tauri/Cargo.toml`. A `check` job reads the version from `package.json`, fails loudly if the three version files disagree, and skips if a release for that version already exists (so re-pushing `main` is idempotent). When the version is new it runs `tauri-action` on macOS-latest (aarch64) and windows-latest in parallel and **publishes** a live GitHub release (tag `vX.Y.Z`) with the matching CHANGELOG section as the body, uploading installers + `latest.json` for the updater.

## ⚠️ No gate before users see it

The release **publishes live immediately** (no draft/manual gate), so the auto-updater picks it up as soon as the build finishes. There is no smoke-test checkpoint before users see it — verify on a branch/`workflow_dispatch` run first if a release is risky.

## To cut a release

1. Bump the version in **three** files — they must match exactly, or the `check` job fails the run:
   - `package.json` (`version`)
   - `src-tauri/tauri.conf.json` (`version`)
   - `src-tauri/Cargo.toml` (`[package].version`) — and run `cargo check` or `npm run tauri build` once so `Cargo.lock` updates
2. Add a `## vX.Y.Z` section to `CHANGELOG.md`. The release workflow extracts text between `## vX.Y.Z` and the next `## v` heading via awk — the header format must be exact, or the release body falls back to a generic message.
3. Commit and push to `main`. That's it — the workflow tags, builds, and publishes automatically.

## Updater and re-runs

The updater endpoint is `https://github.com/toqitahamid/FlagLabel/releases/latest/download/latest.json`. To re-run a build manually (e.g. after a transient CI failure) without bumping again, use the **Run workflow** button on the Actions tab (`workflow_dispatch`); it re-derives the version from `package.json` and skips if that release already exists.

## Two release-time gotchas that have bitten before

- The `TAURI_SIGNING_PRIVATE_KEY` secret must be the **raw** minisign key with no trailing newline and no double-base64 wrapping. If macOS builds fail with a base64 decode error, the secret is malformed.
- The signing key's pubkey embedded in `tauri.conf.json` (`plugins.updater.pubkey`) must match the private key — rotating one without the other breaks auto-update on already-installed clients.
