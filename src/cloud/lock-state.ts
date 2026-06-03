// Pure soft-edit-lock state machine.
// Time is always injected as `now: number` (ms) — never reads the real clock.
// Admin force-unlock maps onto a `release` event or a `remoteUpdate` to
// { lockedBy: null, lockedAt: null } at the call site; no special event needed.

export const LOCK_TTL_MS = 120_000; // 2 minutes

export type LockState = {
  lockedBy: string | null;
  lockedAt: number | null;
};

export type LockEvent =
  | { type: "claim"; by: string; now: number }
  | { type: "heartbeat"; by: string; now: number }
  | { type: "release"; by: string }
  | { type: "remoteUpdate"; lockedBy: string | null; lockedAt: number | null };

export type LockStatus = "free" | "mine" | "held-by-other" | "expired";

export const FREE: LockState = { lockedBy: null, lockedAt: null };

// Pure reducer.
export function reduceLock(state: LockState, event: LockEvent): LockState {
  switch (event.type) {
    case "claim": {
      // Only claim if free/expired, or already held by the same labeler.
      const alreadyHeld =
        state.lockedBy !== null &&
        state.lockedBy !== event.by &&
        state.lockedAt !== null &&
        event.now - state.lockedAt <= LOCK_TTL_MS;
      if (alreadyHeld) return state;
      return { lockedBy: event.by, lockedAt: event.now };
    }
    case "heartbeat": {
      if (state.lockedBy !== event.by) return state;
      return { lockedBy: event.by, lockedAt: event.now };
    }
    case "release": {
      if (state.lockedBy !== event.by) return state;
      return FREE;
    }
    case "remoteUpdate": {
      return { lockedBy: event.lockedBy, lockedAt: event.lockedAt };
    }
  }
}

// Status selector — applies TTL.
export function lockStatus(
  state: LockState,
  me: string,
  now: number
): LockStatus {
  if (state.lockedBy === null) return "free";
  if (state.lockedAt !== null && now - state.lockedAt > LOCK_TTL_MS)
    return "expired";
  if (state.lockedBy === me) return "mine";
  return "held-by-other";
}
