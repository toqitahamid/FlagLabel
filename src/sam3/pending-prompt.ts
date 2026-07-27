import type { Point } from "../annotations/model";
import type { PointPrompt } from "./client";

// The in-progress segmentation prompt: which flag_box is being segmented, plus
// the refinement clicks accumulated so far. Transient UI state — it is NEVER
// persisted; only the accepted mask becomes an annotation.
//
// Deliberately NOT folded into the pending-span reducer. That one is a
// fixed-arity two-click CREATION machine (first click, second click, done);
// prompt clicks are unbounded, carry a polarity, and REFINE an annotation that
// already exists. Same shape of problem, different state machine.

// One refinement click in image pixels. `label` 1 = positive (this is the flag),
// 0 = negative (this is not).
export type PromptClick = { u: number; v: number; label: 0 | 1 };

export type PendingPrompt =
  | { kind: "idle" }
  | { kind: "active"; targetIdx: number; clicks: PromptClick[] };

export type PendingPromptEvent =
  | { type: "start"; targetIdx: number }
  | { type: "addClick"; point: Point; label: 0 | 1 }
  | { type: "undoClick" }
  | { type: "cancel" };

export const PROMPT_IDLE: PendingPrompt = { kind: "idle" };

// Pure reducer. Every event except `start` is a no-op while idle, so a stray
// keystroke or canvas click outside a session can't conjure one.
export function pendingPromptReducer(
  state: PendingPrompt,
  event: PendingPromptEvent
): PendingPrompt {
  switch (event.type) {
    case "start":
      // Starting always resets the click list: a new session on the same box is
      // a fresh box-only prompt, not a continuation of the old refinement.
      return { kind: "active", targetIdx: event.targetIdx, clicks: [] };
    case "addClick":
      if (state.kind !== "active") return state;
      return {
        ...state,
        clicks: [
          ...state.clicks,
          { u: event.point.u, v: event.point.v, label: event.label },
        ],
      };
    case "undoClick":
      if (state.kind !== "active" || state.clicks.length === 0) return state;
      return { ...state, clicks: state.clicks.slice(0, -1) };
    case "cancel":
      return PROMPT_IDLE;
    default: {
      // Compile-time exhaustiveness guard: tsconfig lacks noImplicitReturns, so
      // without this a newly-added event would silently return undefined and
      // wipe the session.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// The clicks in the wire format /segment wants: [x, y, label] in image pixels.
// Order is preserved — the model treats the click sequence as ordered evidence,
// and the full list is resent on every request.
export function promptPoints(state: PendingPrompt): PointPrompt[] {
  if (state.kind !== "active") return [];
  return state.clicks.map((c) => [c.u, c.v, c.label] as PointPrompt);
}
