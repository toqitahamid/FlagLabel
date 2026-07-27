import { describe, it, expect } from "vitest";
import {
  buildAnnotationFile,
  parseAnnotationFile,
  REFERENCE_DIMENSIONS_CM,
  type FileMeta,
} from "./schema";
import type { Annotation } from "./model";
import { roundRings } from "./model";
import { pendingPolygonReducer, polygonRings, POLYGON_IDLE } from "./pending-polygon";

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

describe("flag_vertical_spans", () => {
  it("buildAnnotationFile emits flag_vertical_spans with canonical endpoint fields", () => {
    const anns: Annotation[] = [
      {
        kind: "vertical_span",
        u1: 200,
        v1: 100,
        u2: 205,
        v2: 360,
        transect: "C",
        distance: 3,
      },
    ];
    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    expect(file.flag_vertical_spans).toEqual([
      { u1: 200, v1: 100, u2: 205, v2: 360, transect: "C", distance: 3 },
    ]);
    // wire-ground array stays empty for a spans-only image
    expect(file.wire_ground_points).toEqual([]);
  });

  it("round-trips a vertical span through build then parse", () => {
    const anns: Annotation[] = [
      {
        kind: "vertical_span",
        u1: 200,
        v1: 100,
        u2: 205,
        v2: 360,
        transect: "R",
        distance: 12,
      },
    ];
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual(anns);
  });

  it("round-trips mixed annotations per-kind (typed arrays regroup order)", () => {
    const wg: Annotation = { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 };
    const span: Annotation = {
      kind: "vertical_span",
      u1: 10,
      v1: 5,
      u2: 10,
      v2: 50,
      transect: "C",
      distance: 2,
    };
    const wg2: Annotation = { kind: "wire_ground", u: 3, v: 4, transect: "R", distance: 5 };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [wg, span, wg2], "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    // Parsing reads wire_ground_points first, then flag_vertical_spans → regrouped.
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([wg, wg2]);
    expect(parsed.filter((a) => a.kind === "vertical_span")).toEqual([span]);
    expect(parsed).toHaveLength(3);
  });

  it("skips malformed span items but keeps valid ones", () => {
    const result = parseAnnotationFile({
      flag_vertical_spans: [
        null,
        { u1: 1, v1: 2, u2: 3 }, // missing v2/transect/distance
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "X", distance: 1 }, // bad transect
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "L", distance: 1 }, // valid
      ],
    });
    expect(result).toEqual([
      { kind: "vertical_span", u1: 1, v1: 2, u2: 3, v2: 4, transect: "L", distance: 1 },
    ]);
  });

  it("returns [] for non-array flag_vertical_spans", () => {
    expect(parseAnnotationFile({ flag_vertical_spans: "bad" })).toEqual([]);
  });
});

describe("flag_horizontal_spans", () => {
  it("buildAnnotationFile emits flag_horizontal_spans with canonical endpoint fields", () => {
    const anns: Annotation[] = [
      {
        kind: "horizontal_span",
        u1: 100,
        v1: 200,
        u2: 500,
        v2: 205,
        transect: "L",
        distance: 8,
      },
    ];
    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    expect(file.flag_horizontal_spans).toEqual([
      { u1: 100, v1: 200, u2: 500, v2: 205, transect: "L", distance: 8 },
    ]);
    // other arrays stay empty for a spans-only image
    expect(file.wire_ground_points).toEqual([]);
    expect(file.flag_vertical_spans).toEqual([]);
  });

  it("round-trips a horizontal span through build then parse", () => {
    const anns: Annotation[] = [
      {
        kind: "horizontal_span",
        u1: 100,
        v1: 200,
        u2: 500,
        v2: 205,
        transect: "R",
        distance: 5,
      },
    ];
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual(anns);
  });

  it("round-trips mixed annotations of all three kinds", () => {
    const wg: Annotation = { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 };
    const vspan: Annotation = {
      kind: "vertical_span",
      u1: 10,
      v1: 5,
      u2: 10,
      v2: 50,
      transect: "C",
      distance: 2,
    };
    const hspan: Annotation = {
      kind: "horizontal_span",
      u1: 50,
      v1: 100,
      u2: 300,
      v2: 103,
      transect: "R",
      distance: 3,
    };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [wg, vspan, hspan], "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([wg]);
    expect(parsed.filter((a) => a.kind === "vertical_span")).toEqual([vspan]);
    expect(parsed.filter((a) => a.kind === "horizontal_span")).toEqual([hspan]);
    expect(parsed).toHaveLength(3);
  });

  it("skips malformed horizontal span items but keeps valid ones", () => {
    const result = parseAnnotationFile({
      flag_horizontal_spans: [
        null,
        { u1: 1, v1: 2, u2: 3 }, // missing v2/transect/distance
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "X", distance: 1 }, // bad transect
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "C", distance: 5 }, // valid
      ],
    });
    expect(result).toEqual([
      { kind: "horizontal_span", u1: 1, v1: 2, u2: 3, v2: 4, transect: "C", distance: 5 },
    ]);
  });

  it("returns [] for non-array flag_horizontal_spans", () => {
    expect(parseAnnotationFile({ flag_horizontal_spans: "bad" })).toEqual([]);
  });
});

