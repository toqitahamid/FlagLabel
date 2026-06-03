import type { AnnotationFile } from "../annotations/schema";
import { getSupabaseClient } from "./supabase-client";
import type { ImageItem, StorageBackend } from "./storage-backend";

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

export class SupabaseStorageBackend implements StorageBackend {
  // Parity no-ops with TauriStorageBackend so App.tsx's existing
  // `backendRef.current.setFolder(...)` / `setClicksDir(...)` call sites
  // typecheck and run harmlessly under the union type. The cloud backend has no
  // local folder or clicks dir — the dataset lives in Supabase.
  setFolder(_folder: string | null): void {}
  setClicksDir(_clicksDir: string | null): void {}

  // Deferred to #14 (the shared-dataset gallery). Empty list keeps the web shell
  // a clean placeholder for now without breaking the sync image path in App.tsx.
  async listImages(): Promise<ImageItem[]> {
    return [];
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
