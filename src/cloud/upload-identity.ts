import { imageRefFromStoragePath } from "./image-identity";

// Pure mapping from a browser file's `webkitRelativePath` to the cloud identity
// used by the admin uploader. The browser reports the picked-folder-relative
// path (e.g. "survey/cam02/IMG_0001.JPG"); `site` is the IMMEDIATE parent folder
// (the camera, per CONTEXT.md), and the storage key is `<site>/<filename>` — the
// IN-BUCKET key (no `photos/` prefix), matching what `SupabaseStorageBackend`
// keys signed URLs and rows on. Reuses `image-identity` so cloud listing and the
// uploader can never disagree on `{site, stem}`.
export type UploadTarget = {
  site: string;
  name: string;
  storagePath: string;
};

// Returns null for non-image files or paths with no parent folder, so callers
// can skip them. `name` is the filename as-is; `storagePath` = `<site>/<name>`.
export function uploadTargetFromRelativePath(relativePath: string): UploadTarget | null {
  const ref = imageRefFromStoragePath(relativePath);
  if (!ref) return null;
  const segments = relativePath.split("/");
  const name = segments[segments.length - 1];
  return {
    site: ref.site,
    name,
    storagePath: `${ref.site}/${name}`,
  };
}
