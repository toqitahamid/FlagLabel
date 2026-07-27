import type {
  Annotation,
  MaskRing,
  Transect,
  VerticalSpan,
  HorizontalSpan,
  FlagToGroundSpan,
  FlagBox,
  FlagMask,
} from "./model";

// The two-endpoint members of the Annotation union (the three spans plus the
// box — everything serialized as u1/v1/u2/v2). Mirrors the `Span` alias in
// App.tsx; defined here so the schema layer stays self-contained.
type Span = Extract<Annotation, { u1: number }>;

// Stays at 2: `flag_boxes` and `flag_masks` were both added as purely ADDITIVE
// keys, not breaks. v2 files load unchanged (the arrays are simply absent → no
// boxes, no masks) and older readers skip the keys they don't know. ADR-0001
// reserves this number for a clean break and obliges the external distance
// pipeline to branch on it, so bumping would risk a consumer we can't inspect in
// exchange for nothing.
export const SCHEMA_VERSION = 2;

export const REFERENCE_DIMENSIONS_CM = {
  flag_body_h: 6.35,
  flag_body_w: 8.89,
  wire_total: 53.34,
  wire_above_ground: 49.53,
  wire_buried: 3.81,
} as const;

export type FileMeta = {
  site: string;
  image: string;
  image_w: number;
  image_h: number;
};

export type AnnotationFile = {
  schema_version: number;
  site: string;
  image: string;
  image_w: number;
  image_h: number;
  reference_dimensions_cm: typeof REFERENCE_DIMENSIONS_CM;
  created_at: string;
  app_version: string;
  wire_ground_points: Array<{
    u: number;
    v: number;
    transect: Transect;
    distance: number;
  }>;
  flag_vertical_spans: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
  flag_horizontal_spans: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
  flag_to_ground_spans: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
  // Hand-drawn flag boxes. Additive: absent in files written before boxes
  // existed. (u1,v1) = top-left corner, (u2,v2) = bottom-right; same field shape
  // as the span arrays.
  flag_boxes: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
  // Accepted segmentation masks. Additive: absent in files written before masks
  // existed. The only array whose geometry is not two-endpoint — `rings` is a
  // list of closed rings, each a list of [u, v] image-pixel vertices, rounded to
  // MASK_COORD_DECIMALS at accept time. `score` is the model's confidence for the
  // candidate the labeler accepted.
  flag_masks: Array<{
    rings: MaskRing[];
    score: number;
    transect: Transect;
    distance: number;
  }>;
};

