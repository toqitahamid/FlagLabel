import { describe, it, expect } from "vitest";
import {
  pendingPromptReducer,
  promptPoints,
  PROMPT_IDLE,
  type PendingPrompt,
} from "./pending-prompt";

const ACTIVE: PendingPrompt = { kind: "active", targetIdx: 2, clicks: [] };

describe("pendingPromptReducer", () => {
  it("start moves idle → active on the given targetIdx with no clicks", () => {
    expect(pendingPromptReducer(PROMPT_IDLE, { type: "start", targetIdx: 4 })).toEqual({
      kind: "active",
      targetIdx: 4,
      clicks: [],
    });
  });

  it("start resets the click list (a restart is a fresh box-only prompt)", () => {
    const withClicks: PendingPrompt = {
      kind: "active",
      targetIdx: 2,
      clicks: [{ u: 1, v: 2, label: 1 }],
    };
    expect(pendingPromptReducer(withClicks, { type: "start", targetIdx: 2 })).toEqual({
      kind: "active",
      targetIdx: 2,
      clicks: [],
    });
  });

  it("addClick appends, preserving order and polarity", () => {
    const a = pendingPromptReducer(ACTIVE, {
      type: "addClick",
      point: { u: 10, v: 20 },
      label: 1,
    });
    const b = pendingPromptReducer(a, {
      type: "addClick",
      point: { u: 30, v: 40 },
      label: 0,
    });
    expect(b).toEqual({
      kind: "active",
      targetIdx: 2,
      clicks: [
        { u: 10, v: 20, label: 1 },
        { u: 30, v: 40, label: 0 },
      ],
    });
  });

  it("addClick is unbounded — unlike the fixed-arity two-click span reducer", () => {
    let state: PendingPrompt = ACTIVE;
    for (let i = 0; i < 7; i++) {
      state = pendingPromptReducer(state, {
        type: "addClick",
        point: { u: i, v: i },
        label: i % 2 === 0 ? 1 : 0,
      });
    }
    expect(state.kind === "active" && state.clicks).toHaveLength(7);
  });

  it("undoClick drops only the last click", () => {
    const two: PendingPrompt = {
      kind: "active",
      targetIdx: 2,
      clicks: [
        { u: 1, v: 1, label: 1 },
        { u: 2, v: 2, label: 0 },
      ],
    };
    expect(pendingPromptReducer(two, { type: "undoClick" })).toEqual({
      kind: "active",
      targetIdx: 2,
      clicks: [{ u: 1, v: 1, label: 1 }],
    });
  });

  it("undoClick on an empty click list is a no-op (same object)", () => {
    expect(pendingPromptReducer(ACTIVE, { type: "undoClick" })).toBe(ACTIVE);
  });

  it("cancel returns to idle from active, and is idempotent on idle", () => {
    expect(pendingPromptReducer(ACTIVE, { type: "cancel" })).toEqual(PROMPT_IDLE);
    expect(pendingPromptReducer(PROMPT_IDLE, { type: "cancel" })).toEqual(PROMPT_IDLE);
  });

  it("addClick and undoClick are no-ops while idle (a stray click can't start a session)", () => {
    expect(
      pendingPromptReducer(PROMPT_IDLE, {
        type: "addClick",
        point: { u: 1, v: 2 },
        label: 1,
      })
    ).toBe(PROMPT_IDLE);
    expect(pendingPromptReducer(PROMPT_IDLE, { type: "undoClick" })).toBe(PROMPT_IDLE);
  });

  it("does not mutate the input state", () => {
    const before: PendingPrompt = {
      kind: "active",
      targetIdx: 1,
      clicks: [{ u: 5, v: 5, label: 1 }],
    };
    pendingPromptReducer(before, { type: "addClick", point: { u: 9, v: 9 }, label: 0 });
    expect(before.kind === "active" && before.clicks).toHaveLength(1);
  });
});

describe("promptPoints", () => {
  it("maps clicks to the wire [x, y, label] triples, in order", () => {
    const state: PendingPrompt = {
      kind: "active",
      targetIdx: 0,
      clicks: [
        { u: 10.5, v: 20.5, label: 1 },
        { u: 30, v: 40, label: 0 },
      ],
    };
    expect(promptPoints(state)).toEqual([
      [10.5, 20.5, 1],
      [30, 40, 0],
    ]);
  });

  it("is [] while idle", () => {
    expect(promptPoints(PROMPT_IDLE)).toEqual([]);
  });
});
