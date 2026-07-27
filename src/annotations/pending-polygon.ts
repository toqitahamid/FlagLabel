import type { MaskRing, Point, Transect } from "./model";

// The in-progress hand-drawn polygon: the manual fallback for flags SAM3 cannot
// segment (small/far ones). The labeler places vertices one click at a time and
// closes the outline with Enter; the result commits as a `flag_mask` with a single
// ring — the same annotation kind an accepted SAM3 candidate produces.
//
// Deliberately NOT folded into the pending-span reducer: that one is a fixed-arity
// two-click machine (first click, second click, done). A polygon is an UNBOUNDED
// click sequence, so this is shaped after sam3/pending-prompt instead — same
// accumulate/undo/cancel structure, different payload.
//
// `transect` and `distance` are captured at `start` (the first click) and never
// re-read, exactly like pending-span does: the rail selection may change while a
// long outline is being drawn, and the outline belongs to the flag it was started
// on. Transient state — only the closed polygon becomes an annotation.
export type PendingPolygon =
  | { kind: "idle" }
  | {
      kind: "active";
      transect: Transect;
      distance: number;
      vertices: Point[];
    };

export type PendingPolygonEvent =
  | { type: "start"; transect: Transect; distance: number }
  | { type: "addVertex"; point: Point }
  | { type: "undoVertex" }
  | { type: "cancel" };

export const POLYGON_IDLE: PendingPolygon = { kind: "idle" };

// Minimum vertices for a closeable outline: fewer than three cannot enclose an
// area, so the ring would serialize as a mask with no interior.
export const POLYGON_MIN_VERTICES = 3;

// Pure reducer. Every event except `start` is a no-op while idle, so a stray
// keystroke or canvas click outside a session can't conjure one. Never mutates
// the input state or the incoming point.
export function pendingPolygonReducer(
  state: PendingPolygon,
  event: PendingPolygonEvent
): PendingPolygon {
  switch (event.type) {
    case "start":
      // Starting always resets the vertex list: a new outline on the same flag is
      // a fresh polygon, not a continuation of an abandoned one.
      return {
        kind: "active",
        transect: event.transect,
        distance: event.distance,
        vertices: [],
      };
    case "addVertex":
      if (state.kind !== "active") return state;
      return {
        ...state,
        vertices: [...state.vertices, { u: event.point.u, v: event.point.v }],
      };
    case "undoVertex":
      if (state.kind !== "active") return state;
      // Undoing the LAST vertex ends the session rather than leaving an empty
      // active polygon: with nothing placed there is no outline to draw and no
      // captured transect/distance worth keeping, and the next click would
      // re-capture them anyway.
      if (state.vertices.length <= 1) return POLYGON_IDLE;
      return { ...state, vertices: state.vertices.slice(0, -1) };
    case "cancel":
      return POLYGON_IDLE;
    default: {
      // Compile-time exhaustiveness guard: tsconfig lacks noImplicitReturns, so
      // without this a newly-added event would silently return undefined and wipe
      // the session.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Whether Enter may close this outline into a mask.
export function canClose(state: PendingPolygon): boolean {
  return state.kind === "active" && state.vertices.length >= POLYGON_MIN_VERTICES;
}

// The vertices in the `rings` shape a FlagMask stores: one closed ring of
// [u, v] pairs. The mirror of promptPoints() in sam3/pending-prompt — the wire
// format lives next to the reducer so App.tsx never hand-rolls the conversion.
// Returns [] while idle so a caller can't build a ring-less mask.
export function polygonRings(state: PendingPolygon): MaskRing[] {
  if (state.kind !== "active" || state.vertices.length === 0) return [];
  return [state.vertices.map((p) => [p.u, p.v] as [number, number])];
}
