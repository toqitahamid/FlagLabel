import { describe, it, expect } from "vitest";
import { hitTest } from "./hit-test";
import type { Annotation } from "./model";

const wg = (u: number, v: number): Annotation => ({
  kind: "wire_ground",
  u,
  v,
  transect: "L",
  distance: 1,
});

const vspan = (
  u1: number,
  v1: number,
  u2: number,
  v2: number
): Annotation => ({
  kind: "vertical_span",
  u1,
  v1,
  u2,
  v2,
  transect: "C",
  distance: 1,
});

describe("hitTest — strict active-mode priority", () => {
  it("selects only annotations matching the active type (wire_ground)", () => {
    const anns: Annotation[] = [wg(100, 100), vspan(200, 200, 200, 260)];
    expect(hitTest(anns, { u: 100, v: 101 }, "wire_ground", 12)).toBe(0);
    // A click near the span is ignored in wire_ground mode.
    expect(hitTest(anns, { u: 200, v: 201 }, "wire_ground", 12)).toBeNull();
  });

  it("selects only spans in vertical_span mode and ignores wire-ground points", () => {
    const anns: Annotation[] = [wg(100, 100), vspan(200, 200, 200, 260)];
    // near the span's lower endpoint
    expect(hitTest(anns, { u: 200, v: 259 }, "vertical_span", 12)).toBe(1);
    // near the wire-ground point, but in span mode → no hit
    expect(hitTest(anns, { u: 100, v: 101 }, "vertical_span", 12)).toBeNull();
  });

  it("clicking near EITHER span endpoint selects the whole span (returns its index)", () => {
    const anns: Annotation[] = [vspan(50, 50, 50, 300)];
    expect(hitTest(anns, { u: 51, v: 49 }, "vertical_span", 12)).toBe(0); // upper
    expect(hitTest(anns, { u: 49, v: 301 }, "vertical_span", 12)).toBe(0); // lower
    // far from both endpoints (mid-span) → no hit (endpoint-based, not segment)
    expect(hitTest(anns, { u: 50, v: 175 }, "vertical_span", 12)).toBeNull();
  });

  it("falls through (null) when the only nearby annotation is the other type", () => {
    // A wire-ground point coincident with the click; active type is span.
    const anns: Annotation[] = [wg(120, 120)];
    expect(hitTest(anns, { u: 120, v: 120 }, "vertical_span", 12)).toBeNull();
  });

  it("returns null when nothing is within radius", () => {
    const anns: Annotation[] = [wg(0, 0)];
    expect(hitTest(anns, { u: 500, v: 500 }, "wire_ground", 12)).toBeNull();
  });
});

describe("hitTest — tie-breaking (nearest then most-recent)", () => {
  it("breaks an exact distance tie toward the most-recent (higher index)", () => {
    const anns: Annotation[] = [wg(100, 100), wg(100, 100)];
    expect(hitTest(anns, { u: 100, v: 100 }, "wire_ground", 12)).toBe(1);
  });

  it("prefers the strictly nearer annotation over a more-recent farther one", () => {
    const anns: Annotation[] = [wg(100, 100), wg(105, 100)];
    // click is closer to index 0
    expect(hitTest(anns, { u: 100, v: 100 }, "wire_ground", 12)).toBe(0);
  });

  it("tie-break ignores intervening other-type annotations", () => {
    const anns: Annotation[] = [wg(100, 100), vspan(100, 100, 100, 100), wg(100, 100)];
    // both wire-ground points coincide; most-recent (index 2) wins
    expect(hitTest(anns, { u: 100, v: 100 }, "wire_ground", 12)).toBe(2);
  });
});

const box = (
  u1: number,
  v1: number,
  u2: number,
  v2: number
): Annotation => ({
  kind: "flag_box",
  u1,
  v1,
  u2,
  v2,
  transect: "L",
  distance: 1,
});

