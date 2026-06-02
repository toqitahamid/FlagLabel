import type { Annotation, Transect } from "./model";

// The identity that defines a duplicate. Two annotations collide when they share
// the same transect, the same distance, AND the same kind — so a wire-ground
// point and a vertical span at the same {transect, distance} do NOT collide
// (they legitimately coexist on one flag). Distance equality is an exact numeric
// match: 3 and 3.5 are distinct.
export type CollisionKey = {
  transect: Transect;
  distance: number;
  kind: Annotation["kind"];
};

// Return the index of the first existing annotation that collides with `key`,
// or null if none do. Coordinates are intentionally ignored — collision is about
// {transect, distance, kind}, not location.
export function findCollision(
  annotations: Annotation[],
  key: CollisionKey
): number | null {
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    if (
      a.kind === key.kind &&
      a.transect === key.transect &&
      a.distance === key.distance
    ) {
      return i;
    }
  }
  return null;
}
