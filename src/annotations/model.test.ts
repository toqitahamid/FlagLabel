import { describe, it, expect } from "vitest";
import {
  countsFromAnnotations,
  countsByTransect,
  canonicalizeSpan,
  canonicalizeBox,
  maskBounds,
  roundRings,
  type Annotation,
  type MaskRing,
} from "./model";
import type { HorizontalSpan, FlagToGroundSpan } from "./model";

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

describe("countsByTransect", () => {
  it("counts every annotation kind by transect (not just wire-ground)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      { kind: "vertical_span", u1: 1, v1: 1, u2: 1, v2: 2, transect: "L", distance: 1 },
      { kind: "horizontal_span", u1: 1, v1: 1, u2: 2, v2: 1, transect: "C", distance: 2 },
      { kind: "flag_to_ground_span", u1: 1, v1: 1, u2: 1, v2: 9, transect: "R", distance: 3 },
    ];
    expect(countsByTransect(anns)).toEqual({ L: 2, C: 1, R: 1 });
  });

  it("returns all-zero counts for an empty list", () => {
    expect(countsByTransect([])).toEqual({ L: 0, C: 0, R: 0 });
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

  it("returns a defined SpanEndpoints for the vertical case (never-guard is compile-time)", () => {
    const r = canonicalizeSpan("vertical", { u: 0, v: 0 }, { u: 1, v: 9 });
    expect(r).toBeDefined();
    expect(r).toEqual({ u1: 0, v1: 0, u2: 1, v2: 9 });
  });
});

describe("canonicalizeSpan (horizontal) — left-first ordering", () => {
  it("stores the smaller-u point as (u1,v1) when p1 is already left", () => {
    const r = canonicalizeSpan("horizontal", { u: 20, v: 50 }, { u: 80, v: 55 });
    expect(r).toEqual({ u1: 20, v1: 50, u2: 80, v2: 55 });
  });

  it("orders left-first regardless of click order (p2 is left)", () => {
    const r = canonicalizeSpan("horizontal", { u: 80, v: 55 }, { u: 20, v: 50 });
    expect(r).toEqual({ u1: 20, v1: 50, u2: 80, v2: 55 });
  });

  it("is deterministic and order-independent for equal u (tie on smaller v)", () => {
    const a = canonicalizeSpan("horizontal", { u: 50, v: 30 }, { u: 50, v: 10 });
    const b = canonicalizeSpan("horizontal", { u: 50, v: 10 }, { u: 50, v: 30 });
    expect(a).toEqual({ u1: 50, v1: 10, u2: 50, v2: 30 });
    expect(a).toEqual(b);
  });

  it("orders by u even for a near-horizontal span (tiny u difference still wins)", () => {
    const r = canonicalizeSpan(
      "horizontal",
      { u: 200.5, v: 100 },
      { u: 200.4, v: 102 }
    );
    // 200.4 < 200.5 → the second point is left
    expect(r).toEqual({ u1: 200.4, v1: 102, u2: 200.5, v2: 100 });
  });

  it("handles fully coincident points without throwing", () => {
    const r = canonicalizeSpan("horizontal", { u: 7, v: 7 }, { u: 7, v: 7 });
    expect(r).toEqual({ u1: 7, v1: 7, u2: 7, v2: 7 });
  });

  it("ignores horizontal spans in countsFromAnnotations (wire-ground only)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      {
        kind: "horizontal_span",
        u1: 10,
        v1: 50,
        u2: 80,
        v2: 55,
        transect: "C",
        distance: 3,
      } satisfies HorizontalSpan,
    ];
    expect(countsFromAnnotations(anns)).toEqual({ L: 1, C: 0, R: 0 });
  });
});

describe("canonicalizeSpan (flag_to_ground) — upper-first ordering (identical rule to vertical)", () => {
  it("stores the smaller-v point as (u1,v1) when p1 is already upper (flag top)", () => {
    const r = canonicalizeSpan("flag_to_ground", { u: 10, v: 20 }, { u: 12, v: 300 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 12, v2: 300 });
  });

  it("orders upper-first regardless of click order (p2 is upper / flag top)", () => {
    const r = canonicalizeSpan("flag_to_ground", { u: 12, v: 300 }, { u: 10, v: 20 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 12, v2: 300 });
  });

  it("is deterministic and order-independent for equal v (tie on smaller u)", () => {
    const a = canonicalizeSpan("flag_to_ground", { u: 50, v: 100 }, { u: 20, v: 100 });
    const b = canonicalizeSpan("flag_to_ground", { u: 20, v: 100 }, { u: 50, v: 100 });
    expect(a).toEqual({ u1: 20, v1: 100, u2: 50, v2: 100 });
    expect(a).toEqual(b);
  });

  it("handles fully coincident points without throwing", () => {
    const r = canonicalizeSpan("flag_to_ground", { u: 7, v: 7 }, { u: 7, v: 7 });
    expect(r).toEqual({ u1: 7, v1: 7, u2: 7, v2: 7 });
  });

  it("ignores flag_to_ground spans in countsFromAnnotations (wire-ground only)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      {
        kind: "flag_to_ground_span",
        u1: 10,
        v1: 20,
        u2: 12,
        v2: 300,
        transect: "C",
        distance: 5,
      } satisfies FlagToGroundSpan,
    ];
    expect(countsFromAnnotations(anns)).toEqual({ L: 1, C: 0, R: 0 });
  });
});

