import { describe, it, expect } from "vitest";
import { uploadTargetFromRelativePath } from "./upload-identity";

describe("uploadTargetFromRelativePath", () => {
  it("derives site from the immediate parent folder of a webkitRelativePath", () => {
    expect(uploadTargetFromRelativePath("cam02/IMG_0001.JPG")).toEqual({
      site: "cam02",
      name: "IMG_0001.JPG",
      storagePath: "cam02/IMG_0001.JPG",
    });
  });

  it("uses the immediate parent as site for a nested picked folder", () => {
    // Browser reports the picked-folder name as the first segment.
    expect(uploadTargetFromRelativePath("survey2024/cam03/IMG_5304.JPG")).toEqual({
      site: "cam03",
      name: "IMG_5304.JPG",
      storagePath: "cam03/IMG_5304.JPG",
    });
  });

  it("storagePath is the in-bucket key with NO photos/ prefix", () => {
    const t = uploadTargetFromRelativePath("cam02/IMG_0001.JPG");
    expect(t!.storagePath.startsWith("photos/")).toBe(false);
    expect(t!.storagePath).toBe("cam02/IMG_0001.JPG");
  });

  it("accepts mixed-case extensions", () => {
    expect(uploadTargetFromRelativePath("cam02/a.jpeg")?.storagePath).toBe("cam02/a.jpeg");
    expect(uploadTargetFromRelativePath("cam02/a.PNG")?.storagePath).toBe("cam02/a.PNG");
    expect(uploadTargetFromRelativePath("cam02/a.png")?.storagePath).toBe("cam02/a.png");
  });

  it("returns null for non-image files (skipped by the uploader)", () => {
    expect(uploadTargetFromRelativePath("cam02/notes.txt")).toBeNull();
  });

  it("returns null for a bare filename with no parent folder", () => {
    expect(uploadTargetFromRelativePath("IMG_0001.JPG")).toBeNull();
  });

  it("preserves a multi-dot stem in name and storagePath", () => {
    const t = uploadTargetFromRelativePath("cam02/IMG_0001.final.JPG");
    expect(t).toEqual({
      site: "cam02",
      name: "IMG_0001.final.JPG",
      storagePath: "cam02/IMG_0001.final.JPG",
    });
  });
});
