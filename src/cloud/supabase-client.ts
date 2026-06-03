import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy Supabase client singleton for the WEB build.
//
// CRITICAL: construction (and the throw-if-misconfigured check) happens on FIRST
// CALL, never at module import. App.tsx imports the cloud backend to do platform
// selection, so this module's import graph runs in the desktop build too — where
// the VITE_SUPABASE_* env vars are absent. A top-level `createClient` / throw
// would crash the desktop app at startup. Deferring to `getSupabaseClient()`
// means desktop (which never reaches the web auth gate or SupabaseStorageBackend)
// never constructs the client and never throws.
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured: set VITE_SUPABASE_URL and " +
        "VITE_SUPABASE_ANON_KEY (copy .env.example to .env.local). These are " +
        "required for the web build only.",
    );
  }

  // The modern publishable key (`sb_publishable_...`) is passed exactly where the
  // legacy anon JWT used to go. supabase-js persists the session in localStorage
  // and auto-refreshes by default, so sessions survive a page reload.
  client = createClient(url, anonKey);
  return client;
}