describe("canonicalizeBox", () => {
  it("stores top-left as (u1,v1) and bottom-right as (u2,v2) when already ordered", () => {
    const r = canonicalizeBox({ u: 10, v: 20 }, { u: 90, v: 140 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 90, v2: 140 });
  });

  it("is identical for all four drag directions across the same two corners", () => {
    const tl = { u: 10, v: 20 };
    const br = { u: 90, v: 140 };
    const tr = { u: 90, v: 20 };
    const bl = { u: 10, v: 140 };
    const expected = { u1: 10, v1: 20, u2: 90, v2: 140 };
    // top-left → bottom-right, and the reverse
    expect(canonicalizeBox(tl, br)).toEqual(expected);
    expect(canonicalizeBox(br, tl)).toEqual(expected);
    // top-right → bottom-left, and the reverse (mixes u from one, v from the other)
    expect(canonicalizeBox(tr, bl)).toEqual(expected);
    expect(canonicalizeBox(bl, tr)).toEqual(expected);
  });

  it("mixes coordinates across both clicks (not a mere point reorder)", () => {
    // Neither output corner equals either input point.
    const r = canonicalizeBox({ u: 90, v: 20 }, { u: 10, v: 140 });
    expect(r).toEqual({ u1: 10, v1: 20, u2: 90, v2: 140 });
  });

  it("handles a zero-area box (coincident corners) without throwing", () => {
    expect(canonicalizeBox({ u: 7, v: 7 }, { u: 7, v: 7 })).toEqual({
      u1: 7,
      v1: 7,
      u2: 7,
      v2: 7,
    });
  });

  it("handles a degenerate box collapsed on one axis", () => {
    expect(canonicalizeBox({ u: 50, v: 90 }, { u: 50, v: 10 })).toEqual({
      u1: 50,
      v1: 10,
      u2: 50,
      v2: 90,
    });
  });

  it("preserves sub-pixel precision", () => {
    expect(canonicalizeBox({ u: 200.75, v: 100.25 }, { u: 200.5, v: 100.5 })).toEqual({
      u1: 200.5,
      v1: 100.25,
      u2: 200.75,
      v2: 100.5,
    });
  });
});

describe("counts with flag boxes", () => {
  it("countsByTransect includes boxes (a box-only image is not unlabeled)", () => {
    const anns: Annotation[] = [
      { kind: "flag_box", u1: 10, v1: 10, u2: 40, v2: 60, transect: "L", distance: 1 },
      { kind: "flag_box", u1: 80, v1: 10, u2: 110, v2: 60, transect: "R", distance: 2 },
    ];
    expect(countsByTransect(anns)).toEqual({ L: 1, C: 0, R: 1 });
  });

  it("countsFromAnnotations ignores boxes (wire-ground only)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      { kind: "flag_box", u1: 10, v1: 10, u2: 40, v2: 60, transect: "C", distance: 1 },
    ];
    expect(countsFromAnnotations(anns)).toEqual({ L: 1, C: 0, R: 0 });
  });
});

describe("roundRings", () => {
  it("rounds every vertex to one decimal", () => {
    const rings: MaskRing[] = [
      [
        [10.04, 20.06],
        [30.449, 40.55],
      ],
    ];
    expect(roundRings(rings)).toEqual([
      [
        [10, 20.1],
        [30.4, 40.6],
      ],
    ]);
  });

  it("rounds every ring, not just the first", () => {
    const rings: MaskRing[] = [[[1.11, 2.22]], [[3.33, 4.44]]];
    expect(roundRings(rings)).toEqual([[[1.1, 2.2]], [[3.3, 4.4]]]);
  });

  it("leaves already-rounded coordinates unchanged (idempotent)", () => {
    const rings: MaskRing[] = [
      [
        [10.5, 20.1],
        [30, 40.9],
      ],
    ];
    expect(roundRings(roundRings(rings))).toEqual(rings);
  });

  it("does not mutate the input", () => {
    const rings: MaskRing[] = [[[1.234, 5.678]]];
    roundRings(rings);
    expect(rings).toEqual([[[1.234, 5.678]]]);
  });

  it("survives an empty ring list", () => {
    expect(roundRings([])).toEqual([]);
  });
});

describe("maskBounds", () => {
  it("returns the AABB across ALL rings, in {u1,v1,u2,v2} corner order", () => {
    const rings: MaskRing[] = [
      [
        [10, 50],
        [20, 60],
      ],
      [
        [5, 80],
        [40, 12],
      ],
    ];
    expect(maskBounds(rings)).toEqual({ u1: 5, v1: 12, u2: 40, v2: 80 });
  });

  it("handles a single-vertex ring (degenerate but valid) as a zero-area box", () => {
    expect(maskBounds([[[7, 9]]])).toEqual({ u1: 7, v1: 9, u2: 7, v2: 9 });
  });

  it("returns null when there are no vertices to bound", () => {
    expect(maskBounds([])).toBeNull();
    expect(maskBounds([[]])).toBeNull();
  });
});

describe("counts with flag masks", () => {
  it("countsByTransect includes masks (a mask-only image is not unlabeled)", () => {
    const anns: Annotation[] = [
      { kind: "flag_mask", rings: [[[1, 1], [2, 2]]], score: 0.9, transect: "L", distance: 1 },
      { kind: "flag_mask", rings: [[[3, 3], [4, 4]]], score: 0.8, transect: "C", distance: 2 },
    ];
    expect(countsByTransect(anns)).toEqual({ L: 1, C: 1, R: 0 });
  });

  it("countsFromAnnotations ignores masks (wire-ground only)", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 1, v: 1, transect: "R", distance: 1 },
      { kind: "flag_mask", rings: [[[1, 1], [2, 2]]], score: 0.9, transect: "R", distance: 1 },
    ];
    expect(countsFromAnnotations(anns)).toEqual({ L: 0, C: 0, R: 1 });
  });
});
