#!/usr/bin/env bash
# FlagLabel driver — launch the Tauri desktop app, send keystrokes,
# and crop screenshots of its window. macOS only (uses osascript +
# screencapture). All paths relative to the repo root.

set -euo pipefail

SHOTS_DIR="${FLAGLABEL_SHOTS:-/tmp/flaglabel-shots}"
DEV_LOG="${FLAGLABEL_LOG:-/tmp/flaglabel-tauri-dev.log}"
PROC_NAME="flaglabel"   # what AppleScript / pgrep see for the running binary

mkdir -p "$SHOTS_DIR"

usage() {
  cat <<EOF
usage: driver.sh <command> [args]

  smoke              npm install + npm run build + cargo check (no GUI)
  start              npm run tauri dev in background, wait for window
  stop               kill tauri CLI, vite, and the flaglabel binary
  key <text>         osascript keystroke (e.g. "?", "L", "1")
  keycode <n>        osascript key code (e.g. 53 = Esc, 123 = left, 124 = right)
  bounds             print window bounds as "x,y,w,h" in points
  shot <name>        focus FlagLabel and save \$SHOTS_DIR/<name>.png cropped to window
EOF
}

bounds() {
  # Returns "x,y,w,h". Requires Accessibility permission for whichever
  # process is running osascript (Terminal / iTerm / Cursor / Claude).
  osascript <<'APPLESCRIPT'
tell application "System Events"
  tell process "flaglabel"
    set p to position of window 1
    set s to size of window 1
    return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)
  end tell
end tell
APPLESCRIPT
}

focus() {
  osascript -e 'tell application "System Events" to set frontmost of process "flaglabel" to true' >/dev/null
  sleep 0.2
}

cmd_smoke() {
  npm install
  npm run build
  ( cd src-tauri && cargo check )
  echo "smoke ok"
}

cmd_start() {
  if lsof -i :1420 -P -n >/dev/null 2>&1; then
    echo "port 1420 already in use — run ./driver.sh stop first" >&2
    exit 1
  fi
  : > "$DEV_LOG"
  nohup npm run tauri dev >>"$DEV_LOG" 2>&1 &
  echo "spawned tauri dev, waiting for vite + binary..."
  # Wait for Vite dev server.
  for _ in $(seq 1 120); do
    curl -fsS http://localhost:1420/ >/dev/null 2>&1 && break
    sleep 1
  done
  # Wait for the flaglabel binary.
  for _ in $(seq 1 120); do
    pgrep -f "target/debug/$PROC_NAME" >/dev/null && break
    sleep 1
  done
  # Wait for the window to actually exist.
  for _ in $(seq 1 30); do
    bounds >/dev/null 2>&1 && { echo "window ready: $(bounds)"; return; }
    sleep 1
  done
  echo "window did not appear within 30s — check $DEV_LOG" >&2
  exit 1
}

cmd_stop() {
  pkill -f "target/debug/$PROC_NAME" 2>/dev/null || true
  pkill -f "@tauri-apps/cli" 2>/dev/null || true
  pkill -f "node.*vite" 2>/dev/null || true
  sleep 1
  if lsof -i :1420 -P -n >/dev/null 2>&1; then
    lsof -ti :1420 | xargs -r kill -9 2>/dev/null || true
  fi
  echo "stopped"
}

cmd_key() {
  focus
  osascript -e "tell application \"System Events\" to keystroke \"$1\""
}

cmd_keycode() {
  focus
  osascript -e "tell application \"System Events\" to key code $1"
}

cmd_shot() {
  local name="${1:-shot}"
  focus
  local b; b=$(bounds)
  IFS=, read -r x y w h <<<"$b"
  screencapture -x -R "${x},${y},${w},${h}" "$SHOTS_DIR/${name}.png"
  echo "$SHOTS_DIR/${name}.png"
}

case "${1:-}" in
  smoke)   shift; cmd_smoke "$@" ;;
  start)   shift; cmd_start "$@" ;;
  stop)    shift; cmd_stop "$@" ;;
  key)     shift; cmd_key "$@" ;;
  keycode) shift; cmd_keycode "$@" ;;
  bounds)  bounds ;;
  shot)    shift; cmd_shot "$@" ;;
  ""|-h|--help) usage ;;
  *) usage; exit 2 ;;
esac
