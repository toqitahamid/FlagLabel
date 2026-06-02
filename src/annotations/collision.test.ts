import { describe, it, expect } from "vitest";
import { findCollision } from "./collision";
import type { Annotation, Transect } from "./model";

const wg = (
  transect: Transect,
  distance: number,
  u = 0,
  v = 0
): Annotation => ({ kind: "wire_ground", u, v, transect, distance });

const vspan = (
  transect: Transect,
  distance: number,
  u1 = 0,
  v1 = 0,
  u2 = 0,
  v2 = 10
): Annotation => ({ kind: "vertical_span", u1, v1, u2, v2, transect, distance });

const hspan = (
  transect: Transect,
  distance: number
): Annotation => ({ kind: "horizontal_span", u1: 0, v1: 0, u2: 10, v2: 0, transect, distance });

const fgspan = (
  transect: Transect,
  distance: number
): Annotation => ({ kind: "flag_to_ground_span", u1: 0, v1: 0, u2: 0, v2: 20, transect, distance });

describe("findCollision — same {transect, distance, kind}", () => {
  it("detects a wire_ground collision regardless of coordinates", () => {
    const anns = [wg("L", 3, 100, 100)];
    // Same transect/distance/kind but a different location → still a collision.
    expect(findCollision(anns, { transect: "L", distance: 3, kind: "wire_ground" })).toBe(0);
  });

  it("detects collisions for each span kind", () => {
    expect(findCollision([vspan("C", 2)], { transect: "C", distance: 2, kind: "vertical_span" })).toBe(0);
    expect(findCollision([hspan("R", 5)], { transect: "R", distance: 5, kind: "horizontal_span" })).toBe(0);
    expect(findCollision([fgspan("L", 7)], { transect: "L", distance: 7, kind: "flag_to_ground_span" })).toBe(0);
  });

  it("returns the index of the FIRST match", () => {
    const anns = [wg("C", 1), wg("L", 4, 10, 10), wg("L", 4, 99, 99)];
    expect(findCollision(anns, { transect: "L", distance: 4, kind: "wire_ground" })).toBe(1);
  });
});

describe("findCollision — no match returns null", () => {
  it("returns null on an empty list", () => {
    expect(findCollision([], { transect: "L", distance: 1, kind: "wire_ground" })).toBeNull();
  });

  it("returns null when transect differs", () => {
    expect(findCollision([wg("L", 3)], { transect: "C", distance: 3, kind: "wire_ground" })).toBeNull();
  });

  it("returns null when distance differs (exact numeric match required)", () => {
    expect(findCollision([wg("L", 3)], { transect: "L", distance: 4, kind: "wire_ground" })).toBeNull();
    // Half-step distances are exact: 3 and 3.5 do not collide.
    expect(findCollision([wg("L", 3)], { transect: "L", distance: 3.5, kind: "wire_ground" })).toBeNull();
    expect(findCollision([wg("L", 3.5)], { transect: "L", distance: 3.5, kind: "wire_ground" })).toBe(0);
  });
});

describe("findCollision — type-scoped (no cross-kind false positives)", () => {
  it("does NOT collide across different kinds at the same {transect, distance}", () => {
    const anns = [wg("L", 3), vspan("L", 3), hspan("L", 3), fgspan("L", 3)];
    // A new wire_ground at L3 collides only with the wire_ground entry (index 0).
    expect(findCollision(anns, { transect: "L", distance: 3, kind: "wire_ground" })).toBe(0);
    expect(findCollision(anns, { transect: "L", distance: 3, kind: "vertical_span" })).toBe(1);
    expect(findCollision(anns, { transect: "L", distance: 3, kind: "horizontal_span" })).toBe(2);
    expect(findCollision(anns, { transect: "L", distance: 3, kind: "flag_to_ground_span" })).toBe(3);
  });

  it("a wire_ground and a vertical_span at the same {transect, distance} legitimately coexist", () => {
    // Only the wire_ground exists; placing a vertical_span there is not a collision.
    expect(findCollision([wg("C", 6)], { transect: "C", distance: 6, kind: "vertical_span" })).toBeNull();
  });
});
