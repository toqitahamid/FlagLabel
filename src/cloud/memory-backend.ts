import type { AnnotationFile } from "../annotations/schema";
import type { ImageItem, StorageBackend } from "./storage-backend";

// Network-free, Tauri-free test double. Holds images and annotation files in
// Maps keyed by item id; resolveImageUrl returns a stable fake URL. Stored files
// are cloned so callers can't mutate persisted state through their reference
// (mirroring real backends that serialize on write / parse on read).
export class InMemoryStorageBackend implements StorageBackend {
  private images: ImageItem[] = [];
  private files = new Map<string, AnnotationFile>();

  // Out-of-band seeding: images aren't created through the seam, so this is on
  // the concrete class, not the StorageBackend interface.
  addImage(item: ImageItem): void {
    this.images.push(item);
  }

  seedImages(items: ImageItem[]): void {
    for (const item of items) this.addImage(item);
  }

  async listImages(): Promise<ImageItem[]> {
    return this.images.slice();
  }

  resolveImageUrl(item: ImageItem): string {
    return `memory://${item.id}`;
  }

  async readAnnotationFile(item: ImageItem): Promise<AnnotationFile | null> {
    const stored = this.files.get(item.id);
    return stored ? clone(stored) : null;
  }

  async writeAnnotationFile(item: ImageItem, file: AnnotationFile): Promise<void> {
    this.files.set(item.id, clone(file));
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
