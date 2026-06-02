import { describe, it, expect } from "vitest";
import { countsFromAnnotations, canonicalizeSpan, type Annotation } from "./model";

describe("countsFromAnnotations", () => {
  it("tallies wire-ground annotations per transect", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      { kind: "wire_ground", u: 2, v: 2, transect: "L", distance: 2 },
      { kind: "wire_ground", u: 3, v: 3, transect: "C", distance: 1 },
      { kind: "wire_ground", u: 4, v: 4, transect: "R", distance: 5 },
    ];

    expect(countsFromAnnotations(anns)).toEqual({ L: 2, C: 1, R: 1 });
  });

  it("returns all-zero counts for an empty list", () => {
    expect(countsFromAnnotations([])).toEqual({ L: 0, C: 0, R: 0 });
  });

  it("ignores non-wire-ground annotations (vertical spans)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      {
        kind: "vertical_span",
        u1: 5,
        v1: 5,
        u2: 5,
        v2: 50,
        transect: "C",
        distance: 1,
      },
    ];
    expect(countsFromAnnotations(anns)).toEqual({ L: 1, C: 0, R: 0 });
  });
});

describe("canonicalizeSpan (vertical)", () => {
  it("stores the smaller-v point as (u1,v1) when p1 is already upper", () => {
    const r = canonicalizeSpan("vertical", { u: 10, v: 20 }, { u: 11, v: 80 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 11, v2: 80 });
  });

  it("orders upper-first regardless of click order (p2 is upper)", () => {
    const r = canonicalizeSpan("vertical", { u: 11, v: 80 }, { u: 10, v: 20 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 11, v2: 80 });
  });

  it("is deterministic and order-independent for equal v (tie on smaller u)", () => {
    const a = canonicalizeSpan("vertical", { u: 30, v: 50 }, { u: 10, v: 50 });
    const b = canonicalizeSpan("vertical", { u: 10, v: 50 }, { u: 30, v: 50 });
    expect(a).toEqual({ u1: 10, v1: 50, u2: 30, v2: 50 });
    expect(a).toEqual(b);
  });

  it("orders by v even for a near-tilted span (tiny v difference still wins)", () => {
    const r = canonicalizeSpan(
      "vertical",
      { u: 100, v: 200.5 },
      { u: 102, v: 200.4 }
    );
    // 200.4 < 200.5 → the second point is upper
    expect(r).toEqual({ u1: 102, v1: 200.4, u2: 100, v2: 200.5 });
  });

  it("handles fully coincident points without throwing", () => {
    const r = canonicalizeSpan("vertical", { u: 7, v: 7 }, { u: 7, v: 7 });
    expect(r).toEqual({ u1: 7, v1: 7, u2: 7, v2: 7 });
  });
});
