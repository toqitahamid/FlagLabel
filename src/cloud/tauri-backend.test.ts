import { describe, expect, it } from "vitest";
import { annotationFilenameFor } from "./tauri-backend";
import type { ImageItem } from "./storage-backend";

// Locks the #1 no-behavior-change invariant: the annotation filename the Tauri
// backend derives must equal the desktop app's pre-seam `<site>__<stem>.json`
// formula for every path shape it saw. The GUI acceptance path can't be run
// here, so this guards the byte-level filename contract.
function legacyFilename(path: string): string {
  const basename = path.split("/").pop() ?? path;
  const parts = path.split("/");
  parts.pop();
  const parent = parts.join("/");
  const site = (parent.split("/").pop() ?? parent) || "unknown";
  const stem = basename.replace(/\.[^.]+$/, "");
  return `${site}__${stem}.json`;
}

function item(path: string): ImageItem {
  const basename = path.split("/").pop() ?? path;
  const parts = path.split("/");
  parts.pop();
  const parent = parts.join("/");
  return {
    id: path,
    site: (parent.split("/").pop() ?? parent) || "unknown",
    name: basename,
  };
}

describe("annotationFilenameFor matches the legacy desktop formula", () => {
  const paths = [
    "/Users/x/photos/cam02/IMG_0001.JPG",
    "/Users/x/photos/cam02/IMG_0001.jpg",
    "/srv/data/cam10/shot.0042.png",
    "/cam02/IMG.0001.jpeg",
  ];
  for (const path of paths) {
    it(path, () => {
      expect(annotationFilenameFor(item(path))).toBe(legacyFilename(path));
    });
  }
});
