import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "./platform";
import { getSupabaseClient } from "./supabase-client";
import {
  reduceLock,
  lockStatus,
  FREE,
  type LockState,
  type LockStatus,
} from "./lock-state";
import {
  claimLock,
  readLock,
  heartbeatLock,
  releaseLock,
  forceUnlockLock,
  subscribeLock,
  lockedAtMs,
  type LockRow,
} from "./lock";

// How often the holder refreshes `locked_at` (well under the 2-min TTL).
const HEARTBEAT_MS = 25_000;
// How often we re-evaluate `lockStatus` against the wall clock so an abandoned
// lock visibly expires → becomes claimable. `lockStatus` is time-dependent but a
// clock doesn't trigger React, so we tick `now` into state.
const TICK_MS = 20_000;

export type ImageLock = {
  status: LockStatus;
  // The email of whoever holds the lock when status is 'held-by-other'.
  heldBy: string | null;
  // Editing is permitted unless someone else holds a live lock. ALWAYS true on
  // desktop (no locks) — `isTauri()` short-circuits.
  canEdit: boolean;
  // Admin-only: clear the lock regardless of holder.
  forceUnlock: () => void;
};

// Soft per-image edit lock for the WEB build, keyed on the active image's
// (site, image_name) row. Drives the pure `lock-state` reducer from Supabase +
// Realtime. On desktop this is an inert pass-through: every Supabase-touching
// effect early-returns under `isTauri()`, the client is never constructed, and
// `canEdit` is constant true — so desktop behavior is provably unchanged.
//
// `enabled` lets the caller hold off until the per-image annotations are loaded
// (it passes the active image's storage path as `imageId`, plus site/name for
// the row keys). When `imageId` is null (no image) the hook is dormant.
export function useImageLock(args: {
  imageId: string | null;
  site: string | null;
  imageName: string | null;
}): ImageLock {
  const { imageId, site, imageName } = args;

  const [state, setState] = useState<LockState>(FREE);
  const [now, setNow] = useState<number>(() => Date.now());
  const [me, setMe] = useState<string | null>(null);

  // Latest values for the heartbeat/release callbacks without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const meRef = useRef(me);
  meRef.current = me;

  // Resolve the signed-in user's email once (web only).
  useEffect(() => {
    if (isTauri()) return;
    let cancelled = false;
    getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setMe(data.user?.email ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Reset local lock state whenever the active image changes, so a stale holder
  // from the previous image never leaks into the new one before the first read.
  useEffect(() => {
    if (isTauri()) return;
    setState(FREE);
  }, [imageId]);

  // Subscribe to this row's lock-column UPDATEs and feed them to the reducer.
  useEffect(() => {
    if (isTauri()) return;
    if (!imageId) return;
    const channel = subscribeLock(imageId, (row: LockRow) => {
      setState((prev) =>
        reduceLock(prev, {
          type: "remoteUpdate",
          lockedBy: row.locked_by,
          lockedAt: lockedAtMs(row.locked_at),
        }),
      );
    });
    return () => {
      getSupabaseClient().removeChannel(channel);
    };
  }, [imageId]);

  // Self-stabilizing claim: whenever the lock is free or expired (NOT mine and
  // NOT held-by-other), attempt the conditional atomic claim. This covers both
  // claim-on-open (initial FREE → fires once) and the expiry path (an abandoned
  // lock TTLs out → exactly one viewer's UPDATE wins, the rest get 0 rows and
  // stay read-only). The DB is the arbiter, so two viewers can never both claim.
  useEffect(() => {
    if (isTauri()) return;
    if (!imageId || !site || !imageName || !me) return;
    const status = lockStatus(state, me, now);
    if (status === "mine" || status === "held-by-other") return;
    let cancelled = false;
    (async () => {
      try {
        const claimNow = Date.now();
        const got = await claimLock(site, imageName, me, claimNow);
        if (cancelled) return;
        if (got) {
          setState((prev) =>
            reduceLock(prev, { type: "claim", by: me, now: claimNow }),
          );
        } else {
          // Someone else won — read the live holder so the badge is accurate.
          const row = await readLock(site, imageName);
          if (cancelled) return;
          setState((prev) =>
            reduceLock(prev, {
              type: "remoteUpdate",
              lockedBy: row.locked_by,
              lockedAt: lockedAtMs(row.locked_at),
            }),
          );
        }
      } catch (e) {
        console.error("Lock claim failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `now` is in the deps so an expiry tick re-triggers the claim attempt.
  }, [imageId, site, imageName, me, state, now]);

  // Heartbeat while we hold the lock: refresh `locked_at` so it never TTLs out
  // under us, and advance local `lockedAt` via the reducer's heartbeat event.
  useEffect(() => {
    if (isTauri()) return;
    if (!imageId || !site || !imageName || !me) return;
    const id = setInterval(() => {
      const status = lockStatus(stateRef.current, me, Date.now());
      if (status !== "mine") return;
      const hbNow = Date.now();
      heartbeatLock(site, imageName, me, hbNow).catch((e) =>
        console.error("Lock heartbeat failed", e),
      );
      setState((prev) => reduceLock(prev, { type: "heartbeat", by: me, now: hbNow }));
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [imageId, site, imageName, me]);

  // Periodic tick so a held-by-other lock that goes stale re-evaluates to
  // 'expired' (→ claimable) without a Realtime event.
  useEffect(() => {
    if (isTauri()) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Release our lock when the active image changes or on unmount. Conditioned
  // server-side on `locked_by=me`, so firing it when we never held it is a
  // harmless 0-row UPDATE. Best-effort; the TTL is the backstop for crash /
  // tab-close / sign-out tear-down (no `beforeunload` gymnastics — by design).
  useEffect(() => {
    if (isTauri()) return;
    if (!imageId || !site || !imageName) return;
    return () => {
      const meNow = meRef.current;
      if (!meNow) return;
      releaseLock(site, imageName, meNow).catch(() => {});
    };
  }, [imageId, site, imageName]);

  const forceUnlock = useCallback(() => {
    if (isTauri() || !site || !imageName) return;
    forceUnlockLock(site, imageName)
      .then(() => {
        // Optimistically reflect the clear; Realtime will confirm.
        setState(FREE);
      })
      .catch((e) => console.error("Force-unlock failed", e));
  }, [site, imageName]);

  // Desktop: constant, lock-free result (no Supabase ever touched).
  if (isTauri()) {
    return { status: "free", heldBy: null, canEdit: true, forceUnlock };
  }

  const status = me ? lockStatus(state, me, now) : "free";
  const heldBy = status === "held-by-other" ? state.lockedBy : null;
  const canEdit = status !== "held-by-other";
  return { status, heldBy, canEdit, forceUnlock };
}
