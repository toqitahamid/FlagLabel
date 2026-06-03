import { describe, it, expect } from "vitest";
import {
  reduceLock,
  lockStatus,
  LOCK_TTL_MS,
  FREE,
} from "./lock-state";

const T0 = 1_000_000; // arbitrary base timestamp

describe("reduceLock + lockStatus", () => {
  // 1. Fresh state (free) + claim by "alice" → lockStatus for alice is "mine".
  it("claim by alice on free lock → status 'mine' for alice", () => {
    const next = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    expect(lockStatus(next, "alice", T0)).toBe("mine");
  });

  // 2. After alice claims, lockStatus for "bob" is "held-by-other".
  it("after alice claims, status for bob is 'held-by-other'", () => {
    const next = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    expect(lockStatus(next, "bob", T0)).toBe("held-by-other");
  });

  // 3. bob's claim while alice holds a LIVE lock does NOT steal it.
  it("bob cannot steal a live lock held by alice", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const afterBobClaim = reduceLock(aliceLocked, { type: "claim", by: "bob", now: T0 + 1000 });
    expect(afterBobClaim.lockedBy).toBe("alice");
    expect(lockStatus(afterBobClaim, "alice", T0 + 1000)).toBe("mine");
    expect(lockStatus(afterBobClaim, "bob", T0 + 1000)).toBe("held-by-other");
  });

  // 4. heartbeat by alice refreshes lockedAt (status stays "mine" as time advances within TTL).
  it("heartbeat by holder refreshes lockedAt, keeping status 'mine' well into TTL", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    // Near TTL boundary — would expire without heartbeat
    const afterHb = reduceLock(aliceLocked, { type: "heartbeat", by: "alice", now: T0 + LOCK_TTL_MS - 1 });
    expect(afterHb.lockedAt).toBe(T0 + LOCK_TTL_MS - 1);
    // Now check TTL runs from the refreshed lockedAt
    expect(lockStatus(afterHb, "alice", T0 + LOCK_TTL_MS - 1 + 60_000)).toBe("mine");
  });

  // 5. No heartbeat: at now = lockedAt + TTL + 1, status is "expired".
  it("lock is 'expired' one ms past the TTL without a heartbeat", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    expect(lockStatus(aliceLocked, "alice", T0 + LOCK_TTL_MS + 1)).toBe("expired");
    expect(lockStatus(aliceLocked, "bob", T0 + LOCK_TTL_MS + 1)).toBe("expired");
  });

  // 6. At exactly the TTL boundary (now = lockedAt + TTL) → still held, NOT expired.
  it("lock is still held at the exact TTL boundary (strict > check)", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    expect(lockStatus(aliceLocked, "alice", T0 + LOCK_TTL_MS)).toBe("mine");
    expect(lockStatus(aliceLocked, "bob", T0 + LOCK_TTL_MS)).toBe("held-by-other");
  });

  // 7. After expiry, a claim by bob succeeds (expired locks are claimable).
  it("bob can claim an expired lock", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const expiredNow = T0 + LOCK_TTL_MS + 1;
    const afterBobClaim = reduceLock(aliceLocked, { type: "claim", by: "bob", now: expiredNow });
    expect(afterBobClaim.lockedBy).toBe("bob");
    expect(afterBobClaim.lockedAt).toBe(expiredNow);
    expect(lockStatus(afterBobClaim, "bob", expiredNow)).toBe("mine");
    expect(lockStatus(afterBobClaim, "alice", expiredNow)).toBe("held-by-other");
  });

  // 8a. release by alice → "free".
  it("release by holder clears the lock to free", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const released = reduceLock(aliceLocked, { type: "release", by: "alice" });
    expect(lockStatus(released, "alice", T0)).toBe("free");
    expect(lockStatus(released, "bob", T0)).toBe("free");
  });

  // 8b. release by bob (not the holder) → no-op, alice still holds it.
  it("release by non-holder is a no-op", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const afterBobRelease = reduceLock(aliceLocked, { type: "release", by: "bob" });
    expect(afterBobRelease).toEqual(aliceLocked);
    expect(lockStatus(afterBobRelease, "alice", T0)).toBe("mine");
  });

  // 9. remoteUpdate sets state from the wire → "held-by-other" for me (carol).
  it("remoteUpdate overwrites local state from Realtime source of truth", () => {
    // Start free locally; remote says charlie holds it.
    const after = reduceLock(FREE, {
      type: "remoteUpdate",
      lockedBy: "charlie",
      lockedAt: T0,
    });
    expect(after.lockedBy).toBe("charlie");
    expect(after.lockedAt).toBe(T0);
    expect(lockStatus(after, "carol", T0)).toBe("held-by-other");
  });

  it("remoteUpdate to null clears to free", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const cleared = reduceLock(aliceLocked, {
      type: "remoteUpdate",
      lockedBy: null,
      lockedAt: null,
    });
    expect(lockStatus(cleared, "alice", T0)).toBe("free");
  });

  // 10. heartbeat by a non-holder is a no-op.
  it("heartbeat by non-holder is a no-op", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const afterBobHb = reduceLock(aliceLocked, { type: "heartbeat", by: "bob", now: T0 + 5000 });
    expect(afterBobHb).toEqual(aliceLocked);
  });

  it("heartbeat on free state is a no-op", () => {
    const afterHb = reduceLock(FREE, { type: "heartbeat", by: "alice", now: T0 });
    expect(afterHb).toEqual(FREE);
  });

  // Idempotent: alice can re-claim her own live lock (refreshes lockedAt).
  it("holder can re-claim their own live lock, refreshing lockedAt", () => {
    const aliceLocked = reduceLock(FREE, { type: "claim", by: "alice", now: T0 });
    const aliceReclaimed = reduceLock(aliceLocked, { type: "claim", by: "alice", now: T0 + 5000 });
    expect(aliceReclaimed.lockedBy).toBe("alice");
    expect(aliceReclaimed.lockedAt).toBe(T0 + 5000);
    expect(lockStatus(aliceReclaimed, "alice", T0 + 5000)).toBe("mine");
  });
});