describe("hitTest — flag_box", () => {
  it("selects a box from any of its FOUR corners, including the two implied ones", () => {
    const anns: Annotation[] = [box(100, 100, 300, 260)];
    // the two stored corners: top-left and bottom-right
    expect(hitTest(anns, { u: 101, v: 101 }, "flag_box", 12)).toBe(0);
    expect(hitTest(anns, { u: 299, v: 259 }, "flag_box", 12)).toBe(0);
    // the two implied corners: top-right and bottom-left
    expect(hitTest(anns, { u: 299, v: 101 }, "flag_box", 12)).toBe(0);
    expect(hitTest(anns, { u: 101, v: 259 }, "flag_box", 12)).toBe(0);
  });

  it("does not select from the middle of an edge or the box interior", () => {
    const anns: Annotation[] = [box(100, 100, 300, 260)];
    // mid top edge, far from every corner
    expect(hitTest(anns, { u: 200, v: 100 }, "flag_box", 12)).toBeNull();
    // dead center
    expect(hitTest(anns, { u: 200, v: 180 }, "flag_box", 12)).toBeNull();
  });

  it("respects the radius (a click just outside it misses)", () => {
    const anns: Annotation[] = [box(100, 100, 300, 260)];
    expect(hitTest(anns, { u: 100, v: 110 }, "flag_box", 12)).toBe(0);
    expect(hitTest(anns, { u: 100, v: 130 }, "flag_box", 12)).toBeNull();
  });

  it("is active-type scoped: a box is ignored in span mode and vice versa", () => {
    const anns: Annotation[] = [box(100, 100, 300, 260), vspan(100, 100, 100, 260)];
    // In flag_box mode only the box is selectable, even though the vertical span
    // shares its top-left endpoint exactly.
    expect(hitTest(anns, { u: 100, v: 100 }, "flag_box", 12)).toBe(0);
    expect(hitTest(anns, { u: 100, v: 100 }, "vertical_span", 12)).toBe(1);
    // The box's implied top-right corner is not a span endpoint at all.
    expect(hitTest(anns, { u: 300, v: 100 }, "vertical_span", 12)).toBeNull();
  });

  it("picks the nearest box, tie-breaking to the most recently placed", () => {
    const anns: Annotation[] = [box(100, 100, 300, 260), box(100, 100, 300, 260)];
    expect(hitTest(anns, { u: 100, v: 100 }, "flag_box", 12)).toBe(1);
  });
});

describe("hitTest — flag masks", () => {
  const mask = (rings: Array<Array<[number, number]>>): Annotation => ({
    kind: "flag_mask",
    rings,
    score: 0.9,
    transect: "L",
    distance: 1,
  });
  // A small square outline, the shape a real flag mask has at distance.
  const square = mask([
    [
      [100, 100],
      [120, 100],
      [120, 160],
      [100, 160],
    ],
  ]);

  it("hits on a click near any outline vertex", () => {
    const anns: Annotation[] = [square];
    expect(hitTest(anns, { u: 101, v: 101 }, "flag_mask", 12)).toBe(0);
    expect(hitTest(anns, { u: 120, v: 160 }, "flag_mask", 12)).toBe(0);
    expect(hitTest(anns, { u: 118, v: 103 }, "flag_mask", 12)).toBe(0);
  });

  it("misses when the click is outside the radius of every vertex", () => {
    const anns: Annotation[] = [square];
    // Dead centre of the square: no vertex is within 12 px.
    expect(hitTest(anns, { u: 110, v: 130 }, "flag_mask", 12)).toBeNull();
    expect(hitTest(anns, { u: 400, v: 400 }, "flag_mask", 12)).toBeNull();
  });

  it("considers vertices from EVERY ring, not just the first", () => {
    const anns: Annotation[] = [
      mask([
        [[10, 10], [20, 10]],
        [[300, 300], [310, 300]],
      ]),
    ];
    expect(hitTest(anns, { u: 301, v: 301 }, "flag_mask", 12)).toBe(0);
  });

  it("is active-type scoped: a mask is ignored in box mode and vice versa", () => {
    const anns: Annotation[] = [square, box(100, 100, 120, 160)];
    expect(hitTest(anns, { u: 100, v: 100 }, "flag_mask", 12)).toBe(0);
    expect(hitTest(anns, { u: 100, v: 100 }, "flag_box", 12)).toBe(1);
  });

  it("picks the nearest mask, tie-breaking to the most recently placed", () => {
    const anns: Annotation[] = [square, square];
    expect(hitTest(anns, { u: 100, v: 100 }, "flag_mask", 12)).toBe(1);
  });

  it("never bullseyes a vertex-less mask (Infinity, not 0)", () => {
    // Unreachable via parseAnnotationFile or the accept path, but a defensive
    // Infinity here is what stops an empty mask from swallowing every click.
    const anns: Annotation[] = [mask([])];
    expect(hitTest(anns, { u: 0, v: 0 }, "flag_mask", 12)).toBeNull();
  });
});