describe("flag_to_ground_spans", () => {
  it("buildAnnotationFile emits flag_to_ground_spans with canonical endpoint fields", () => {
    const anns: Annotation[] = [
      {
        kind: "flag_to_ground_span",
        u1: 200,
        v1: 100,
        u2: 210,
        v2: 650,
        transect: "C",
        distance: 5,
      },
    ];
    const file = buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z");
    expect(file.flag_to_ground_spans).toEqual([
      { u1: 200, v1: 100, u2: 210, v2: 650, transect: "C", distance: 5 },
    ]);
    // other arrays stay empty for a spans-only image
    expect(file.wire_ground_points).toEqual([]);
    expect(file.flag_vertical_spans).toEqual([]);
    expect(file.flag_horizontal_spans).toEqual([]);
  });

  it("round-trips a flag_to_ground span through build then parse", () => {
    const anns: Annotation[] = [
      {
        kind: "flag_to_ground_span",
        u1: 200,
        v1: 100,
        u2: 210,
        v2: 650,
        transect: "R",
        distance: 9,
      },
    ];
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, anns, "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual(anns);
  });

  it("round-trips mixed annotations of all four kinds", () => {
    const wg: Annotation = { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 };
    const vspan: Annotation = {
      kind: "vertical_span",
      u1: 10,
      v1: 5,
      u2: 10,
      v2: 50,
      transect: "C",
      distance: 2,
    };
    const hspan: Annotation = {
      kind: "horizontal_span",
      u1: 50,
      v1: 100,
      u2: 300,
      v2: 103,
      transect: "R",
      distance: 3,
    };
    const gspan: Annotation = {
      kind: "flag_to_ground_span",
      u1: 200,
      v1: 50,
      u2: 215,
      v2: 600,
      transect: "L",
      distance: 7,
    };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [wg, vspan, hspan, gspan], "0.2.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([wg]);
    expect(parsed.filter((a) => a.kind === "vertical_span")).toEqual([vspan]);
    expect(parsed.filter((a) => a.kind === "horizontal_span")).toEqual([hspan]);
    expect(parsed.filter((a) => a.kind === "flag_to_ground_span")).toEqual([gspan]);
    expect(parsed).toHaveLength(4);
  });

  it("skips malformed flag_to_ground span items but keeps valid ones", () => {
    const result = parseAnnotationFile({
      flag_to_ground_spans: [
        null,
        { u1: 1, v1: 2, u2: 3 }, // missing v2/transect/distance
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "X", distance: 1 }, // bad transect
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "C", distance: 8 }, // valid
      ],
    });
    expect(result).toEqual([
      { kind: "flag_to_ground_span", u1: 1, v1: 2, u2: 3, v2: 4, transect: "C", distance: 8 },
    ]);
  });

  it("returns [] for non-array flag_to_ground_spans", () => {
    expect(parseAnnotationFile({ flag_to_ground_spans: "bad" })).toEqual([]);
  });
});

