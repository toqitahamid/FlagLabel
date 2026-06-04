import {
  buildAnnotationFile,
  parseAnnotationFile,
  type AnnotationFile,
} from "../annotations/schema";

/**
 * Re-builds an AnnotationFile through the canonical `buildAnnotationFile` path
 * so its top-level field order matches exactly what the desktop app writes.
 *
 * Why this is needed: on the web, the stored blob comes back from Postgres
 * `jsonb`, which does NOT preserve insertion/desktop key order (jsonb
 * normalizes keys by length then bytewise). Feeding that raw object straight
 * into `serializeAnnotationFile` would emit keys in jsonb order — semantically
 * identical but NOT byte-identical to a desktop file for the same image.
 *
 * Round-tripping through `parseAnnotationFile` + `buildAnnotationFile` rebuilds
 * the object with the canonical field order while preserving the original
 * `created_at` and `app_version` from when it was first saved. The parse→build
 * round-trip is content-stable (proven by export.test.ts).
 */
export function canonicalizeAnnotationFile(file: AnnotationFile): AnnotationFile {
  return buildAnnotationFile(
    {
      site: file.site,
      image: file.image,
      image_w: file.image_w,
      image_h: file.image_h,
    },
    parseAnnotationFile(file),
    file.app_version,
    file.created_at,
  );
}

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

/** The image filename without its extension, e.g. "IMG_0001.JPG" → "IMG_0001". */
export function imageStem(file: AnnotationFile): string {
  return file.image.replace(/\.[^.]+$/, "");
}

/**
 * Filename for a SINGLE-image JSON download: just the original image name with a
 * `.json` extension — no `site__` prefix. The site is already implied by the
 * folder the user is downloading from.
 *
 * e.g. site="sample", image="IMG_0001.JPG" → "IMG_0001.json"
 */
export function exportEntryName(file: AnnotationFile): string {
  return `${imageStem(file)}.json`;
}

/**
 * Path for a file inside the dataset ZIP: nested under its site folder so the
 * archive mirrors the dataset's folder structure (one folder per site/camera).
 *
 * e.g. site="sample", image="IMG_0001.JPG" → "sample/IMG_0001.json"
 */
export function zipEntryPath(file: AnnotationFile): string {
  return `${file.site}/${imageStem(file)}.json`;
}

/**
 * Builds the list of ZIP entries for a collection of AnnotationFiles.
 *
 * Returns one `{ name, content }` pair per file, in the same order as the
 * input array. Each `name` is a `site/stem.json` path so the archive unzips into
 * one folder per site/camera. The actual zipping is done by the caller.
 *
 * A file with all annotation arrays empty is still included — clearing all
 * annotations on a previously-annotated image is a legitimate save state.
 *
 * Each file is canonicalized first (see `canonicalizeAnnotationFile`) so the
 * content is byte-identical to the desktop app even when the input came from
 * Postgres `jsonb` (which does not preserve desktop key order).
 */
export function buildZipEntries(
  files: AnnotationFile[]
): Array<{ name: string; content: string }> {
  return files.map((file) => {
    const canonical = canonicalizeAnnotationFile(file);
    return {
      name: zipEntryPath(canonical),
      content: serializeAnnotationFile(canonical),
    };
  });
}
