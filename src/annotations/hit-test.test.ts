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
