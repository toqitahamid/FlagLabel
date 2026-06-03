import type { AnnotationFile } from "../annotations/schema";

// One image the UI can list, display, and annotate. Backend-agnostic on purpose:
// `id` is an opaque handle the backend understands (the Tauri backend treats it
// as the absolute file path; a Supabase backend would use a storage key/row id),
// while `site` and `name` are the human-facing grouping (camera folder) and the
// image filename (e.g. "IMG_0001.JPG"). No OS-path shape is implied by the type.
export type ImageItem = {
  id: string;
  site: string;
  name: string;
};

// The single seam between the annotation UI and persistence I/O. Exactly the
// four things the app does today: list images, resolve an image's display URL,
// read a per-image annotation file, write a per-image annotation file. The whole
// `src/annotations/` core (schema build/parse) stays shared above this seam.
export interface StorageBackend {
  // All images available to annotate, in display order.
  listImages(): Promise<ImageItem[]>;

  // A URL the <img>/canvas can load for this image. May be sync (Tauri's
  // convertFileSrc) or async (a signed cloud URL).
  resolveImageUrl(item: ImageItem): string | Promise<string>;

  // The parsed schema-v2 annotation object for this image, or null if none has
  // been saved. An image saved with all-empty annotation arrays reads back as a
  // present (non-null) object, not null.
  readAnnotationFile(item: ImageItem): Promise<AnnotationFile | null>;

  // Persist the schema-v2 annotation object for this image (last write wins).
  writeAnnotationFile(item: ImageItem, file: AnnotationFile): Promise<void>;
}