describe("flag_boxes (additive key, schema_version stays 2)", () => {
  it("buildAnnotationFile emits flag_boxes with canonical corner fields", () => {
    const anns: Annotation[] = [
      {
        kind: "flag_box",
        u1: 100,
        v1: 200,
        u2: 180,
        v2: 320,
        transect: "L",
        distance: 4,
      },
    ];
    const file = buildAnnotationFile(META, anns, "0.3.0", "2026-06-02T00:00:00.000Z");
    expect(file.flag_boxes).toEqual([
      { u1: 100, v1: 200, u2: 180, v2: 320, transect: "L", distance: 4 },
    ]);
    // other arrays stay empty for a boxes-only image
    expect(file.wire_ground_points).toEqual([]);
    expect(file.flag_vertical_spans).toEqual([]);
    expect(file.flag_horizontal_spans).toEqual([]);
    expect(file.flag_to_ground_spans).toEqual([]);
  });

  it("round-trips a box through build then parse", () => {
    const anns: Annotation[] = [
      {
        kind: "flag_box",
        u1: 100,
        v1: 200,
        u2: 180,
        v2: 320,
        transect: "R",
        distance: 9,
      },
    ];
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, anns, "0.3.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual(anns);
  });

  it("round-trips mixed annotations of all five kinds", () => {
    const wg: Annotation = { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 };
    const vspan: Annotation = {
      kind: "vertical_span",
      u1: 10,
      v1: 5,
      u2: 10,
      v2: 50,
      transect: "C",
      distance: 2,
    };
    const hspan: Annotation = {
      kind: "horizontal_span",
      u1: 50,
      v1: 100,
      u2: 300,
      v2: 103,
      transect: "R",
      distance: 3,
    };
    const gspan: Annotation = {
      kind: "flag_to_ground_span",
      u1: 12,
      v1: 4,
      u2: 14,
      v2: 90,
      transect: "L",
      distance: 7,
    };
    const box: Annotation = {
      kind: "flag_box",
      u1: 8,
      v1: 3,
      u2: 20,
      v2: 55,
      transect: "C",
      distance: 11,
    };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [box, wg, vspan, hspan, gspan], "0.3.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([wg]);
    expect(parsed.filter((a) => a.kind === "vertical_span")).toEqual([vspan]);
    expect(parsed.filter((a) => a.kind === "horizontal_span")).toEqual([hspan]);
    expect(parsed.filter((a) => a.kind === "flag_to_ground_span")).toEqual([gspan]);
    expect(parsed.filter((a) => a.kind === "flag_box")).toEqual([box]);
    expect(parsed).toHaveLength(5);
  });

  it("skips malformed box items but keeps valid ones", () => {
    const result = parseAnnotationFile({
      flag_boxes: [
        null,
        { u1: 1, v1: 2, u2: 3 }, // missing v2/transect/distance
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "X", distance: 1 }, // bad transect
        { u1: 1, v1: 2, u2: 3, v2: 4, transect: "L", distance: 2 }, // valid
      ],
    });
    expect(result).toEqual([
      { kind: "flag_box", u1: 1, v1: 2, u2: 3, v2: 4, transect: "L", distance: 2 },
    ]);
  });

  it("returns [] for non-array flag_boxes", () => {
    expect(parseAnnotationFile({ flag_boxes: "bad" })).toEqual([]);
  });

  it("loads a schema-v2 file (no flag_boxes key) with all its spans and no boxes", () => {
    // Verbatim shape of a v2 file: the four v2 arrays, no `flag_boxes`.
    const v2File = {
      schema_version: 2,
      site: "siteA",
      image: "IMG_0001.jpg",
      image_w: 4000,
      image_h: 3000,
      reference_dimensions_cm: REFERENCE_DIMENSIONS_CM,
      created_at: "2026-06-02T00:00:00.000Z",
      app_version: "0.2.0",
      wire_ground_points: [{ u: 100, v: 200, transect: "L", distance: 3 }],
      flag_vertical_spans: [
        { u1: 200, v1: 100, u2: 205, v2: 360, transect: "C", distance: 3 },
      ],
      flag_horizontal_spans: [],
      flag_to_ground_spans: [
        { u1: 12, v1: 4, u2: 14, v2: 90, transect: "L", distance: 7 },
      ],
    };
    const parsed = parseAnnotationFile(v2File);
    expect(parsed).toHaveLength(3);
    expect(parsed.filter((a) => a.kind === "flag_box")).toEqual([]);
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([
      { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 3 },
    ]);
  });

  it("re-building a boxless file keeps schema_version 2 and adds an empty flag_boxes", () => {
    const boxless = parseAnnotationFile({
      wire_ground_points: [{ u: 100, v: 200, transect: "L", distance: 3 }],
    });
    const rebuilt = buildAnnotationFile(
      META,
      boxless,
      "0.2.0",
      "2026-06-02T00:00:00.000Z"
    );
    // No version bump: flag_boxes is additive, so a file that gains the key is
    // still schema 2 and stays readable by anything that read v2 before.
    expect(rebuilt.schema_version).toBe(2);
    expect(rebuilt.flag_boxes).toEqual([]);
    // Pre-existing content is untouched.
    expect(rebuilt.wire_ground_points).toEqual([
      { u: 100, v: 200, transect: "L", distance: 3 },
    ]);
  });

  it("re-building a file WITH boxes also keeps schema_version 2 and carries them through", () => {
    const box: Annotation = {
      kind: "flag_box",
      u1: 8,
      v1: 3,
      u2: 20,
      v2: 55,
      transect: "C",
      distance: 11,
    };
    const rebuilt = buildAnnotationFile(
      META,
      parseAnnotationFile(
        buildAnnotationFile(META, [box], "0.4.0", "2026-06-02T00:00:00.000Z")
      ),
      "0.4.0",
      "2026-06-02T00:00:00.000Z"
    );
    expect(rebuilt.schema_version).toBe(2);
    expect(rebuilt.flag_boxes).toEqual([
      { u1: 8, v1: 3, u2: 20, v2: 55, transect: "C", distance: 11 },
    ]);
  });
});

