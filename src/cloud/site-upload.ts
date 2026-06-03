import { isImageFilename } from "./image-identity";
import type { UploadTarget } from "./upload-identity";

// Pure helpers for the explorer-style upload flow, where the admin names a site
// (folder) in the UI and then adds individual image files to it — as opposed to
// `upload-identity.ts`, which derives the site from an OS folder's relative path.

const MAX_SITE_NAME = 100;

export type SiteNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: string };

// Validates a user-typed site (folder) name. `site` becomes both a Storage path
// segment (`<site>/<name>`) and the prefix of the export filename
// (`<site>__<stem>.json`), so the rules below protect both: no slashes (would
// nest the object under an unintended folder), no `__` (the export separator),
// no leading/trailing dot, and a sane length. Returns the trimmed name on success.
export function validateSiteName(raw: string): SiteNameResult {
  const name = raw.trim();
  if (name === "") {
    return { ok: false, reason: "Enter a site name." };
  }
  if (name.length > MAX_SITE_NAME) {
    return { ok: false, reason: `Site name must be ${MAX_SITE_NAME} characters or fewer.` };
  }
  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, reason: "Site name can't contain slashes." };
  }
  if (name.includes("__")) {
    return { ok: false, reason: "Site name can't contain a double underscore (__)." };
  }
  if (name.startsWith(".") || name.endsWith(".")) {
    return { ok: false, reason: "Site name can't start or end with a dot." };
  }
  return { ok: true, name };
}

// Maps an explicit (already-validated) site + a browser file name to the cloud
// identity used by the uploader. Returns null for non-image files so callers can
// skip them. `name` is the basename (a stray sub-path is stripped defensively so
// the object can never nest under an unintended folder); `storagePath` is the
// in-bucket key `<site>/<name>` (NO `photos/` prefix), matching what
// `SupabaseStorageBackend` keys signed URLs and rows on.
export function uploadTargetForSite(
  site: string,
  fileName: string,
): UploadTarget | null {
  const segments = fileName.split("/");
  const name = segments[segments.length - 1];
  if (!isImageFilename(name)) return null;
  return {
    site,
    name,
    storagePath: `${site}/${name}`,
  };
}
