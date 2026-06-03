import type { AnnotationFile } from "../annotations/schema";
import { getSupabaseClient } from "./supabase-client";
import type { ImageItem, StorageBackend } from "./storage-backend";
import { uploadTargetFromRelativePath } from "./upload-identity";

// Web (cloud) backend: persists to the Supabase `annotations` table and resolves
// image URLs from the `photos` Storage bucket. The whole `src/annotations/` core
// (schema build/parse) stays shared above this seam, exactly like the Tauri path.
//
// Scope for THIS slice (#12 — auth + app shell behind login):
//   - `listImages()` returns [] — the shared-dataset gallery is #14. The web
//     shell therefore shows an empty/"loads from cloud" placeholder and never
//     drives `loadImage`, which keeps App.tsx's image path synchronous and
//     untouched (the desktop sync `resolveImageUrl` contract is preserved).
//   - `resolveImageUrl` / `readAnnotationFile` / `writeAnnotationFile` are wired
//     against Storage + the `annotations` table so the seam is real, even though
//     they aren't exercised until the gallery (#14) feeds in real ImageItems.
//
// Storage bucket layout (per ADR-0003): `photos/<site>/<name>`, with `site` =
// camera folder. The item `id` is treated as that storage key.
const PHOTOS_BUCKET = "photos";

// The `annotations` table holds the schema-v2 object verbatim in a `data jsonb`
// column, keyed by `(site, image_name)` (see ADR-0003 / issue #12).
type AnnotationRow = {
  site: string;
  image_name: string;
  data: AnnotationFile;
};

// Result of uploading one camera folder: how many files succeeded vs. were
// skipped (non-image) or errored, so the upload screen can show a final count.
export type UploadResult = {
  uploaded: number;
  skipped: number;
  failed: { name: string; error: string }[];
};

// Whether the signed-in user is an admin, per the server-side `is_admin()`
// helper. RLS is the real gate (insert/upload are admin-only server-side); this
// only decides whether the UI offers the admin-only upload affordance.
export async function fetchIsAdmin(): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false;
  return data === true;
}

export class SupabaseStorageBackend implements StorageBackend {
  // Parity no-ops with TauriStorageBackend so App.tsx's existing
  // `backendRef.current.setFolder(...)` / `setClicksDir(...)` call sites
  // typecheck and run harmlessly under the union type. The cloud backend has no
  // local folder or clicks dir — the dataset lives in Supabase.
  setFolder(_folder: string | null): void {}
  setClicksDir(_clicksDir: string | null): void {}

  // The shared-dataset gallery (#14): the `annotations` table holds one row per
  // known image (seeded by the admin uploader). Reading rows is allowed for all
  // authenticated users by RLS. The item `id` IS the in-bucket storage key (no
  // `photos/` prefix) so `resolveImageUrl`'s `.from("photos").createSignedUrl(id)`
  // resolves correctly. Sorted by site then name for a stable, grouped gallery.
  async listImages(): Promise<ImageItem[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("annotations")
      .select("site, image_name, storage_path")
      .order("site", { ascending: true })
      .order("image_name", { ascending: true });
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.listImages failed: ${error.message}`,
      );
    }
    return (data ?? []).map((row) => ({
      id: row.storage_path,
      site: row.site,
      name: row.image_name,
    }));
  }

  // Admin-only ingest (#14): upload one camera folder's image files to Storage
  // under `<site>/<name>` and seed/refresh a row per file. `site` is derived from
  // each file's `webkitRelativePath` (the immediate parent folder = the camera).
  // RLS enforces admin-only on both the Storage upload and the row INSERT; a
  // non-admin's calls fail server-side. The row upsert sends ONLY identity
  // columns (site, image_name, storage_path) so re-uploading an image never
  // clobbers its existing `data` jsonb. `onProgress` reports files completed.
  async uploadFolder(
    files: { file: File; relativePath: string }[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadResult> {
    const supabase = getSupabaseClient();
    const result: UploadResult = { uploaded: 0, skipped: 0, failed: [] };
    let done = 0;
    for (const { file, relativePath } of files) {
      const target = uploadTargetFromRelativePath(relativePath);
      if (!target) {
        result.skipped += 1;
        onProgress?.(++done, files.length);
        continue;
      }
      try {
        const up = await supabase.storage
          .from(PHOTOS_BUCKET)
          .upload(target.storagePath, file, { upsert: true });
        if (up.error) throw up.error;
        const { error: rowError } = await supabase.from("annotations").upsert(
          {
            site: target.site,
            image_name: target.name,
            storage_path: target.storagePath,
          },
          { onConflict: "site,image_name" },
        );
        if (rowError) throw rowError;
        result.uploaded += 1;
      } catch (e) {
        result.failed.push({
          name: target.storagePath,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      onProgress?.(++done, files.length);
    }
    return result;
  }

  // A signed URL the <img>/canvas can load. Async by interface contract (cloud
  // signed URLs are inherently async); only reached once #14 supplies images.
  async resolveImageUrl(item: ImageItem): Promise<string> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrl(item.id, 60 * 60);
    if (error || !data) {
      throw new Error(
        `SupabaseStorageBackend.resolveImageUrl failed for "${item.id}": ${
          error?.message ?? "no URL returned"
        }`,
      );
    }
    return data.signedUrl;
  }

  // Reads the schema-v2 blob for this image, or null if no row exists yet.
  async readAnnotationFile(item: ImageItem): Promise<AnnotationFile | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("annotations")
      .select("data")
      .eq("site", item.site)
      .eq("image_name", item.name)
      .maybeSingle<{ data: AnnotationFile }>();
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.readAnnotationFile failed for "${item.site}/${item.name}": ${error.message}`,
      );
    }
    return data?.data ?? null;
  }

  // Upserts the schema-v2 blob (last write wins, per ADR-0003). The DB derives
  // the summary columns (labeler/status/annotation_count/updated_at) via the
  // server-side trigger/policy; the client only owns the blob.
  async writeAnnotationFile(item: ImageItem, file: AnnotationFile): Promise<void> {
    const supabase = getSupabaseClient();
    const row: AnnotationRow = {
      site: item.site,
      image_name: item.name,
      data: file,
    };
    const { error } = await supabase
      .from("annotations")
      .upsert(row, { onConflict: "site,image_name" });
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.writeAnnotationFile failed for "${item.site}/${item.name}": ${error.message}`,
      );
    }
  }
}
