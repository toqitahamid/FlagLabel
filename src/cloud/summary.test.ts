import { describe, it, expect } from "vitest";
import { deriveSummary } from "./summary";
import { buildAnnotationFile, type FileMeta } from "../annotations/schema";
import type { Annotation } from "../annotations/model";

const META: FileMeta = {
  site: "siteA",
  image: "IMG_0001.jpg",
  image_w: 4000,
  image_h: 3000,
};

describe("deriveSummary", () => {
  it("null file → count 0, status empty, labeler passed through", () => {
    const result = deriveSummary(null, "alice");
    expect(result).toEqual({ labeler: "alice", status: "empty", annotation_count: 0 });
  });

  it("file with one wire_ground_point → count 1, status annotated", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 3 },
    ];
    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    const result = deriveSummary(file, "bob");
    expect(result).toEqual({ labeler: "bob", status: "annotated", annotation_count: 1 });
  });

  it("file with all four arrays empty (cleared image) → count 0, status empty", () => {
    const file = buildAnnotationFile(META, [], "0.2.0", "2026-06-02T00:00:00.000Z");
    const result = deriveSummary(file, "dave");
    expect(result).toEqual({ labeler: "dave", status: "empty", annotation_count: 0 });
  });

  it("file with mix across all four annotation types → count = total of all", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 10, v: 20, transect: "L", distance: 1 },
      { kind: "wire_ground", u: 30, v: 40, transect: "C", distance: 2 },
      { kind: "vertical_span", u1: 100, v1: 50, u2: 105, v2: 300, transect: "R", distance: 3 },
      { kind: "horizontal_span", u1: 50, v1: 100, u2: 400, v2: 105, transect: "L", distance: 4 },
      { kind: "flag_to_ground_span", u1: 200, v1: 80, u2: 210, v2: 600, transect: "C", distance: 5 },
    ];
    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    const result = deriveSummary(file, "carol");
    expect(result).toEqual({ labeler: "carol", status: "annotated", annotation_count: 5 });
  });

  it("labeler string is recorded verbatim including empty string", () => {
    const result = deriveSummary(null, "");
    expect(result.labeler).toBe("");
  });
});
