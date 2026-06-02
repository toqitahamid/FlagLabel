export type Transect = "L" | "C" | "R";

export type WireGroundPoint = {
  kind: "wire_ground";
  u: number;
  v: number;
  transect: Transect;
  distance: number;
};

// Span types. The union widens with horizontal / flag-to-ground spans in
// later slices; keep this a string-union so callers can switch exhaustively.
export type SpanType = "vertical" | "horizontal";

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

// The union widens further with flag-to-ground spans in a later slice.
export type Annotation = WireGroundPoint | VerticalSpan | HorizontalSpan;

export type Counts = { L: number; C: number; R: number };

export function countsFromAnnotations(anns: Annotation[]): Counts {
  const out: Counts = { L: 0, C: 0, R: 0 };
  for (const a of anns) {
    if (a.kind === "wire_ground") out[a.transect]++;
  }
  return out;
}

export type Point = { u: number; v: number };

export type SpanEndpoints = { u1: number; v1: number; u2: number; v2: number };

// Canonical endpoint ordering for spans. For a vertical span we store the
// upper point (smaller `v`) as (u1,v1). Ties on `v` break deterministically
// on `u` (smaller first) so the result is order-independent. This same
// helper will canonicalize horizontal / flag-to-ground spans in later
// slices (their ordering rule keyed off `type`).
export function canonicalizeSpan(
  type: SpanType,
  p1: Point,
  p2: Point
): SpanEndpoints {
  switch (type) {
    case "vertical": {
      const swap =
        p2.v < p1.v || (p2.v === p1.v && p2.u < p1.u);
      const a = swap ? p2 : p1;
      const b = swap ? p1 : p2;
      return { u1: a.u, v1: a.v, u2: b.u, v2: b.v };
    }
    case "horizontal": {
      // Left-first: smaller-u point as (u1,v1). Ties on u break on smaller v
      // (mirror of vertical's tie-break on u) so the result is deterministic
      // and order-independent. Slice 4 (flag_to_ground) adds here.
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
