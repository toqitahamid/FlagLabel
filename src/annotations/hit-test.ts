import type { Annotation, Point } from "./model";

// Active annotation type == an annotation `kind`. Derived from the union so it
// auto-widens if new annotation kinds are added.
export type ActiveType = Annotation["kind"];

function distSq(u: number, v: number, point: Point): number {
  const dx = u - point.u;
  const dy = v - point.v;
  return dx * dx + dy * dy;
}

// Squared distance from a click to an annotation, using only annotations whose
// kind matches the active type. For a span this is the distance to the NEARER
// endpoint (endpoint-based, not point-to-segment) so clicking near either end
// selects the whole span.
function distanceSqToActive(
  a: Annotation,
  point: Point,
  activeType: ActiveType
): number | null {
  if (a.kind !== activeType) return null;
  if (a.kind === "wire_ground") {
    return distSq(a.u, a.v, point);
  }
  if (a.kind === "flag_mask") {
    // A mask has no endpoints — the grabbable geometry is its outline, so the
    // nearest ring VERTEX wins. (Not point-in-polygon: a mask at 15 m is a few
    // pixels across, and an interior test would make it essentially unclickable
    // while an outline test stays consistent with every other kind's
    // nearest-feature rule.) Empty rings are unreachable — parseAnnotationFile
    // rejects them and the accept path never builds one — so this returns
    // Infinity rather than 0, which would hit-test as a bullseye.
    let best = Infinity;
    for (const ring of a.rings) {
      for (const [u, v] of ring) {
        const d2 = distSq(u, v, point);
        if (d2 < best) best = d2;
      }
    }
    return best;
  }
  if (a.kind === "flag_box") {
    // A box stores only two opposite corners, but all FOUR are grabbable — the
    // other two are implied by the axis-aligned rect. Without this branch the box
    // would fall through to the span case below and silently be selectable from
    // only its top-left and bottom-right.
    return Math.min(
      distSq(a.u1, a.v1, point),
      distSq(a.u2, a.v1, point),
      distSq(a.u2, a.v2, point),
      distSq(a.u1, a.v2, point)
    );
  }
  // span (vertical_span / horizontal_span / flag_to_ground_span): nearer endpoint wins
  return Math.min(distSq(a.u1, a.v1, point), distSq(a.u2, a.v2, point));
}

// Strict active-mode hit-test. Only annotations whose kind matches `activeType`
// are selectable; everything else is ignored so a coincident point of another
// type falls through (returns null → caller places). Tie-break is
// nearest-then-most-recent: among equal distances the higher index (placed
// later) wins, achieved by iterating ascending and accepting `<=` ties.
export function hitTest(
  annotations: Annotation[],
  point: Point,
  activeType: ActiveType,
  radiusImg: number
): number | null {
  let bestIdx: number | null = null;
  let bestD2 = radiusImg * radiusImg;
  for (let i = 0; i < annotations.length; i++) {
    const d2 = distanceSqToActive(annotations[i], point, activeType);
    if (d2 === null) continue;
    if (d2 <= bestD2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}
