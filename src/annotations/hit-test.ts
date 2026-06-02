import type { Annotation, Point } from "./model";

// Active annotation type == an annotation `kind`. Derived from the union so it
// auto-widens with new span kinds in later slices.
export type ActiveType = Annotation["kind"];

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
    const dx = a.u - point.u;
    const dy = a.v - point.v;
    return dx * dx + dy * dy;
  }
  // vertical_span: nearer endpoint wins
  const dx1 = a.u1 - point.u;
  const dy1 = a.v1 - point.v;
  const dx2 = a.u2 - point.u;
  const dy2 = a.v2 - point.v;
  return Math.min(dx1 * dx1 + dy1 * dy1, dx2 * dx2 + dy2 * dy2);
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
