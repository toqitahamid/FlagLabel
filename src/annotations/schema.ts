import type { Annotation } from "./model";

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

export function buildAnnotationFile(
  meta: FileMeta,
  annotations: Annotation[],
  appVersion: string,
  createdAt: string
): object {
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

  return points.map((p) => ({
    kind: "wire_ground" as const,
    u: (p as any).u,
    v: (p as any).v,
    transect: (p as any).transect,
    distance: (p as any).distance,
  }));
}
