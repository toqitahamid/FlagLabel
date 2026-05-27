---
name: run-flaglabel
description: Use when asked to run, start, launch, build, screenshot, smoke-test, or drive the FlagLabel desktop app (Tauri + React) on macOS. Wraps Tauri dev launch, AppleScript keystroke injection, and window-cropped screencapture into a single driver.sh.
---

# run-flaglabel

FlagLabel is a Tauri 2 + React desktop labeler (single Apple Silicon macOS window). The driver at `.claude/skills/run-flaglabel/driver.sh` is the agent's hand on the app: it builds, launches, sends keys, and screenshots the real native window. All paths below are relative to the repo root.

The driver is macOS-only. Tauri's WebKit webview has no Chrome DevTools Protocol, so we drive the app through the OS — `osascript` for keystrokes and window bounds, `screencapture -R` for cropped shots.

## Prerequisites

- macOS (verified on Apple Silicon, macOS 26).
- Node ≥ 22, npm, Rust toolchain (`cargo`, `rustc`). Already present if you've built before.
- **Accessibility permission** for whichever process spawns the shell (Terminal / iTerm / Cursor / Claude Code). Without it, `osascript` keystrokes silently no-op or error with `osascript is not allowed to send keystrokes`. Grant it once at: *System Settings → Privacy & Security → Accessibility*.
- **Screen Recording permission** for the same process. Without it, `screencapture` returns a blank or wallpaper-only image — no error.

## Smoke (no GUI)

Fast pre-flight: install deps, compile the frontend, type-check the Rust backend. Use this when you only need to know the code builds.

```bash
.claude/skills/run-flaglabel/driver.sh smoke
```

Runs `npm install`, then `npm run build` (= `tsc && vite build`), then `cargo check` in `src-tauri/`. First Rust compile after a clean checkout takes 3–5 min; incremental is ~1s.

## Run (agent path)

```bash
.claude/skills/run-flaglabel/driver.sh start          # spawn tauri dev, wait until window exists
.claude/skills/run-flaglabel/driver.sh shot empty     # crop the FlagLabel window to /tmp/flaglabel-shots/empty.png
.claude/skills/run-flaglabel/driver.sh key "?"        # open keyboard-help overlay
.claude/skills/run-flaglabel/driver.sh shot help
.claude/skills/run-flaglabel/driver.sh keycode 53     # Esc — close help
.claude/skills/run-flaglabel/driver.sh stop           # kill tauri CLI, vite, and the flaglabel binary
```

`start` launches `npm run tauri dev` detached, polls `http://localhost:1420` for Vite, polls `pgrep -f target/debug/flaglabel` for the binary, then polls AppleScript `position of window 1` until the window exists. On success it prints `window ready: x,y,w,h` (points).

`shot <name>` always brings FlagLabel to the front and crops to its current bounds — safe to call at any time after `start`. Screenshots land in `$FLAGLABEL_SHOTS` (default `/tmp/flaglabel-shots/`).

`key <text>` and `keycode <n>` proxy directly to `osascript ... keystroke` / `key code`. Useful key codes: `53` Esc, `49` Space, `51` Backspace, `123` ←, `124` →, `125` ↓, `126` ↑.

After driving, **always** run `stop` — otherwise port 1420 stays bound and `start` refuses to relaunch.

## Run (human path)

```bash
npm run tauri dev    # opens a native macOS window; Ctrl-C in the terminal to quit
```

Useless headlessly. Use this when a person is actually clicking, or when you need to see the Cargo compile output stream live for a Rust change.

## Direct invocation (Rust-only changes)

```bash
( cd src-tauri && cargo check )
( cd src-tauri && cargo test )
```

The Rust backend (`src-tauri/src/lib.rs`) only exposes three commands — `write_text_file`, `read_text_file`, `list_images_in_dir` — so most PRs touch the React side under `src/`. For pure-Rust changes you don't need the GUI; `cargo check` is enough.

## Gotchas

- **The file-picker shortcuts can't be driven.** `⌘O` and `⌘⇧O` open the native macOS file dialog, which AppleScript can't reliably fill in without focus stealing and timing-fragile keystroke chains. Restrict scripted flows to keys that don't trigger dialogs (transect 1/2/3, distance ↑/↓, zoom, help). To verify open/save flows, do them by hand once with `npm run tauri dev`.
- **Transect / distance keys only have visible effect after an image is loaded.** A `key "L"` at the empty state succeeds (osascript reports no error) but the UI shows nothing because the transect strip isn't mounted yet. Don't interpret "no visible change" as "keystroke failed" — open an image first.
- **Window bounds are in points, not pixels.** AppleScript `position`/`size` returns points, `screencapture -R` accepts points — they line up automatically. The PNG that comes out is 2× on Retina (1280×800 window → 2560×1600 PNG).
- **`stop` is aggressive on purpose.** It `pkill`s `target/debug/flaglabel`, `@tauri-apps/cli`, and `node.*vite`, then `kill -9`s anything still on port 1420. If you have unrelated Vite dev servers running on this machine, run them on a different port or don't run `stop`.
- **First `start` after a clean clone takes minutes.** Cargo compiles 400+ crates on the first run. Subsequent `start`s reuse `target/debug/` and are ~5s.
- **Tauri webview ≠ Chrome.** Do not try to attach `chromium-cli`, `playwright`, or a DevTools Protocol client — there's no `--remote-debugging-port` flag for the WebKit webview Tauri uses on macOS. The driver replaces that capability with `osascript`.
- **Updater endpoint is real.** `tauri.conf.json` points the updater at `https://github.com/toqitahamid/FlagLabel/releases/latest/download/latest.json`. The app will hit GitHub on launch; that's fine for dev, just don't be surprised by the network call in a packet capture.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `osascript: ... is not allowed to send keystrokes` | Grant Accessibility to the parent terminal/IDE in System Settings. |
| Screenshot PNG is blank or shows the desktop wallpaper instead of the app | Grant Screen Recording permission to the parent terminal/IDE. macOS does not error — it just blanks the foreign-window pixels. |
| `start` prints `port 1420 already in use` | A previous Tauri/Vite is still around. Run `./driver.sh stop` and retry. |
| `bounds` returns `missing value` | The flaglabel process isn't running yet, or its window hasn't been created. Wait a few seconds; if it persists, `tail $FLAGLABEL_LOG` (default `/tmp/flaglabel-tauri-dev.log`) for a Rust panic. |
| `start` exits with `window did not appear within 30s` | Look at `/tmp/flaglabel-tauri-dev.log`. Common cause on first run: cargo is still compiling — bump the inner timeout in `driver.sh` or just `start` again after the compile finishes. |
| `cargo check` complains about missing `tauri-build` / `tauri` features on a clean machine | Run it once from inside `src-tauri/` (the driver already does this). The frontend `dist/` must exist before a full `cargo build`, but `cargo check` doesn't need it. |
