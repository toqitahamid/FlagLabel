import { describe, it, expect } from "vitest";
import {
  pendingPolygonReducer,
  canClose,
  polygonRings,
  POLYGON_IDLE,
  POLYGON_MIN_VERTICES,
  type PendingPolygon,
} from "./pending-polygon";

const ACTIVE: PendingPolygon = {
  kind: "active",
  transect: "C",
  distance: 5,
  vertices: [],
};

function withVertices(n: number): PendingPolygon {
  let state: PendingPolygon = ACTIVE;
  for (let i = 0; i < n; i++) {
    state = pendingPolygonReducer(state, { type: "addVertex", point: { u: i, v: i * 2 } });
  }
  return state;
}

describe("pendingPolygonReducer", () => {
  it("start moves idle → active with no vertices", () => {
    expect(
      pendingPolygonReducer(POLYGON_IDLE, { type: "start", transect: "L", distance: 3 })
    ).toEqual({ kind: "active", transect: "L", distance: 3, vertices: [] });
  });

  it("start captures the transect and distance handed to it, not a later one", () => {
    // The rail selection may change while a long outline is drawn; the captured
    // pair is what the committed mask must carry.
    const started = pendingPolygonReducer(POLYGON_IDLE, {
      type: "start",
      transect: "R",
      distance: 12.5,
    });
    const later = pendingPolygonReducer(started, {
      type: "addVertex",
      point: { u: 1, v: 1 },
    });
    expect(later).toMatchObject({ transect: "R", distance: 12.5 });
  });

  it("start resets the vertex list (a restart is a fresh outline)", () => {
    expect(
      pendingPolygonReducer(withVertices(4), { type: "start", transect: "C", distance: 5 })
    ).toEqual({ kind: "active", transect: "C", distance: 5, vertices: [] });
  });

  it("addVertex appends in click order", () => {
    const a = pendingPolygonReducer(ACTIVE, { type: "addVertex", point: { u: 10, v: 20 } });
    const b = pendingPolygonReducer(a, { type: "addVertex", point: { u: 30, v: 40 } });
    expect(b).toEqual({
      kind: "active",
      transect: "C",
      distance: 5,
      vertices: [
        { u: 10, v: 20 },
        { u: 30, v: 40 },
      ],
    });
  });

  it("addVertex is unbounded — unlike the fixed-arity two-click span reducer", () => {
    const state = withVertices(25);
    expect(state.kind === "active" && state.vertices).toHaveLength(25);
  });

  it("undoVertex drops only the last vertex", () => {
    const state = pendingPolygonReducer(withVertices(3), { type: "undoVertex" });
    expect(state).toEqual({
      kind: "active",
      transect: "C",
      distance: 5,
      vertices: [
        { u: 0, v: 0 },
        { u: 1, v: 2 },
      ],
    });
  });

  it("undoVertex on the LAST remaining vertex returns to idle", () => {
    expect(pendingPolygonReducer(withVertices(1), { type: "undoVertex" })).toEqual(
      POLYGON_IDLE
    );
  });

  it("undoVertex on an active polygon with no vertices returns to idle", () => {
    expect(pendingPolygonReducer(ACTIVE, { type: "undoVertex" })).toEqual(POLYGON_IDLE);
  });

  it("cancel returns to idle from active, and is idempotent on idle", () => {
    expect(pendingPolygonReducer(withVertices(6), { type: "cancel" })).toEqual(
      POLYGON_IDLE
    );
    expect(pendingPolygonReducer(POLYGON_IDLE, { type: "cancel" })).toEqual(POLYGON_IDLE);
  });

  it("addVertex and undoVertex are no-ops while idle (a stray click can't start one)", () => {
    expect(
      pendingPolygonReducer(POLYGON_IDLE, { type: "addVertex", point: { u: 1, v: 2 } })
    ).toBe(POLYGON_IDLE);
    expect(pendingPolygonReducer(POLYGON_IDLE, { type: "undoVertex" })).toBe(POLYGON_IDLE);
  });

  it("does not mutate the input state or the incoming point", () => {
    const before = withVertices(2);
    const point = { u: 9, v: 9 };
    pendingPolygonReducer(before, { type: "addVertex", point });
    expect(before.kind === "active" && before.vertices).toHaveLength(2);
    expect(point).toEqual({ u: 9, v: 9 });
  });
});

describe("canClose", () => {
  it("is false while idle", () => {
    expect(canClose(POLYGON_IDLE)).toBe(false);
  });

  it("is false below the three-vertex threshold", () => {
    expect(canClose(withVertices(0))).toBe(false);
    expect(canClose(withVertices(1))).toBe(false);
    expect(canClose(withVertices(2))).toBe(false);
  });

  it("is true at exactly the threshold and above", () => {
    expect(POLYGON_MIN_VERTICES).toBe(3);
    expect(canClose(withVertices(3))).toBe(true);
    expect(canClose(withVertices(40))).toBe(true);
  });
});

describe("polygonRings", () => {
  it("maps the vertices to ONE ring of [u, v] pairs, in order", () => {
    expect(polygonRings(withVertices(3))).toEqual([
      [
        [0, 0],
        [1, 2],
        [2, 4],
      ],
    ]);
  });

  it("is [] while idle and for an active polygon with no vertices", () => {
    expect(polygonRings(POLYGON_IDLE)).toEqual([]);
    expect(polygonRings(ACTIVE)).toEqual([]);
  });
});
