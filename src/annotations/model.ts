export type Transect = "L" | "C" | "R";

export type WireGroundPoint = {
  kind: "wire_ground";
  u: number;
  v: number;
  transect: Transect;
  distance: number;
};

// Span types. Kept a string-union so callers can switch exhaustively; adding a
// new span type forces a compile error at every `Record<SpanType, …>` site.
export type SpanType = "vertical" | "horizontal" | "flag_to_ground";

export type VerticalSpan = {
  kind: "vertical_span";
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  transect: Transect;
  distance: number;
};

export type HorizontalSpan = {
  kind: "horizontal_span";
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  transect: Transect;
  distance: number;
};

// Flag-body top → wire–ground intersection. Upper endpoint (flag top, smaller v)
// stored as (u1,v1); lower endpoint (ground) stored as (u2,v2) — same ordering
// rule as VerticalSpan. Average length: 49.53 cm (ADR-0002).
export type FlagToGroundSpan = {
  kind: "flag_to_ground_span";
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  transect: Transect;
  distance: number;
};

// Hand-drawn axis-aligned box around one flag, placed with two clicks on
// opposite corners. Stored canonically as top-left (u1,v1) → bottom-right
// (u2,v2) — see canonicalizeBox. NOT derived from the points/spans above:
// deriving a box from the existing geometry was tried and does not produce a
// correct flag box, so this is a first-class annotation the labeler draws.
export type FlagBox = {
  kind: "flag_box";
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  transect: Transect;
  distance: number;
};

// One closed ring of a mask outline: a list of [u, v] vertices in image pixels.
// Not a self-contained shape — a mask is a LIST of rings, because a segmentation
// can come back split (a flag partly occluded by a branch) or holed.
export type MaskRing = Array<[number, number]>;

// A segmentation mask for one flag, produced by the SAM3 service from a
// flag_box (plus optional refinement clicks) and then accepted by the labeler.
// The only annotation kind whose geometry is NOT two-endpoint: it carries
// `rings`, so it is deliberately excluded from the `Extract<Annotation, {u1}>`
// span alias and every render/tally loop keyed on that must branch for it.
// `score` is the model's confidence for the accepted candidate, kept so a
// downstream consumer can filter on it.
export type FlagMask = {
  kind: "flag_mask";
  rings: MaskRing[];
  score: number;
  transect: Transect;
  distance: number;
};

export type Annotation =
  | WireGroundPoint
  | VerticalSpan
  | HorizontalSpan
  | FlagToGroundSpan
  | FlagBox
  | FlagMask;

// Every two-click placement geometry: the three span types plus the box. The
// box is deliberately NOT a SpanType — its canonicalization mixes coordinates
// from both clicks (min/max per axis) instead of merely reordering the two
// points, so it gets its own function. Keying a Record on this still forces a
// compile error when a new placement geometry is added.
export type PlacementType = SpanType | "box";

export type Counts = { L: number; C: number; R: number };

export function countsFromAnnotations(anns: Annotation[]): Counts {
  const out: Counts = { L: 0, C: 0, R: 0 };
  for (const a of anns) {
    if (a.kind === "wire_ground") out[a.transect]++;
  }
  return out;
}

// Per-transect counts across ALL annotation kinds (used for folder-sidebar
// coverage, so a spans-only image isn't shown as unlabeled). Unlike
// countsFromAnnotations (wire-ground only), every kind contributes.
export function countsByTransect(anns: Annotation[]): Counts {
  const out: Counts = { L: 0, C: 0, R: 0 };
  for (const a of anns) out[a.transect]++;
  return out;
}

export type Point = { u: number; v: number };

export type SpanEndpoints = { u1: number; v1: number; u2: number; v2: number };

