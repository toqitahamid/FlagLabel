import type { AnnotationFile } from "../annotations/schema";

/**
 * Serializes an AnnotationFile to a string that is byte-identical to what the
 * desktop app writes to disk: `JSON.stringify(file, null, 2)`.
 *
 * The stored AnnotationFile already contains `created_at` and `app_version`
 * from when it was originally saved — those fields are preserved as-is.
 */
export function serializeAnnotationFile(file: AnnotationFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Returns the export entry filename for an AnnotationFile.
 *
 * Mirrors the desktop's `clickFilename` / `stemFromPath` logic:
 *   `${site}__${imageWithoutExtension}.json`
 *
 * e.g. site="cam02", image="IMG_0001.JPG" → "cam02__IMG_0001.json"
 */
export function exportEntryName(file: AnnotationFile): string {
  // Remove the last extension (e.g. ".JPG", ".jpeg", ".png")
  const stem = file.image.replace(/\.[^.]+$/, "");
  return `${file.site}__${stem}.json`;
}

/**
 * Builds the list of ZIP entries for a collection of AnnotationFiles.
 *
 * Returns one `{ name, content }` pair per file, in the same order as the
 * input array. The actual zipping is done by the caller.
 *
 * A file with all annotation arrays empty is still included — clearing all
 * annotations on a previously-annotated image is a legitimate save state.
 */
export function buildZipEntries(
  files: AnnotationFile[]
): Array<{ name: string; content: string }> {
  return files.map((file) => ({
    name: exportEntryName(file),
    content: serializeAnnotationFile(file),
  }));
}
