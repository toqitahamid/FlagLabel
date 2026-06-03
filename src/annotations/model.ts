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

export type Annotation = WireGroundPoint | VerticalSpan | HorizontalSpan | FlagToGroundSpan;

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
