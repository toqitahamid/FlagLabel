export const IMAGE_EXTS = new Set(["jpg", "jpeg", "png"]);

// True when `filename` ends in a supported image extension (case-insensitive).
// Shared by the cloud uploader so listing and ingest agree on "is this an image".
export function isImageFilename(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTS.has(filename.slice(dot + 1).toLowerCase());
}

export function imageRefFromStoragePath(
  path: string
): { site: string; stem: string; ext: string } | null {
  const segments = path.split("/");
  const filename = segments[segments.length - 1];
  const parent = segments.length >= 2 ? segments[segments.length - 2] : "";

  if (!filename || !parent) return null;

  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const ext = filename.slice(dotIndex + 1);
  const stem = filename.slice(0, dotIndex);

  if (!IMAGE_EXTS.has(ext.toLowerCase())) return null;

  return { site: parent, stem, ext };
}

export function annotationFilename(ref: { site: string; stem: string }): string {
  return `${ref.site}__${ref.stem}.json`;
}