describe("flag_masks (additive key, schema_version stays 2)", () => {
  const MASK: Annotation = {
    kind: "flag_mask",
    rings: [
      [
        [1225.0, 1982.0],
        [1240.0, 1982.0],
        [1240.0, 2062.0],
        [1225.0, 2062.0],
      ],
    ],
    score: 0.94,
    transect: "L",
    distance: 1,
  };

  it("buildAnnotationFile emits flag_masks with rings + score", () => {
    const file = buildAnnotationFile(META, [MASK], "0.4.0", "2026-06-02T00:00:00.000Z");
    expect(file.schema_version).toBe(2);
    expect(file.flag_masks).toEqual([
      {
        rings: [
          [
            [1225.0, 1982.0],
            [1240.0, 1982.0],
            [1240.0, 2062.0],
            [1225.0, 2062.0],
          ],
        ],
        score: 0.94,
        transect: "L",
        distance: 1,
      },
    ]);
    // Every other array stays empty for a masks-only image.
    expect(file.wire_ground_points).toEqual([]);
    expect(file.flag_boxes).toEqual([]);
  });

  it("round-trips a mask through build then parse", () => {
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [MASK], "0.4.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual([MASK]);
  });

  it("round-trips a multi-ring mask (a split or holed segmentation)", () => {
    const split: Annotation = {
      kind: "flag_mask",
      rings: [
        [
          [1, 1],
          [5, 1],
          [5, 5],
        ],
        [
          [20, 20],
          [24, 20],
          [24, 24],
        ],
      ],
      score: 0.71,
      transect: "C",
      distance: 8.5,
    };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [split], "0.4.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual([split]);
  });

  it("round-trips a HAND-DRAWN mask: single ring, score exactly 1", () => {
    // Built the way App.tsx builds it on Enter — reducer → polygonRings →
    // roundRings — so the file format and the hand-drawn score convention are
    // asserted together. score 1 is reserved for hand-drawn outlines; a SAM3
    // candidate's score is model-produced and < 1 in practice.
    let state = pendingPolygonReducer(POLYGON_IDLE, {
      type: "start",
      transect: "R",
      distance: 22.5,
    });
    for (const [u, v] of [
      [810.44, 1200.06],
      [822.5, 1199.91],
      [823.17, 1268.4],
      [809.98, 1266.72],
    ]) {
      state = pendingPolygonReducer(state, { type: "addVertex", point: { u, v } });
    }
    const drawn: Annotation = {
      kind: "flag_mask",
      rings: roundRings(polygonRings(state)),
      score: 1,
      transect: "R",
      distance: 22.5,
    };
    expect(drawn.kind === "flag_mask" && drawn.rings).toEqual([
      [
        [810.4, 1200.1],
        [822.5, 1199.9],
        [823.2, 1268.4],
        [810, 1266.7],
      ],
    ]);
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [drawn], "0.4.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed).toEqual([drawn]);
    expect(parsed[0].kind === "flag_mask" && parsed[0].score).toBe(1);
  });

  it("round-trips every kind together (masks regroup like the other arrays)", () => {
    const wg: Annotation = { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 };
    const box: Annotation = {
      kind: "flag_box",
      u1: 8,
      v1: 3,
      u2: 20,
      v2: 55,
      transect: "C",
      distance: 11,
    };
    const parsed = parseAnnotationFile(
      buildAnnotationFile(META, [MASK, wg, box], "0.4.0", "2026-06-02T00:00:00.000Z")
    );
    expect(parsed.filter((a) => a.kind === "wire_ground")).toEqual([wg]);
    expect(parsed.filter((a) => a.kind === "flag_box")).toEqual([box]);
    expect(parsed.filter((a) => a.kind === "flag_mask")).toEqual([MASK]);
    expect(parsed).toHaveLength(3);
  });

  it("skips malformed mask items but keeps valid ones", () => {
    const result = parseAnnotationFile({
      flag_masks: [
        null,
        { rings: [[[1, 2]]], score: 0.5 }, // missing transect/distance
        { rings: [[[1, 2]]], score: 0.5, transect: "X", distance: 1 }, // bad transect
        { rings: [[[1, 2]]], transect: "L", distance: 1 }, // missing score
        { rings: "nope", score: 0.5, transect: "L", distance: 1 }, // rings not an array
        { rings: [[[1, "2"]]], score: 0.5, transect: "L", distance: 1 }, // non-numeric vertex
        { rings: [[[1, 2, 3]]], score: 0.5, transect: "L", distance: 1 }, // 3-tuple vertex
        { rings: [[[9, 8]]], score: 0.6, transect: "R", distance: 4 }, // valid
      ],
    });
    expect(result).toEqual([
      { kind: "flag_mask", rings: [[[9, 8]]], score: 0.6, transect: "R", distance: 4 },
    ]);
  });

  it("skips a mask with no vertices — nothing to draw, nothing to measure", () => {
    expect(
      parseAnnotationFile({
        flag_masks: [
          { rings: [], score: 0.9, transect: "L", distance: 1 },
          { rings: [[]], score: 0.9, transect: "L", distance: 1 },
        ],
      })
    ).toEqual([]);
  });

  it("returns [] for non-array flag_masks", () => {
    expect(parseAnnotationFile({ flag_masks: "bad" })).toEqual([]);
  });

  it("loads a file with NO flag_masks key unchanged (back-compat both ways)", () => {
    // Verbatim shape of a pre-mask file: the four v2 arrays plus flag_boxes.
    const preMaskFile = {
      schema_version: 2,
      site: "siteA",
      image: "IMG_0001.jpg",
      image_w: 4000,
      image_h: 3000,
      reference_dimensions_cm: REFERENCE_DIMENSIONS_CM,
      created_at: "2026-06-02T00:00:00.000Z",
      app_version: "0.4.0",
      wire_ground_points: [{ u: 100, v: 200, transect: "L", distance: 3 }],
      flag_vertical_spans: [],
      flag_horizontal_spans: [],
      flag_to_ground_spans: [],
      flag_boxes: [
        { u1: 8, v1: 3, u2: 20, v2: 55, transect: "C", distance: 11 },
      ],
    };
    const parsed = parseAnnotationFile(preMaskFile);
    expect(parsed).toHaveLength(2);
    expect(parsed.filter((a) => a.kind === "flag_mask")).toEqual([]);
    expect(parsed.filter((a) => a.kind === "flag_box")).toHaveLength(1);
  });

  it("re-building a maskless file keeps schema_version 2 and adds an empty flag_masks", () => {
    const maskless = parseAnnotationFile({
      wire_ground_points: [{ u: 100, v: 200, transect: "L", distance: 3 }],
    });
    const rebuilt = buildAnnotationFile(
      META,
      maskless,
      "0.4.0",
      "2026-06-02T00:00:00.000Z"
    );
    // No version bump: flag_masks is additive, exactly like flag_boxes.
    expect(rebuilt.schema_version).toBe(2);
    expect(rebuilt.flag_masks).toEqual([]);
    expect(rebuilt.wire_ground_points).toEqual([
      { u: 100, v: 200, transect: "L", distance: 3 },
    ]);
  });

  it("re-building a file WITH masks keeps schema_version 2 and carries them through", () => {
    const rebuilt = buildAnnotationFile(
      META,
      parseAnnotationFile(
        buildAnnotationFile(META, [MASK], "0.4.0", "2026-06-02T00:00:00.000Z")
      ),
      "0.4.0",
      "2026-06-02T00:00:00.000Z"
    );
    expect(rebuilt.schema_version).toBe(2);
    expect(rebuilt.flag_masks).toHaveLength(1);
    expect(rebuilt.flag_masks[0].score).toBe(0.94);
  });
});
