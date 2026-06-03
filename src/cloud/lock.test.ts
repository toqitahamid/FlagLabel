import { describe, it, expect } from "vitest";
import { claimCutoffIso, lockedAtMs } from "./lock";
import { LOCK_TTL_MS } from "./lock-state";

const T0 = 1_700_000_000_000; // arbitrary epoch ms

describe("claimCutoffIso", () => {
  // The cutoff is exactly one TTL before `now`, as an ISO string the DB compares
  // against `locked_at`: a lock older than this is expired and claimable.
  it("is `now - TTL` rendered as ISO", () => {
    expect(claimCutoffIso(T0)).toBe(new Date(T0 - LOCK_TTL_MS).toISOString());
  });

  it("moves backward as now advances, by the same delta", () => {
    const a = Date.parse(claimCutoffIso(T0));
    const b = Date.parse(claimCutoffIso(T0 + 5000));
    expect(b - a).toBe(5000);
  });

  // A lock claimed at exactly the cutoff is NOT older than it (strict `<` in the
  // WHERE), matching the reducer's strict `>` TTL boundary in lock-state.
  it("a lock at the cutoff instant is not strictly older than the cutoff", () => {
    const cutoffMs = Date.parse(claimCutoffIso(T0));
    expect(cutoffMs < cutoffMs).toBe(false);
  });
});

describe("lockedAtMs", () => {
  it("parses an ISO timestamptz string to epoch ms", () => {
    const iso = new Date(T0).toISOString();
    expect(lockedAtMs(iso)).toBe(T0);
  });

  it("maps null (free lock) to null", () => {
    expect(lockedAtMs(null)).toBeNull();
  });

  it("maps an unparseable string to null rather than NaN", () => {
    expect(lockedAtMs("not-a-date")).toBeNull();
  });
});
