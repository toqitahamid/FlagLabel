import type { Point, SpanType, Transect } from "./model";

// Global pending-span state. A span is placed with two sequential clicks; the
// first click moves us to `awaitingSecond`, the second completes it (the caller
// reads `first` + the new point, canonicalizes, and pushes the annotation).
export type PendingSpan =
  | { kind: "idle" }
  | {
      kind: "awaitingSecond";
      type: SpanType;
      first: Point;
      transect: Transect;
      distance: number;
    };

export type PendingSpanEvent =
  | {
      type: "firstClick";
      point: Point;
      spanType: SpanType;
      transect: Transect;
      distance: number;
    }
  | { type: "secondClick"; point: Point }
  | { type: "cancel" };

export const IDLE: PendingSpan = { kind: "idle" };

// Pure reducer. `secondClick` returns to idle; the caller is responsible for
// reading the previous `first` (before dispatching) and committing the
// completed, canonicalized span. `cancel` is idempotent on idle.
export function pendingSpanReducer(
  _state: PendingSpan,
  event: PendingSpanEvent
): PendingSpan {
  switch (event.type) {
    case "firstClick":
      return {
        kind: "awaitingSecond",
        type: event.spanType,
        first: event.point,
        transect: event.transect,
        distance: event.distance,
      };
    case "secondClick":
      // Completing only makes sense while awaiting; otherwise no-op.
      return IDLE;
    case "cancel":
      return IDLE;
  }
}
