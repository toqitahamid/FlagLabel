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

// True iff the file's BASENAME is a supported image AND is not a macOS
// AppleDouble sidecar (`._IMG_0001.JPG`). The OS scatters these `._*` resource-
// fork files alongside real images on FAT/exFAT volumes; they share the image
// extension but contain no usable pixels, so they must never be uploaded. Any
// path is stripped to its last `/`-segment before both checks — a path-ish name
// like `sub/._x.jpg` is an AppleDouble too.
export function isUploadableImage(fileName: string): boolean {
  const segments = fileName.split("/");
  const base = segments[segments.length - 1];
  return isImageFilename(base) && !base.startsWith("._");
}

// Maps an explicit (already-validated) site + a browser file name to the cloud
// identity used by the uploader. Returns null for non-uploadable files (non-image
// or macOS `._*` sidecars) so callers can skip them. `name` is the basename (a
// stray sub-path is stripped defensively so the object can never nest under an
// unintended folder); `storagePath` is the in-bucket key `<site>/<name>` (NO
// `photos/` prefix), matching what `SupabaseStorageBackend` keys signed URLs and
// rows on.
export function uploadTargetForSite(
  site: string,
  fileName: string,
): UploadTarget | null {
  if (!isUploadableImage(fileName)) return null;
  const segments = fileName.split("/");
  const name = segments[segments.length - 1];
  return {
    site,
    name,
    storagePath: `${site}/${name}`,
  };
}

// Splits an image filename on its LAST dot into a stem and an extension that
// INCLUDES the dot. A name with no dot has an empty `ext`. The stem keeps any
// earlier dots (`IMG_0001.final.JPG` → stem `IMG_0001.final`). Used by the rename
// flow so the user edits only the stem while the extension is preserved verbatim.
export function splitImageName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

// Rebuilds an image filename from a new stem, preserving the ORIGINAL extension
// of `oldName` (the user only edits the stem in the UI).
export function renameImageName(oldName: string, newStem: string): string {
  return `${newStem}${splitImageName(oldName).ext}`;
}

export type StemResult =
  | { ok: true; stem: string }
  | { ok: false; reason: string };

// Validates a user-typed image stem (the extension is preserved separately, so
// there are no dot/extension rules here). Trims, rejects empty, and rejects
// slashes (which would nest the renamed object under an unintended folder).
export function validateStem(raw: string): StemResult {
  const stem = raw.trim();
  if (stem === "") {
    return { ok: false, reason: "Enter a name." };
  }
  if (stem.includes("/") || stem.includes("\\")) {
    return { ok: false, reason: "Name can't contain slashes." };
  }
  return { ok: true, stem };
}
