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
