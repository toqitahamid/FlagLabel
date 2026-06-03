// Runtime environment detection: are we inside the Tauri (desktop) shell, or a
// plain browser (the web build)? This single predicate gates every Tauri-only
// API in App.tsx and selects the storage backend + whether the auth gate runs.
//
// Tauri v2 injects `__TAURI_INTERNALS__` onto `window` before any app code runs.
// `@tauri-apps/api/core` re-exports an `isTauri()` that checks exactly this; we
// inline the check so this module has zero Tauri import side effects in the web
// bundle and stays trivially callable from tests.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// The web build is just "not desktop". Kept as a named helper so call sites read
// intentionally (`isWeb()` for the auth gate / cloud backend) instead of `!isTauri()`.
export function isWeb(): boolean {
  return !isTauri();
}
