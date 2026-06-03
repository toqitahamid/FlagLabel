import { describe, it, expect } from "vitest";
import { imageRefFromStoragePath, annotationFilename } from "./image-identity";

describe("imageRefFromStoragePath", () => {
  it("parses a typical path into site, stem, ext", () => {
    expect(imageRefFromStoragePath("photos/cam02/IMG_0001.JPG")).toEqual({
      site: "cam02",
      stem: "IMG_0001",
      ext: "JPG",
    });
  });
});

describe("annotationFilename", () => {
  it("produces site__stem.json with double underscore", () => {
    expect(annotationFilename({ site: "cam02", stem: "IMG_0001" })).toBe(
      "cam02__IMG_0001.json"
    );
  });
});

describe("imageRefFromStoragePath — non-image inputs return null", () => {
  it("returns null for a non-image extension", () => {
    expect(imageRefFromStoragePath("cam02/notes.txt")).toBeNull();
  });

  it("returns null when there is no parent folder (bare filename)", () => {
    expect(imageRefFromStoragePath("IMG_0001.JPG")).toBeNull();
  });
});

describe("imageRefFromStoragePath — stems with dots", () => {
  it("splits on the LAST dot so a multi-dot stem is preserved", () => {
    expect(imageRefFromStoragePath("cam02/IMG_0001.final.JPG")).toEqual({
      site: "cam02",
      stem: "IMG_0001.final",
      ext: "JPG",
    });
  });
});

describe("imageRefFromStoragePath — deeper paths", () => {
  it("uses the immediate parent folder as site, ignoring higher folders", () => {
    expect(imageRefFromStoragePath("a/b/cam03/IMG_5304.JPG")).toEqual({
      site: "cam03",
      stem: "IMG_5304",
      ext: "JPG",
    });
  });
});

describe("parity with desktop helpers", () => {
  // Desktop: siteFromPath = pathBasename(pathParent(p))
  //          stemFromPath  = pathBasename(p).replace(/\.[^.]+$/, "")
  //          clickFilename = `${site}__${stem}.json`
  // These must produce the same output for the same image path.
  it("annotationFilename from imageRefFromStoragePath matches desktop clickFilename", () => {
    const path = "photos/cam02/IMG_0001.JPG";
    const ref = imageRefFromStoragePath(path);
    expect(ref).not.toBeNull();
    expect(annotationFilename(ref!)).toBe("cam02__IMG_0001.json");
  });

  it("site matches desktop siteFromPath (immediate parent folder)", () => {
    // Desktop: pathBasename(pathParent("photos/cam02/IMG_0001.JPG")) → "cam02"
    const ref = imageRefFromStoragePath("photos/cam02/IMG_0001.JPG");
    expect(ref!.site).toBe("cam02");
  });

  it("stem matches desktop stemFromPath (basename minus last extension)", () => {
    // Desktop: "IMG_0001.JPG".replace(/\.[^.]+$/, "") → "IMG_0001"
    const ref = imageRefFromStoragePath("photos/cam02/IMG_0001.JPG");
    expect(ref!.stem).toBe("IMG_0001");
  });
});

describe("imageRefFromStoragePath — extension handling", () => {
  it("accepts .JPG (uppercase)", () => {
    const ref = imageRefFromStoragePath("cam02/IMG_0001.JPG");
    expect(ref).not.toBeNull();
    expect(ref!.ext).toBe("JPG");
  });

  it("accepts .jpeg (lowercase)", () => {
    const ref = imageRefFromStoragePath("cam02/IMG_0001.jpeg");
    expect(ref).not.toBeNull();
    expect(ref!.ext).toBe("jpeg");
  });

  it("accepts .png (lowercase)", () => {
    const ref = imageRefFromStoragePath("cam02/IMG_0001.png");
    expect(ref).not.toBeNull();
    expect(ref!.ext).toBe("png");
  });

  it("accepts .PNG (uppercase)", () => {
    const ref = imageRefFromStoragePath("cam02/IMG_0001.PNG");
    expect(ref).not.toBeNull();
    expect(ref!.ext).toBe("PNG");
  });
});