// Canonical endpoint ordering for spans, keyed off `type`. Vertical and
// flag-to-ground store the upper point (smaller `v`) as (u1,v1); horizontal
// stores the left point (smaller `u`) first. Ties break deterministically on
// the other axis so the result is order-independent.
export function canonicalizeSpan(
  type: SpanType,
  p1: Point,
  p2: Point
): SpanEndpoints {
  switch (type) {
    case "vertical":
    case "flag_to_ground": {
      // Upper-first: smaller-v point as (u1,v1); ties on v break on smaller u.
      // flag_to_ground shares this rule: u1,v1 = flag-body top; u2,v2 = ground.
      const swap =
        p2.v < p1.v || (p2.v === p1.v && p2.u < p1.u);
      const a = swap ? p2 : p1;
      const b = swap ? p1 : p2;
      return { u1: a.u, v1: a.v, u2: b.u, v2: b.v };
    }
    case "horizontal": {
      // Left-first: smaller-u point as (u1,v1). Ties on u break on smaller v
      // (mirror of vertical's tie-break on u) so the result is deterministic
      // and order-independent.
      const swap =
        p2.u < p1.u || (p2.u === p1.u && p2.v < p1.v);
      const a = swap ? p2 : p1;
      const b = swap ? p1 : p2;
      return { u1: a.u, v1: a.v, u2: b.u, v2: b.v };
    }
    default: {
      // Compile-time exhaustiveness guard: tsconfig lacks noImplicitReturns,
      // so without this a newly-added SpanType would silently fall through to
      // `undefined` and crash callers that destructure the result.
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

// Canonical corner ordering for a hand-drawn box: (u1,v1) = top-left,
// (u2,v2) = bottom-right. Unlike canonicalizeSpan this does NOT just reorder the
// two clicks — it takes the min/max per axis, so each output corner may mix a
// `u` from one click with a `v` from the other. That's what makes a box dragged
// bottom-right → top-left identical to one dragged top-left → bottom-right.
export function canonicalizeBox(p1: Point, p2: Point): SpanEndpoints {
  return {
    u1: Math.min(p1.u, p2.u),
    v1: Math.min(p1.v, p2.v),
    u2: Math.max(p1.u, p2.u),
    v2: Math.max(p1.v, p2.v),
  };
}

// Decimal places kept for mask ring vertices. A mask outline can run to
// thousands of vertices, and the model emits full float precision — at
// image-pixel scale 0.1 px is already far below any labeling or calibration
// tolerance, so anything past one decimal is pure JSON bloat.
export const MASK_COORD_DECIMALS = 1;

// The mask counterpart of canonicalizeSpan/canonicalizeBox: the normalization
// applied ONCE, when a model candidate is accepted as an annotation. Rounds every
// vertex to MASK_COORD_DECIMALS. Deliberately NOT done inside
// buildAnnotationFile — the schema layer stays a passthrough so build→parse is
// exactly content-preserving for coordinates that arrive from anywhere else.
export function roundRings(rings: MaskRing[]): MaskRing[] {
  const f = 10 ** MASK_COORD_DECIMALS;
  const r = (n: number) => Math.round(n * f) / f;
  return rings.map((ring) => ring.map(([u, v]) => [r(u), r(v)] as [number, number]));
}

// Axis-aligned bounding box of a mask's rings, in image pixels, in the same
// {u1,v1,u2,v2} top-left/bottom-right shape a box uses — so the zoom panel's
// AABB-overlap test accepts a mask without a second implementation. Returns null
// for a mask with no vertices (nothing to bound, nothing to draw).
export function maskBounds(rings: MaskRing[]): SpanEndpoints | null {
  let u1 = Infinity;
  let v1 = Infinity;
  let u2 = -Infinity;
  let v2 = -Infinity;
  for (const ring of rings) {
    for (const [u, v] of ring) {
      if (u < u1) u1 = u;
      if (v < v1) v1 = v;
      if (u > u2) u2 = u;
      if (v > v2) v2 = v;
    }
  }
  if (u1 === Infinity) return null;
  return { u1, v1, u2, v2 };
}
