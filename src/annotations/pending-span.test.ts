import { describe, it, expect } from "vitest";
import { pendingSpanReducer, IDLE, type PendingSpan } from "./pending-span";

describe("pendingSpanReducer", () => {
  it("firstClick moves idle → awaitingSecond carrying type/point/transect/distance", () => {
    const next = pendingSpanReducer(IDLE, {
      type: "firstClick",
      point: { u: 10, v: 20 },
      spanType: "vertical",
      transect: "C",
      distance: 3,
    });
    expect(next).toEqual({
      kind: "awaitingSecond",
      type: "vertical",
      first: { u: 10, v: 20 },
      transect: "C",
      distance: 3,
    });
  });

  it("secondClick returns to idle (caller commits the completed span)", () => {
    const awaiting: PendingSpan = {
      kind: "awaitingSecond",
      type: "vertical",
      first: { u: 10, v: 20 },
      transect: "C",
      distance: 3,
    };
    expect(pendingSpanReducer(awaiting, { type: "secondClick", point: { u: 11, v: 80 } })).toEqual(
      IDLE
    );
  });

  it("cancel returns to idle from awaitingSecond", () => {
    const awaiting: PendingSpan = {
      kind: "awaitingSecond",
      type: "vertical",
      first: { u: 1, v: 2 },
      transect: "L",
      distance: 1,
    };
    expect(pendingSpanReducer(awaiting, { type: "cancel" })).toEqual(IDLE);
  });

  it("cancel is idempotent on idle", () => {
    expect(pendingSpanReducer(IDLE, { type: "cancel" })).toEqual(IDLE);
  });
});

describe("pendingSpanReducer — box placement", () => {
  it("carries the \"box\" placement type through firstClick (same reducer as spans)", () => {
    const next = pendingSpanReducer(IDLE, {
      type: "firstClick",
      point: { u: 90, v: 140 },
      spanType: "box",
      transect: "R",
      distance: 6,
    });
    expect(next).toEqual({
      kind: "awaitingSecond",
      type: "box",
      first: { u: 90, v: 140 },
      transect: "R",
      distance: 6,
    });
  });

  it("secondClick and cancel return a pending box to idle", () => {
    const awaiting: PendingSpan = {
      kind: "awaitingSecond",
      type: "box",
      first: { u: 90, v: 140 },
      transect: "R",
      distance: 6,
    };
    expect(
      pendingSpanReducer(awaiting, { type: "secondClick", point: { u: 10, v: 20 } })
    ).toEqual(IDLE);
    expect(pendingSpanReducer(awaiting, { type: "cancel" })).toEqual(IDLE);
  });
});
