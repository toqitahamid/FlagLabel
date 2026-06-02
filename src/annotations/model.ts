export type Transect = "L" | "C" | "R";

export type WireGroundPoint = {
  kind: "wire_ground";
  u: number;
  v: number;
  transect: Transect;
  distance: number;
};

// The union widens with span types in later slices.
export type Annotation = WireGroundPoint;

export type Counts = { L: number; C: number; R: number };

export function countsFromAnnotations(anns: Annotation[]): Counts {
  const out: Counts = { L: 0, C: 0, R: 0 };
  for (const a of anns) {
    if (a.kind === "wire_ground") out[a.transect]++;
  }
  return out;
}
