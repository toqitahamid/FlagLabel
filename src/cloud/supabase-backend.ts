import type { AnnotationFile } from "../annotations/schema";
import { getSupabaseClient } from "./supabase-client";
import type { ImageItem, StorageBackend } from "./storage-backend";
import { uploadTargetFromRelativePath } from "./upload-identity";
import { uploadTargetForSite } from "./site-upload";
import { deriveSummary } from "./summary";

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

  // Team-progress read (#16): like `listImages`, but also pulls the per-row
  // summary columns (`status`, `annotation_count`) maintained on save (#15) so
  // the web gallery can show annotated-vs-not and per-site/overall completion
  // WITHOUT any per-annotation querying. Same identity/order contract as
  // `listImages` (`id` IS the storage key; sorted site then name). Web-only —
  // not on the shared `StorageBackend` interface, which the desktop backend also
  // implements (desktop has no shared dataset / summary columns).
  async listImagesWithProgress(): Promise<
    (ImageItem & { status: "empty" | "annotated"; annotation_count: number })[]
  > {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("annotations")
      .select("site, image_name, storage_path, status, annotation_count")
      .order("site", { ascending: true })
      .order("image_name", { ascending: true });
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.listImagesWithProgress failed: ${error.message}`,
      );
    }
    return (data ?? []).map((row) => ({
      id: row.storage_path,
      site: row.site,
      name: row.image_name,
      status: row.status === "annotated" ? "annotated" : "empty",
      annotation_count:
        typeof row.annotation_count === "number" ? row.annotation_count : 0,
    }));
  }

  // Bulk export (#18): fetch every saved annotation blob for a ZIP download.
  // Selects only rows whose `data` is non-null (images never saved are simply
  // absent — correct). Returns the raw schema-v2 `data` objects (they ARE
  // AnnotationFiles); the export builder canonicalizes them for byte-identical
  // output. SELECT is open to all authenticated users by RLS. Web-only — not on
  // the shared `StorageBackend` interface (the desktop backend has no shared
  // dataset), exactly like `listImagesWithProgress`.
  async listAnnotationFiles(): Promise<AnnotationFile[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("annotations")
      .select("site, image_name, data")
      .not("data", "is", null)
      .order("site", { ascending: true })
      .order("image_name", { ascending: true });
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.listAnnotationFiles failed: ${error.message}`,
      );
    }
    return (data ?? []).map((row) => row.data as AnnotationFile);
  }

  // Dataset export (images + JSON): like `listAnnotationFiles`, but also returns
  // the `storage_path` so the caller can fetch the image bytes and pair each
  // image with its label in the ZIP. Annotated-only (`data` non-null) — an
  // unlabeled image has no JSON to pair with. SELECT is open to all
  // authenticated users by RLS. Web-only, same as `listAnnotationFiles`.
  async listAnnotatedImageEntries(): Promise<
    { site: string; name: string; storagePath: string; data: AnnotationFile }[]
  > {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("annotations")
      .select("site, image_name, storage_path, data")
      .not("data", "is", null)
      .order("site", { ascending: true })
      .order("image_name", { ascending: true });
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.listAnnotatedImageEntries failed: ${error.message}`,
      );
    }
    return (data ?? []).map((row) => ({
      site: row.site,
      name: row.image_name,
      storagePath: row.storage_path,
      data: row.data as AnnotationFile,
    }));
  }

  // Downloads one image's raw bytes from Storage as a Blob (for the dataset ZIP).
  // `storagePath` is the in-bucket key (`<site>/<name>`), same value stored as an
  // ImageItem `id`. RLS allows authenticated reads of the photos bucket.
  async downloadImageBlob(storagePath: string): Promise<Blob> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .download(storagePath);
    if (error || !data) {
      throw new Error(
        `SupabaseStorageBackend.downloadImageBlob failed for "${storagePath}": ${
          error?.message ?? "no data returned"
        }`,
      );
    }
    return data;
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

  // ---- Explorer-style folders (sites) ----
  //
  // The admin names a folder in the UI and adds images to it, instead of
  // deriving the folder from an OS directory. Empty folders are persisted in the
  // `sites` table so they survive a reload before any image exists; non-empty
  // folders ALSO appear implicitly via their `annotations` rows. The gallery
  // therefore renders the UNION of `listSites()` and the distinct sites in the
  // image rows (computed in App.tsx). All three calls below are admin-gated by
  // RLS server-side; a non-admin's writes fail there regardless of the UI.

  // The persisted (possibly-empty) folder names, sorted.
  async listSites(): Promise<string[]> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("sites")
      .select("name")
      .order("name", { ascending: true });
    if (error) {
      throw new Error(`SupabaseStorageBackend.listSites failed: ${error.message}`);
    }
    return (data ?? []).map((row) => row.name as string);
  }

  // Registers an empty folder. Idempotent: creating a name that already exists
  // (e.g. one that already has images) is a harmless no-op, not an error, so the
  // UI never has to special-case "folder already there".
  async createSite(name: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("sites")
      .upsert({ name }, { onConflict: "name", ignoreDuplicates: true });
    if (error) {
      throw new Error(`SupabaseStorageBackend.createSite failed: ${error.message}`);
    }
  }

  // Uploads individual image files INTO an existing folder. `site` is the
  // already-validated folder name; each file's basename becomes the image name.
  // Uploads run with a small concurrency cap (camera folders can be hundreds of
  // images, and one-at-a-time is needlessly slow) while preserving the same
  // per-file accounting and the storage+row contract as `uploadFolder`:
  //   - non-image files are skipped,
  //   - the Storage object is upserted at `<site>/<name>` (re-adding replaces the
  //     pixels), and
  //   - the `annotations` row upsert sends ONLY identity columns so an existing
  //     image's `data` jsonb is never clobbered by a re-upload.
  async uploadImagesToSite(
    site: string,
    files: File[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UploadResult> {
    const supabase = getSupabaseClient();
    const result: UploadResult = { uploaded: 0, skipped: 0, failed: [] };
    const total = files.length;
    let done = 0;
    let cursor = 0;
    const CONCURRENCY = 5;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= files.length) return;
        const file = files[i];
        const target = uploadTargetForSite(site, file.name);
        if (!target) {
          result.skipped += 1;
          onProgress?.(++done, total);
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
        onProgress?.(++done, total);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    );
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

  // Persists the schema-v2 blob (last write wins, per ADR-0003) by UPDATEing the
  // existing row keyed by (site, image_name). The row already exists — the admin
  // uploader (#14) seeds one per image with a NOT-NULL `storage_path`. We must
  // NOT upsert: an upsert issues INSERT ... ON CONFLICT, and the table's INSERT
  // policy is admin-only under RLS, so a normal labeler's save would be denied.
  // There is NO server-side trigger; the client owns the derived summary columns
  // (labeler/status/annotation_count) via `deriveSummary`, plus `updated_at`.
  // `storage_path` and the lock columns are intentionally left untouched.
  async writeAnnotationFile(item: ImageItem, file: AnnotationFile): Promise<void> {
    const supabase = getSupabaseClient();
    // The labeler is the signed-in user's email; deriveSummary records it
    // verbatim (empty string if somehow absent — never blocks the save).
    const { data: userData } = await supabase.auth.getUser();
    const labeler = userData.user?.email ?? "";
    const summary = deriveSummary(file, labeler);
    // `.select()` makes the UPDATE return the affected rows so we can detect a
    // zero-row match (image not registered) — a bare update succeeds silently
    // with data:null even when nothing matched.
    const { data, error } = await supabase
      .from("annotations")
      .update({
        data: file,
        labeler: summary.labeler,
        status: summary.status,
        annotation_count: summary.annotation_count,
        updated_at: new Date().toISOString(),
      })
      .eq("site", item.site)
      .eq("image_name", item.name)
      .select("site");
    if (error) {
      throw new Error(
        `SupabaseStorageBackend.writeAnnotationFile failed for "${item.site}/${item.name}": ${error.message}`,
      );
    }
    if (!data || data.length === 0) {
      throw new Error(
        `SupabaseStorageBackend.writeAnnotationFile: no annotations row for "${item.site}/${item.name}" (image not registered by the admin uploader).`,
      );
    }
  }

  // ---- Admin destructive ops (delete / rename) ----
  //
  // All four are admin-only server-side: Storage remove/move and the
  // sites/annotations DELETEs are gated by RLS. A non-admin's calls fail there
  // regardless of the UI offering the affordance. Web-only — not on the shared
  // `StorageBackend` interface (the desktop backend manages its own files).

  // Deletes one image: the Storage object first, then its `annotations` row.
  // Storage-then-row keeps the row from outliving its pixels (a dangling row
  // would show a broken thumbnail); the row delete is the cheap, recoverable end.
  async deleteImage(site: string, name: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error: storageError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .remove([`${site}/${name}`]);
    if (storageError) {
      throw new Error(
        `SupabaseStorageBackend.deleteImage failed for "${site}/${name}": ${storageError.message}`,
      );
    }
    // `.select()` returns the deleted rows. A bare delete reports success even
    // when RLS matched nothing (e.g. a non-admin call), so verify a row actually
    // went — otherwise the UI would show "deleted" while the row survives.
    const { data: deleted, error: rowError } = await supabase
      .from("annotations")
      .delete()
      .eq("site", site)
      .eq("image_name", name)
      .select("image_name");
    if (rowError) {
      throw new Error(
        `SupabaseStorageBackend.deleteImage failed for "${site}/${name}": ${rowError.message}`,
      );
    }
    if (!deleted || deleted.length === 0) {
      throw new Error(
        `SupabaseStorageBackend.deleteImage removed no row for "${site}/${name}" (already gone, or not permitted).`,
      );
    }
  }

  // Deletes an entire folder: every image's Storage object (in chunks of 100, the
  // Storage `remove` batch ceiling), then all its `annotations` rows, then the
  // `sites` row (which may exist independently for an empty folder). An empty
  // folder with no image rows is fine — the chunk loop simply does nothing.
  async deleteSite(name: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { data, error: selectError } = await supabase
      .from("annotations")
      .select("storage_path")
      .eq("site", name);
    if (selectError) {
      throw new Error(
        `SupabaseStorageBackend.deleteSite failed for "${name}": ${selectError.message}`,
      );
    }
    const paths = (data ?? []).map((row) => row.storage_path as string);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: storageError } = await supabase.storage
        .from(PHOTOS_BUCKET)
        .remove(chunk);
      if (storageError) {
        throw new Error(
          `SupabaseStorageBackend.deleteSite failed for "${name}": ${storageError.message}`,
        );
      }
    }
    const { data: delRows, error: rowError } = await supabase
      .from("annotations")
      .delete()
      .eq("site", name)
      .select("image_name");
    if (rowError) {
      throw new Error(
        `SupabaseStorageBackend.deleteSite failed for "${name}": ${rowError.message}`,
      );
    }
    const { data: delSite, error: siteError } = await supabase
      .from("sites")
      .delete()
      .eq("name", name)
      .select("name");
    if (siteError) {
      throw new Error(
        `SupabaseStorageBackend.deleteSite failed for "${name}": ${siteError.message}`,
      );
    }
    // A folder exists via image rows, a `sites` row, or both. If the delete
    // removed neither, nothing actually happened (RLS no-op or already gone) —
    // surface it instead of reporting a phantom success.
    const removed = (delRows?.length ?? 0) + (delSite?.length ?? 0);
    if (removed === 0) {
      throw new Error(
        `SupabaseStorageBackend.deleteSite removed nothing for "${name}" (already gone, or not permitted).`,
      );
    }
  }

  // Renames one image within a folder. The Storage object key is immutable, so we
  // MOVE it first (the admin gate) — this also keeps the object and row consistent
  // if the row update later fails. Then the row's identity columns and, when
  // present, the schema-v2 blob's `image` field are updated to match. `.select`
  // detects a zero-row match (image not registered) rather than silently no-op'ing.
  async renameImage(site: string, oldName: string, newName: string): Promise<void> {
    const supabase = getSupabaseClient();
    const { error: moveError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .move(`${site}/${oldName}`, `${site}/${newName}`);
    if (moveError) {
      throw new Error(
        `SupabaseStorageBackend.renameImage failed for "${site}/${oldName}": ${moveError.message}`,
      );
    }
    const { data: existing, error: readError } = await supabase
      .from("annotations")
      .select("data")
      .eq("site", site)
      .eq("image_name", oldName)
      .maybeSingle<{ data: AnnotationFile | null }>();
    if (readError) {
      throw new Error(
        `SupabaseStorageBackend.renameImage failed for "${site}/${oldName}": ${readError.message}`,
      );
    }
    const updatedData =
      existing?.data != null
        ? { ...existing.data, image: newName }
        : null;
    const updatePayload: Record<string, unknown> = {
      image_name: newName,
      storage_path: `${site}/${newName}`,
      updated_at: new Date().toISOString(),
    };
    if (updatedData !== null) {
      updatePayload.data = updatedData;
    }
    const { data: updated, error: updateError } = await supabase
      .from("annotations")
      .update(updatePayload)
      .eq("site", site)
      .eq("image_name", oldName)
      .select("site");
    if (updateError) {
      throw new Error(
        `SupabaseStorageBackend.renameImage failed for "${site}/${oldName}": ${updateError.message}`,
      );
    }
    if (!updated || updated.length === 0) {
      throw new Error(
        `SupabaseStorageBackend.renameImage: no annotations row for "${site}/${oldName}".`,
      );
    }
  }

  // Renames a folder. Storage keys are immutable, so every image must be migrated
  // object-by-object (move + row update), each independently consistent so a
  // partial run is safely re-runnable. Per-image failures are collected, not
  // thrown — a straggler leaves its row on the OLD side, and because a re-run's
  // `.eq("site", oldName)` query no longer returns the already-migrated images,
  // it only retries the stragglers. The `sites` row is flipped LAST and ONLY when
  // every image succeeded, so the folder still resolves under the old name (and
  // the op stays re-runnable) whenever anything failed. Concurrency cap 5, same
  // worker-pool pattern as `uploadImagesToSite`.
  async renameSite(
    oldName: string,
    newName: string,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ renamed: number; failures: { name: string; error: string }[] }> {
    const supabase = getSupabaseClient();
    const { data: rows, error: selectError } = await supabase
      .from("annotations")
      .select("image_name, data")
      .eq("site", oldName);
    if (selectError) {
      throw new Error(
        `SupabaseStorageBackend.renameSite failed for "${oldName}": ${selectError.message}`,
      );
    }
    const images = (rows ?? []) as { image_name: string; data: AnnotationFile | null }[];
    const total = images.length;
    const failures: { name: string; error: string }[] = [];
    let done = 0;
    let cursor = 0;
    const CONCURRENCY = 5;

    const worker = async (): Promise<void> => {
      while (true) {
        const i = cursor++;
        if (i >= images.length) return;
        const { image_name: name, data } = images[i];
        const from = `${oldName}/${name}`;
        const to = `${newName}/${name}`;
        const { error: moveError } = await supabase.storage
          .from(PHOTOS_BUCKET)
          .move(from, to);
        if (moveError) {
          // The object may already be at `to` from a prior partial run — if so,
          // proceed to the row update; otherwise record the failure and leave
          // this image consistent on the old side.
          const { data: listed } = await supabase.storage
            .from(PHOTOS_BUCKET)
            .list(newName, { limit: 1, search: name });
          if (!listed?.length) {
            failures.push({ name, error: moveError.message });
            onProgress?.(++done, total);
            continue;
          }
        }
        const updatePayload: Record<string, unknown> = {
          site: newName,
          storage_path: to,
          updated_at: new Date().toISOString(),
        };
        if (data != null) {
          updatePayload.data = { ...data, site: newName };
        }
        const { error: updateError } = await supabase
          .from("annotations")
          .update(updatePayload)
          .eq("site", oldName)
          .eq("image_name", name);
        if (updateError) {
          failures.push({ name, error: updateError.message });
        }
        onProgress?.(++done, total);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
    );

    // Flip the folder name LAST, and only on a fully clean migration. On any
    // failure the old `sites` row stays so the folder keeps resolving and a
    // re-run can finish the stragglers.
    if (failures.length === 0) {
      const { error: upsertError } = await supabase
        .from("sites")
        .upsert({ name: newName }, { onConflict: "name", ignoreDuplicates: true });
      if (upsertError) {
        throw new Error(
          `SupabaseStorageBackend.renameSite failed for "${oldName}": ${upsertError.message}`,
        );
      }
      const { error: deleteError } = await supabase
        .from("sites")
        .delete()
        .eq("name", oldName);
      if (deleteError) {
        throw new Error(
          `SupabaseStorageBackend.renameSite failed for "${oldName}": ${deleteError.message}`,
        );
      }
    }

    return { renamed: total - failures.length, failures };
  }
}