export function buildAnnotationFile(
  meta: FileMeta,
  annotations: Annotation[],
  appVersion: string,
  createdAt: string
): AnnotationFile {
  const wire_ground_points = annotations
    .filter((a): a is Extract<Annotation, { kind: "wire_ground" }> => a.kind === "wire_ground")
    .map((a) => ({
      u: a.u,
      v: a.v,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_vertical_spans = annotations
    .filter((a): a is VerticalSpan => a.kind === "vertical_span")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_horizontal_spans = annotations
    .filter((a): a is HorizontalSpan => a.kind === "horizontal_span")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_to_ground_spans = annotations
    .filter((a): a is FlagToGroundSpan => a.kind === "flag_to_ground_span")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_boxes = annotations
    .filter((a): a is FlagBox => a.kind === "flag_box")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_masks = annotations
    .filter((a): a is FlagMask => a.kind === "flag_mask")
    .map((a) => ({
      rings: a.rings,
      score: a.score,
      transect: a.transect,
      distance: a.distance,
    }));

  return {
    schema_version: SCHEMA_VERSION,
    site: meta.site,
    image: meta.image,
    image_w: meta.image_w,
    image_h: meta.image_h,
    reference_dimensions_cm: REFERENCE_DIMENSIONS_CM,
    created_at: createdAt,
    app_version: appVersion,
    wire_ground_points,
    flag_vertical_spans,
    flag_horizontal_spans,
    flag_to_ground_spans,
    flag_boxes,
    flag_masks,
  };
}

function isTransect(x: unknown): x is Transect {
  return x === "L" || x === "C" || x === "R";
}

// Parse one two-endpoint array under `key`, tagging valid items with `kind`.
// Per-item validation (object check → 6-field type checks); malformed items are
// skipped. Shared by every span kind AND by `flag_boxes` (identical field
// shape); one call per array in parseAnnotationFile.
function parseSpanArray(
  obj: Record<string, unknown>,
  key: string,
  kind: Span["kind"]
): Span[] {
  const arr = obj[key];
  if (!Array.isArray(arr)) return [];
  const out: Span[] = [];
  for (const s of arr) {
    if (typeof s !== "object" || s === null) continue;
    const rec = s as Record<string, unknown>;
    if (
      typeof rec.u1 !== "number" ||
      typeof rec.v1 !== "number" ||
      typeof rec.u2 !== "number" ||
      typeof rec.v2 !== "number" ||
      !isTransect(rec.transect) ||
      typeof rec.distance !== "number"
    )
      continue;
    out.push({
      kind,
      u1: rec.u1,
      v1: rec.v1,
      u2: rec.u2,
      v2: rec.v2,
      transect: rec.transect,
      distance: rec.distance,
    });
  }
  return out;
}

// Validate one `rings` value: an array of rings, each a non-empty array of
// [number, number] pairs. Returns null (→ the whole mask item is skipped) for
// anything malformed, INCLUDING an empty ring list or an empty ring — a mask with
// no vertices has nothing to draw and nothing to measure, so it is treated as
// malformed rather than loaded as an invisible annotation. Same per-item skip
// discipline as parseSpanArray.
function parseRings(x: unknown): MaskRing[] | null {
  if (!Array.isArray(x) || x.length === 0) return null;
  const out: MaskRing[] = [];
  for (const ring of x) {
    if (!Array.isArray(ring) || ring.length === 0) return null;
    const pts: MaskRing = [];
    for (const pt of ring) {
      if (
        !Array.isArray(pt) ||
        pt.length !== 2 ||
        typeof pt[0] !== "number" ||
        typeof pt[1] !== "number"
      )
        return null;
      pts.push([pt[0], pt[1]]);
    }
    out.push(pts);
  }
  return out;
}

// Parse the additive `flag_masks` array. Separate from parseSpanArray because a
// mask's geometry is rings + score, not u1/v1/u2/v2.
function parseMaskArray(obj: Record<string, unknown>): FlagMask[] {
  const arr = obj.flag_masks;
  if (!Array.isArray(arr)) return [];
  const out: FlagMask[] = [];
  for (const m of arr) {
    if (typeof m !== "object" || m === null) continue;
    const rec = m as Record<string, unknown>;
    const rings = parseRings(rec.rings);
    if (
      rings === null ||
      typeof rec.score !== "number" ||
      !isTransect(rec.transect) ||
      typeof rec.distance !== "number"
    )
      continue;
    out.push({
      kind: "flag_mask",
      rings,
      score: rec.score,
      transect: rec.transect,
      distance: rec.distance,
    });
  }
  return out;
}

export function parseAnnotationFile(json: unknown): Annotation[] {
  if (typeof json !== "object" || json === null) return [];
  const obj = json as Record<string, unknown>;
  const result: Annotation[] = [];

  const points = obj.wire_ground_points;
  if (Array.isArray(points)) {
    for (const p of points) {
      if (typeof p !== "object" || p === null) continue;
      const rec = p as Record<string, unknown>;
      if (
        typeof rec.u !== "number" ||
        typeof rec.v !== "number" ||
        !isTransect(rec.transect) ||
        typeof rec.distance !== "number"
      )
        continue;
      result.push({
        kind: "wire_ground",
        u: rec.u,
        v: rec.v,
        transect: rec.transect,
        distance: rec.distance,
      });
    }
  }

  result.push(...parseSpanArray(obj, "flag_vertical_spans", "vertical_span"));
  result.push(...parseSpanArray(obj, "flag_horizontal_spans", "horizontal_span"));
  result.push(...parseSpanArray(obj, "flag_to_ground_spans", "flag_to_ground_span"));
  // Additive key: absent in files written before boxes existed → parseSpanArray
  // returns [] and those files load unchanged.
  result.push(...parseSpanArray(obj, "flag_boxes", "flag_box"));
  // Additive key: absent in files written before masks existed → [] and those
  // files load unchanged.
  result.push(...parseMaskArray(obj));

  return result;
}
