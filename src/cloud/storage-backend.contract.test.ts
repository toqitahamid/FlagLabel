import { describe, expect, it } from "vitest";
import { buildAnnotationFile, type AnnotationFile } from "../annotations/schema";
import type { Annotation } from "../annotations/model";
import { InMemoryStorageBackend } from "./memory-backend";
import type { ImageItem, StorageBackend } from "./storage-backend";

// A StorageBackend that can be seeded with images out of band (images are not
// created through the seam). InMemory satisfies this directly; a future cloud
// backend would adapt its test setup to the same shape.
interface SeedableBackend extends StorageBackend {
  addImage(item: ImageItem): void;
}

function makeFile(annotations: Annotation[]): AnnotationFile {
  return buildAnnotationFile(
    { site: "cam02", image: "IMG_0001.JPG", image_w: 4000, image_h: 3000 },
    annotations,
    "0.0.0-test",
    "2026-01-01T00:00:00.000Z"
  );
}

const ITEM: ImageItem = { id: "cam02/IMG_0001.JPG", site: "cam02", name: "IMG_0001.JPG" };
const OTHER: ImageItem = { id: "cam02/IMG_0002.JPG", site: "cam02", name: "IMG_0002.JPG" };

// Behavior every StorageBackend must satisfy. The cloud (Supabase) backend will
// reuse this suite to prove it is a drop-in for the desktop one.
export function runStorageBackendContract(
  name: string,
  makeBackend: () => SeedableBackend
) {
  describe(`StorageBackend contract: ${name}`, () => {
    it("write then read returns an equal AnnotationFile", async () => {
      const backend = makeBackend();
      const file = makeFile([
        { kind: "wire_ground", u: 100, v: 200, transect: "L", distance: 5 },
      ]);
      await backend.writeAnnotationFile(ITEM, file);
      const read = await backend.readAnnotationFile(ITEM);
      expect(read).toEqual(file);
    });

    it("read for an unwritten image returns null", async () => {
      const backend = makeBackend();
      const read = await backend.readAnnotationFile(ITEM);
      expect(read).toBeNull();
    });

    it("overwriting replaces content (last write wins)", async () => {
      const backend = makeBackend();
      const first = makeFile([
        { kind: "wire_ground", u: 1, v: 2, transect: "L", distance: 1 },
      ]);
      const second = makeFile([
        { kind: "wire_ground", u: 9, v: 9, transect: "R", distance: 9 },
        { kind: "vertical_span", u1: 1, v1: 1, u2: 2, v2: 2, transect: "C", distance: 3 },
      ]);
      await backend.writeAnnotationFile(ITEM, first);
      await backend.writeAnnotationFile(ITEM, second);
      const read = await backend.readAnnotationFile(ITEM);
      expect(read).toEqual(second);
    });

    it("an empty-annotations file persists and reads back as empty, not null", async () => {
      // Mirrors the v0.1.2 cleared-save invariant: clearing all annotations on a
      // previously-saved image writes a full object with empty arrays.
      const backend = makeBackend();
      const empty = makeFile([]);
      await backend.writeAnnotationFile(ITEM, empty);
      const read = await backend.readAnnotationFile(ITEM);
      expect(read).not.toBeNull();
      expect(read).toEqual(empty);
      expect(read?.wire_ground_points).toEqual([]);
      expect(read?.flag_vertical_spans).toEqual([]);
      expect(read?.flag_horizontal_spans).toEqual([]);
      expect(read?.flag_to_ground_spans).toEqual([]);
    });

    it("listImages returns the items that were added", async () => {
      const backend = makeBackend();
      backend.addImage(ITEM);
      backend.addImage(OTHER);
      const items = await backend.listImages();
      expect(items).toEqual([ITEM, OTHER]);
    });

    it("write to one image does not affect another", async () => {
      const backend = makeBackend();
      await backend.writeAnnotationFile(ITEM, makeFile([
        { kind: "wire_ground", u: 1, v: 1, transect: "L", distance: 1 },
      ]));
      expect(await backend.readAnnotationFile(OTHER)).toBeNull();
    });
  });
}

runStorageBackendContract("InMemoryStorageBackend", () => new InMemoryStorageBackend());
