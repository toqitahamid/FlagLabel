import { parseAnnotationFile, type AnnotationFile } from "../annotations/schema";

export type Summary = {
  labeler: string;
  status: "empty" | "annotated";
  annotation_count: number;
};

export function deriveSummary(file: AnnotationFile | null, labeler: string): Summary {
  if (file === null) {
    return { labeler, status: "empty", annotation_count: 0 };
  }
  const annotations = parseAnnotationFile(file);
  const annotation_count = annotations.length;
  const status = annotation_count === 0 ? "empty" : "annotated";
  return { labeler, status, annotation_count };
}

// One image's progress as surfaced to the team-progress gallery (#16). Read
// straight from the `annotations` table summary columns — never by parsing
// blobs. `annotated` is the single definition of "done": annotation_count > 0
// (equivalently status === "annotated").
export type ImageProgress = {
  site: string;
  status: "empty" | "annotated";
  annotation_count: number;
};

// A site's tally and the dataset-wide total, for the per-site header
// ("cam02 — 8/12") and the folder-header overall ("X / Y annotated").
export type ProgressSummary = {
  perSite: Record<string, { annotated: number; total: number }>;
  overall: { annotated: number; total: number };
};

// True when an image counts as annotated for progress purposes. Derived from
// the summary columns only (no blob parsing): an image with any annotation.
export function isAnnotated(p: { annotation_count: number }): boolean {
  return p.annotation_count > 0;
}

// Roll per-image progress rows up into per-site and overall annotated/total
// tallies. Pure over the summary columns; the gallery feeds it the table rows.
export function summarizeProgress(rows: ImageProgress[]): ProgressSummary {
  const perSite: Record<string, { annotated: number; total: number }> = {};
  let overallAnnotated = 0;
  for (const row of rows) {
    const bucket = perSite[row.site] ?? { annotated: 0, total: 0 };
    bucket.total += 1;
    if (isAnnotated(row)) {
      bucket.annotated += 1;
      overallAnnotated += 1;
    }
    perSite[row.site] = bucket;
  }
  return {
    perSite,
    overall: { annotated: overallAnnotated, total: rows.length },
  };
}
