import { describe, it, expect } from "vitest";
import { countsFromAnnotations, type Annotation } from "./model";

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
});
