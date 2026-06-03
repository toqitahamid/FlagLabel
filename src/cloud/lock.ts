// Supabase transport for the soft per-image edit lock (web build only).
//
// All decision logic lives in the pure reducer `lock-state.ts`; this module is
// the thin IO shell that drives it: a conditional atomic claim, heartbeat,
// release, an admin force-unlock, and a Realtime subscription that streams the
// row's lock columns back as `remoteUpdate` events. None of this is ever reached
// on desktop — the hook (`useImageLock`) early-returns under `isTauri()`, so the
// Supabase client is never constructed in the desktop build (see supabase-client.ts).
//
// Lock columns live ON the existing `annotations` row (one per image), so we key
// every UPDATE on (site, image_name) — the same identity the storage backend
// uses for `data` writes (supabase-backend.ts). RLS allows UPDATE for any
// authenticated user, so any labeler can claim/heartbeat/release and an admin
// force-unlock is just an unconditional UPDATE.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase-client";
import { LOCK_TTL_MS } from "./lock-state";

// The TTL cutoff for a conditional claim, as an ISO timestamp the DB can compare
// against `locked_at`. A lock whose `locked_at` is older than this is expired and
// therefore claimable. Pure (time injected) so it is unit-testable in isolation.
export function claimCutoffIso(now: number): string {
  return new Date(now - LOCK_TTL_MS).toISOString();
}

// What the wire carries for a row's lock columns. `locked_at` is a Postgres
// `timestamptz` and arrives as an ISO string (or null when free).
export type LockRow = {
  locked_by: string | null;
  locked_at: string | null;
};

// Normalize a wire `locked_at` (ISO string | null) to epoch ms | null for the
// pure reducer, which only ever works in numbers.
export function lockedAtMs(lockedAt: string | null): number | null {
  if (lockedAt === null) return null;
  const ms = Date.parse(lockedAt);
  return Number.isNaN(ms) ? null : ms;
}

// Atomically attempt to claim the lock. The WHERE clause only matches when the
// lock is free, already mine, or expired (heartbeat older than the TTL cutoff),
// so two simultaneous claimers cannot both win — the DB is the arbiter. Returns
// the resulting row when WE got it (>=1 row), or null when someone else holds a
// live lock (0 rows). On a 0-row result the caller reads the current holder.
export async function claimLock(
  site: string,
  imageName: string,
  me: string,
  now: number,
): Promise<LockRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("annotations")
    .update({ locked_by: me, locked_at: new Date(now).toISOString() })
    .eq("site", site)
    .eq("image_name", imageName)
    .or(`locked_by.is.null,locked_by.eq.${me},locked_at.lt.${claimCutoffIso(now)}`)
    .select("locked_by, locked_at");
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0] as LockRow;
}

// Read the current lock columns for a row (used after a failed claim to learn
// who holds it, and to seed the badge).
export async function readLock(
  site: string,
  imageName: string,
): Promise<LockRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("annotations")
    .select("locked_by, locked_at")
    .eq("site", site)
    .eq("image_name", imageName)
    .maybeSingle<LockRow>();
  if (error) throw error;
  return data ?? { locked_by: null, locked_at: null };
}

// Refresh `locked_at` while we hold the lock. Conditioned on `locked_by=me` so a
// stale heartbeat (someone else stole an expired lock in between) is a no-op.
export async function heartbeatLock(
  site: string,
  imageName: string,
  me: string,
  now: number,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("annotations")
    .update({ locked_at: new Date(now).toISOString() })
    .eq("site", site)
    .eq("image_name", imageName)
    .eq("locked_by", me);
  if (error) throw error;
}

// Release our own lock. Conditioned on `locked_by=me`, so it is safe to fire
// unconditionally on image-switch/unmount even when we never held it (0 rows).
export async function releaseLock(
  site: string,
  imageName: string,
  me: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("annotations")
    .update({ locked_by: null, locked_at: null })
    .eq("site", site)
    .eq("image_name", imageName)
    .eq("locked_by", me);
  if (error) throw error;
}

// Admin force-unlock: clear the lock unconditionally regardless of holder.
export async function forceUnlockLock(
  site: string,
  imageName: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("annotations")
    .update({ locked_by: null, locked_at: null })
    .eq("site", site)
    .eq("image_name", imageName);
  if (error) throw error;
}

// Subscribe to UPDATEs on this image's row, streaming the new lock columns to
// `onChange`. postgres_changes allows a single filter expression, so we filter on
// `storage_path` (unique per row, equal to the image id on web). Returns the
// channel so the caller can remove it on image switch / unmount.
export function subscribeLock(
  storagePath: string,
  onChange: (row: LockRow) => void,
): RealtimeChannel {
  const supabase = getSupabaseClient();
  const channel = supabase
    .channel(`lock:${storagePath}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "annotations",
        filter: `storage_path=eq.${storagePath}`,
      },
      (payload) => {
        const row = payload.new as Partial<LockRow>;
        onChange({
          locked_by: row.locked_by ?? null,
          locked_at: row.locked_at ?? null,
        });
      },
    )
    .subscribe();
  return channel;
}
