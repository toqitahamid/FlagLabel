import type { Annotation, Transect } from "./model";

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
};

export function buildAnnotationFile(
  meta: FileMeta,
  annotations: Annotation[],
  appVersion: string,
  createdAt: string
): AnnotationFile {
  const wire_ground_points = annotations
    .filter((a) => a.kind === "wire_ground")
    .map((a) => ({
      u: a.u,
      v: a.v,
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
  };
}

export function parseAnnotationFile(json: unknown): Annotation[] {
  if (typeof json !== "object" || json === null) return [];
  const points = (json as Record<string, unknown>).wire_ground_points;
  if (!Array.isArray(points)) return [];

  const result: Annotation[] = [];
  for (const p of points) {
    if (typeof p !== "object" || p === null) continue;
    const rec = p as Record<string, unknown>;
    if (
      typeof rec.u !== "number" ||
      typeof rec.v !== "number" ||
      (rec.transect !== "L" && rec.transect !== "C" && rec.transect !== "R") ||
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
  return result;
}
