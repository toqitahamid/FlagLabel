import { describe, it, expect } from "vitest";
import {
  buildAnnotationFile,
  parseAnnotationFile,
  REFERENCE_DIMENSIONS_CM,
  type FileMeta,
} from "./schema";
import type { Annotation } from "./model";

const META: FileMeta = {
  site: "siteA",
  image: "IMG_0001.jpg",
  image_w: 4000,
  image_h: 3000,
};

describe("buildAnnotationFile", () => {
  it("emits schema_version 2, wire_ground_points, reference dimensions, and no click_type", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 3 },
    ];

    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");

    expect(file.schema_version).toBe(2);
    expect(file.wire_ground_points).toEqual([
      { u: 100, v: 200, transect: "L", distance: 3 },
    ]);
    expect(file.reference_dimensions_cm).toEqual(REFERENCE_DIMENSIONS_CM);
    // No `click_type` in schema v2 — now statically guaranteed by AnnotationFile's type.
    expect(file.site).toBe("siteA");
    expect(file.created_at).toBe("2026-06-02T00:00:00.000Z");
  });
});

describe("parseAnnotationFile", () => {
  it("round-trips wire-ground annotations through build then parse", () => {
    const anns: Annotation[] = [
      { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 3 },
      { kind: "wire_ground", u: 50, v: 75, transect: "R", distance: 12 },
    ];

    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    const parsed = parseAnnotationFile(file);

    expect(parsed).toEqual(anns);
  });

  it("returns [] for malformed, empty, or unrecognized input (incl. legacy v1 clicks files)", () => {
    expect(parseAnnotationFile(null)).toEqual([]);
    expect(parseAnnotationFile(undefined)).toEqual([]);
    expect(parseAnnotationFile("not an object")).toEqual([]);
    expect(parseAnnotationFile({})).toEqual([]);
    expect(parseAnnotationFile({ wire_ground_points: "bad" })).toEqual([]);
    // legacy v1 file: only `clicks`, no wire_ground_points — intentionally not supported
    expect(
      parseAnnotationFile({ clicks: [{ u: 1, v: 2, transect: "L", distance: 3 }] })
    ).toEqual([]);
  });

  it("skips a non-object array item (null) instead of throwing", () => {
    expect(parseAnnotationFile({ wire_ground_points: [null] })).toEqual([]);
  });

  it("skips an array item missing required fields instead of throwing", () => {
    expect(parseAnnotationFile({ wire_ground_points: [{ u: 1, v: 2 }] })).toEqual([]);
  });
});
