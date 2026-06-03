import { describe, it, expect } from "vitest";
import { serializeAnnotationFile, exportEntryName, buildZipEntries } from "./export";
import {
  buildAnnotationFile,
  parseAnnotationFile,
  type FileMeta,
} from "../annotations/schema";
import type { Annotation } from "../annotations/model";

// ─── shared fixture helpers ───────────────────────────────────────────────────

const META: FileMeta = {
  site: "cam02",
  image: "IMG_0001.JPG",
  image_w: 4000,
  image_h: 3000,
};

const ANNS: Annotation[] = [
  { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 3 },
];

// ─── serializeAnnotationFile ─────────────────────────────────────────────────

describe("serializeAnnotationFile", () => {
  it("produces output byte-identical to JSON.stringify(file, null, 2)", () => {
    const file = buildAnnotationFile(META, ANNS, "0.2.1", "2026-06-03T00:00:00.000Z");
    const result = serializeAnnotationFile(file);
    expect(result).toBe(JSON.stringify(file, null, 2));
  });

  it("exact string for a small known fixture (spot-check 2-space indent)", () => {
    const file = buildAnnotationFile(
      { site: "s1", image: "A.jpg", image_w: 100, image_h: 50 },
      [],
      "0.2.1",
      "2026-06-03T12:00:00.000Z"
    );
    const result = serializeAnnotationFile(file);
    // Must start with opening brace + 2-space indent on first field
    expect(result.startsWith("{\n  \"schema_version\"")).toBe(true);
    // Must end with closing brace (no trailing newline from desktop)
    expect(result.endsWith("}")).toBe(true);
    // Must use exactly 2-space indent (not tab, not 4-space)
    expect(result).toContain("\n  \"site\"");
  });
});

// ─── exportEntryName ─────────────────────────────────────────────────────────

describe("exportEntryName", () => {
  it("cam02 + IMG_0001.JPG → cam02__IMG_0001.json", () => {
    const file = buildAnnotationFile(META, ANNS, "0.2.1", "2026-06-03T00:00:00.000Z");
    expect(exportEntryName(file)).toBe("cam02__IMG_0001.json");
  });

  it("strips .jpeg extension", () => {
    const file = buildAnnotationFile(
      { site: "cam01", image: "photo.jpeg", image_w: 1920, image_h: 1080 },
      [],
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );
    expect(exportEntryName(file)).toBe("cam01__photo.json");
  });

  it("strips .png extension", () => {
    const file = buildAnnotationFile(
      { site: "camX", image: "frame_042.png", image_w: 800, image_h: 600 },
      [],
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );
    expect(exportEntryName(file)).toBe("camX__frame_042.json");
  });

  it("strips lowercase .jpg extension", () => {
    const file = buildAnnotationFile(
      { site: "siteA", image: "IMG_0001.jpg", image_w: 4000, image_h: 3000 },
      [],
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );
    expect(exportEntryName(file)).toBe("siteA__IMG_0001.json");
  });
});

// ─── buildZipEntries ─────────────────────────────────────────────────────────

describe("buildZipEntries", () => {
  it("produces one entry per file, correct name, correct content, order preserved", () => {
    const fileA = buildAnnotationFile(
      { site: "siteA", image: "A.JPG", image_w: 100, image_h: 100 },
      [{ kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 }],
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );
    const fileB = buildAnnotationFile(
      { site: "siteB", image: "B.JPG", image_w: 200, image_h: 200 },
      [{ kind: "wire_ground", u: 3, v: 4, transect: "R", distance: 5 }],
      "0.2.1",
      "2026-06-03T01:00:00.000Z"
    );
    const fileC = buildAnnotationFile(
      { site: "siteA", image: "C.JPG", image_w: 100, image_h: 100 },
      [],
      "0.2.1",
      "2026-06-03T02:00:00.000Z"
    );

    const entries = buildZipEntries([fileA, fileB, fileC]);

    expect(entries).toHaveLength(3);
    expect(entries[0].name).toBe("siteA__A.json");
    expect(entries[1].name).toBe("siteB__B.json");
    expect(entries[2].name).toBe("siteA__C.json");
    expect(entries[0].content).toBe(serializeAnnotationFile(fileA));
    expect(entries[1].content).toBe(serializeAnnotationFile(fileB));
    expect(entries[2].content).toBe(serializeAnnotationFile(fileC));
  });

  it("returns [] for an empty input array", () => {
    expect(buildZipEntries([])).toEqual([]);
  });
});

// ─── empty-image entry (behavior 5) ──────────────────────────────────────────

describe("empty annotation files", () => {
  it("a file with all four annotation arrays empty still produces an entry", () => {
    const emptyFile = buildAnnotationFile(
      { site: "camEmpty", image: "shot.jpg", image_w: 1920, image_h: 1080 },
      [],
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );
    const entries = buildZipEntries([emptyFile]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("camEmpty__shot.json");
  });
});

// ─── round-trip sanity (behavior 6) ──────────────────────────────────────────

describe("round-trip through serialize + parse", () => {
  it("parseAnnotationFile(JSON.parse(serializeAnnotationFile(file))) yields original annotations", () => {
    const annotations: Annotation[] = [
      { kind: "wire_ground", u: 10, v: 20, transect: "C", distance: 5 },
      {
        kind: "vertical_span",
        u1: 100,
        v1: 50,
        u2: 105,
        v2: 200,
        transect: "L",
        distance: 3,
      },
      {
        kind: "horizontal_span",
        u1: 50,
        v1: 100,
        u2: 300,
        v2: 103,
        transect: "R",
        distance: 8,
      },
      {
        kind: "flag_to_ground_span",
        u1: 200,
        v1: 50,
        u2: 210,
        v2: 600,
        transect: "C",
        distance: 7,
      },
    ];

    const file = buildAnnotationFile(
      { site: "cam01", image: "IMG_9999.JPG", image_w: 4000, image_h: 3000 },
      annotations,
      "0.2.1",
      "2026-06-03T00:00:00.000Z"
    );

    const serialized = serializeAnnotationFile(file);
    const reparsed = parseAnnotationFile(JSON.parse(serialized));

    // parseAnnotationFile groups by kind (wire_ground first, then spans in order)
    expect(reparsed.filter((a) => a.kind === "wire_ground")).toEqual(
      annotations.filter((a) => a.kind === "wire_ground")
    );
    expect(reparsed.filter((a) => a.kind === "vertical_span")).toEqual(
      annotations.filter((a) => a.kind === "vertical_span")
    );
    expect(reparsed.filter((a) => a.kind === "horizontal_span")).toEqual(
      annotations.filter((a) => a.kind === "horizontal_span")
    );
    expect(reparsed.filter((a) => a.kind === "flag_to_ground_span")).toEqual(
      annotations.filter((a) => a.kind === "flag_to_ground_span")
    );
    expect(reparsed).toHaveLength(annotations.length);
  });
});
