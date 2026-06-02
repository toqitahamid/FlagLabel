import type { Annotation, Transect, HorizontalSpan } from "./model";

export const SCHEMA_VERSION = 2;

export const REFERENCE_DIMENSIONS_CM = {
  flag_body_h: 6.35,
  flag_body_w: 8.89,
  wire_total: 53.34,
  wire_above_ground: 49.53,
  wire_buried: 3.81,
} as const;

export type FileMeta = {
  site: string;
  image: string;
  image_w: number;
  image_h: number;
};

type AnnotationFile = {
  schema_version: number;
  site: string;
  image: string;
  image_w: number;
  image_h: number;
  reference_dimensions_cm: typeof REFERENCE_DIMENSIONS_CM;
  created_at: string;
  app_version: string;
  wire_ground_points: Array<{
    u: number;
    v: number;
    transect: Transect;
    distance: number;
  }>;
  flag_vertical_spans: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
  flag_horizontal_spans: Array<{
    u1: number;
    v1: number;
    u2: number;
    v2: number;
    transect: Transect;
    distance: number;
  }>;
};

export function buildAnnotationFile(
  meta: FileMeta,
  annotations: Annotation[],
  appVersion: string,
  createdAt: string
): AnnotationFile {
  const wire_ground_points = annotations
    .filter((a): a is Extract<Annotation, { kind: "wire_ground" }> => a.kind === "wire_ground")
    .map((a) => ({
      u: a.u,
      v: a.v,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_vertical_spans = annotations
    .filter((a): a is Extract<Annotation, { kind: "vertical_span" }> => a.kind === "vertical_span")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  const flag_horizontal_spans = annotations
    .filter((a): a is HorizontalSpan => a.kind === "horizontal_span")
    .map((a) => ({
      u1: a.u1,
      v1: a.v1,
      u2: a.u2,
      v2: a.v2,
      transect: a.transect,
      distance: a.distance,
    }));

  return {
    schema_version: SCHEMA_VERSION,
    site: meta.site,
    image: meta.image,
    image_w: meta.image_w,
    image_h: meta.image_h,
    reference_dimensions_cm: REFERENCE_DIMENSIONS_CM,
    created_at: createdAt,
    app_version: appVersion,
    wire_ground_points,
    flag_vertical_spans,
    flag_horizontal_spans,
  };
}

function isTransect(x: unknown): x is Transect {
  return x === "L" || x === "C" || x === "R";
}

export function parseAnnotationFile(json: unknown): Annotation[] {
  if (typeof json !== "object" || json === null) return [];
  const obj = json as Record<string, unknown>;
  const result: Annotation[] = [];

  const points = obj.wire_ground_points;
  if (Array.isArray(points)) {
    for (const p of points) {
      if (typeof p !== "object" || p === null) continue;
      const rec = p as Record<string, unknown>;
      if (
        typeof rec.u !== "number" ||
        typeof rec.v !== "number" ||
        !isTransect(rec.transect) ||
        typeof rec.distance !== "number"
      )
        continue;
      result.push({
        kind: "wire_ground",
        u: rec.u,
        v: rec.v,
        transect: rec.transect,
        distance: rec.distance,
      });
    }
  }

  const spans = obj.flag_vertical_spans;
  if (Array.isArray(spans)) {
    for (const s of spans) {
      if (typeof s !== "object" || s === null) continue;
      const rec = s as Record<string, unknown>;
      if (
        typeof rec.u1 !== "number" ||
        typeof rec.v1 !== "number" ||
        typeof rec.u2 !== "number" ||
        typeof rec.v2 !== "number" ||
        !isTransect(rec.transect) ||
        typeof rec.distance !== "number"
      )
        continue;
      result.push({
        kind: "vertical_span",
        u1: rec.u1,
        v1: rec.v1,
        u2: rec.u2,
        v2: rec.v2,
        transect: rec.transect,
        distance: rec.distance,
      });
    }
  }

  const hspans = obj.flag_horizontal_spans;
  if (Array.isArray(hspans)) {
    for (const s of hspans) {
      if (typeof s !== "object" || s === null) continue;
      const rec = s as Record<string, unknown>;
      if (
        typeof rec.u1 !== "number" ||
        typeof rec.v1 !== "number" ||
        typeof rec.u2 !== "number" ||
        typeof rec.v2 !== "number" ||
        !isTransect(rec.transect) ||
        typeof rec.distance !== "number"
      )
        continue;
      result.push({
        kind: "horizontal_span",
        u1: rec.u1,
        v1: rec.v1,
        u2: rec.u2,
        v2: rec.v2,
        transect: rec.transect,
        distance: rec.distance,
      });
    }
  }

  return result;
}
