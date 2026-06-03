import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AnnotationFile } from "../annotations/schema";
import {
  imageRefFromStoragePath,
  annotationFilename,
} from "./image-identity";
import type { ImageItem, StorageBackend } from "./storage-backend";

// Join a directory and a filename the same way App.tsx's `joinPath` did, so the
// produced annotation paths are byte-identical to the pre-seam desktop app.
function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function pathBasename(p: string): string {
  return p.split("/").pop() ?? p;
}

function pathParent(p: string): string {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}

function siteFromPath(p: string): string {
  return pathBasename(pathParent(p)) || "unknown";
}

function stemFromPath(p: string): string {
  return pathBasename(p).replace(/\.[^.]+$/, "");
}

// Filename for an item's annotation JSON: `<site>__<imagestem>.json`. Prefers
// the shared `image-identity` helpers (the canonical cloud-side identity); falls
// back to the path-derived formula for ids that don't parse as image paths so
// behavior matches the desktop app's `clickFilename` for every input it saw.
export function annotationFilenameFor(item: ImageItem): string {
  const ref = imageRefFromStoragePath(item.id);
  if (ref) return annotationFilename(ref);
  return `${siteFromPath(item.id)}__${stemFromPath(item.id)}.json`;
}

// Desktop backend: the absolute file path IS the item id. Wraps the existing
// Rust commands (`list_images_in_dir`, `read_text_file`, `write_text_file`) and
// `convertFileSrc`, reproducing the pre-seam behavior exactly. The chosen image
// folder and clicks dir are threaded in via setters (App obtains them from the
// native dialogs, unchanged).
export class TauriStorageBackend implements StorageBackend {
  private folder: string | null = null;
  private clicksDir: string | null = null;

  setFolder(folder: string | null): void {
    this.folder = folder;
  }

  setClicksDir(clicksDir: string | null): void {
    this.clicksDir = clicksDir;
  }

  async listImages(): Promise<ImageItem[]> {
    if (!this.folder) return [];
    const paths = await invoke<string[]>("list_images_in_dir", {
      path: this.folder,
    });
    return paths.map((path) => ({
      id: path,
      site: siteFromPath(path),
      name: pathBasename(path),
    }));
  }

  resolveImageUrl(item: ImageItem): string {
    return convertFileSrc(item.id);
  }

  async readAnnotationFile(item: ImageItem): Promise<AnnotationFile | null> {
    if (!this.clicksDir) return null;
    const path = joinPath(this.clicksDir, annotationFilenameFor(item));
    const content = await invoke<string | null>("read_text_file", { path });
    // Matches the desktop app's `if (!content) continue/return`: a missing OR
    // empty file is "no annotations", parsed only when non-empty. A parse error
    // on malformed content propagates to App's existing try/catch unchanged.
    if (!content) return null;
    return JSON.parse(content) as AnnotationFile;
  }

  async writeAnnotationFile(item: ImageItem, file: AnnotationFile): Promise<void> {
    if (!this.clicksDir) {
      throw new Error("TauriStorageBackend: clicks dir not set");
    }
    const path = joinPath(this.clicksDir, annotationFilenameFor(item));
    // Byte-identical to the pre-seam `JSON.stringify(data, null, 2)`.
    const content = JSON.stringify(file, null, 2);
    await invoke("write_text_file", { path, content });
  }
}
