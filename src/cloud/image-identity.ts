const IMAGE_EXTS = new Set(["jpg", "jpeg", "png"]);

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
