import { describe, it, expect } from "vitest";
import {
  validateSiteName,
  uploadTargetForSite,
  isUploadableImage,
  splitImageName,
  renameImageName,
  validateStem,
} from "./site-upload";

describe("validateSiteName", () => {
  it("accepts a plain camera name and returns it trimmed", () => {
    expect(validateSiteName("cam02")).toEqual({ ok: true, name: "cam02" });
    expect(validateSiteName("  north-ridge  ")).toEqual({
      ok: true,
      name: "north-ridge",
    });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateSiteName("")).toMatchObject({ ok: false });
    expect(validateSiteName("   ")).toMatchObject({ ok: false });
  });

  it("rejects slashes (would break the <site>/<name> storage layout)", () => {
    expect(validateSiteName("survey/cam02")).toMatchObject({ ok: false });
    expect(validateSiteName("a\\b")).toMatchObject({ ok: false });
  });

  it("rejects a double underscore (it is the export-filename separator)", () => {
    // exportEntryName builds `${site}__${stem}.json`; a `__` in site is ambiguous.
    expect(validateSiteName("cam__02")).toMatchObject({ ok: false });
  });

  it("rejects a leading or trailing dot", () => {
    expect(validateSiteName(".cam02")).toMatchObject({ ok: false });
    expect(validateSiteName("cam02.")).toMatchObject({ ok: false });
  });

  it("rejects an over-long name", () => {
    expect(validateSiteName("c".repeat(101))).toMatchObject({ ok: false });
  });

  it("allows single underscores, hyphens, dots, and spaces inside the name", () => {
    expect(validateSiteName("cam_02")).toEqual({ ok: true, name: "cam_02" });
    expect(validateSiteName("north ridge 2024")).toEqual({
      ok: true,
      name: "north ridge 2024",
    });
    expect(validateSiteName("site.a")).toEqual({ ok: true, name: "site.a" });
  });
});

describe("uploadTargetForSite", () => {
  it("builds the in-bucket target from an explicit site + filename", () => {
    expect(uploadTargetForSite("cam02", "IMG_0001.JPG")).toEqual({
      site: "cam02",
      name: "IMG_0001.JPG",
      storagePath: "cam02/IMG_0001.JPG",
    });
  });

  it("storagePath has NO photos/ prefix (it is the in-bucket key)", () => {
    const t = uploadTargetForSite("cam02", "a.jpg");
    expect(t!.storagePath.startsWith("photos/")).toBe(false);
    expect(t!.storagePath).toBe("cam02/a.jpg");
  });

  it("accepts mixed-case image extensions", () => {
    expect(uploadTargetForSite("cam02", "a.jpeg")?.storagePath).toBe("cam02/a.jpeg");
    expect(uploadTargetForSite("cam02", "a.PNG")?.storagePath).toBe("cam02/a.PNG");
  });

  it("returns null for a non-image file (skipped by the uploader)", () => {
    expect(uploadTargetForSite("cam02", "notes.txt")).toBeNull();
  });

  it("returns null for a macOS AppleDouble sidecar (._*)", () => {
    expect(uploadTargetForSite("cam02", "._IMG_0001.JPG")).toBeNull();
  });

  it("uses only the basename if a path-ish filename slips through", () => {
    // A browser File.name is a bare filename, but guard anyway so a stray
    // sub-path can never nest the object under an unintended folder.
    expect(uploadTargetForSite("cam02", "sub/IMG_0001.JPG")).toEqual({
      site: "cam02",
      name: "IMG_0001.JPG",
      storagePath: "cam02/IMG_0001.JPG",
    });
  });
});

describe("isUploadableImage", () => {
  it("accepts a plain image basename", () => {
    expect(isUploadableImage("IMG_0001.JPG")).toBe(true);
    expect(isUploadableImage("a.PNG")).toBe(true);
  });

  it("rejects a macOS AppleDouble sidecar (._*)", () => {
    expect(isUploadableImage("._IMG_0001.JPG")).toBe(false);
  });

  it("rejects a non-image file", () => {
    expect(isUploadableImage("notes.txt")).toBe(false);
  });

  it("checks the BASENAME, not the raw path", () => {
    // The `._` check must run on the last segment: a real image in a `sub/`
    // path stays uploadable, but an AppleDouble there is still rejected.
    expect(isUploadableImage("sub/x.jpg")).toBe(true);
    expect(isUploadableImage("sub/._x.jpg")).toBe(false);
  });
});

describe("splitImageName", () => {
  it("splits on the last dot, keeping the dot in ext", () => {
    expect(splitImageName("IMG_0001.JPG")).toEqual({
      stem: "IMG_0001",
      ext: ".JPG",
    });
  });

  it("treats earlier dots as part of the stem", () => {
    expect(splitImageName("IMG_0001.final.JPG")).toEqual({
      stem: "IMG_0001.final",
      ext: ".JPG",
    });
  });

  it("returns an empty ext when there is no dot", () => {
    expect(splitImageName("noext")).toEqual({ stem: "noext", ext: "" });
  });
});

describe("renameImageName", () => {
  it("swaps the stem but preserves the original extension", () => {
    expect(renameImageName("IMG_0001.JPG", "flag1")).toBe("flag1.JPG");
  });

  it("preserves an empty extension when the original had none", () => {
    expect(renameImageName("noext", "renamed")).toBe("renamed");
  });
});

describe("validateStem", () => {
  it("accepts a plain stem and returns it trimmed", () => {
    expect(validateStem("flag1")).toEqual({ ok: true, stem: "flag1" });
    expect(validateStem("  flag1  ")).toEqual({ ok: true, stem: "flag1" });
  });

  it("rejects an empty or whitespace-only stem", () => {
    expect(validateStem("")).toEqual({ ok: false, reason: "Enter a name." });
    expect(validateStem("   ")).toEqual({ ok: false, reason: "Enter a name." });
  });

  it("rejects slashes (would nest the renamed object under a folder)", () => {
    expect(validateStem("a/b")).toEqual({
      ok: false,
      reason: "Name can't contain slashes.",
    });
    expect(validateStem("a\\b")).toEqual({
      ok: false,
      reason: "Name can't contain slashes.",
    });
  });

  it("allows dots inside the stem (no extension rules here)", () => {
    expect(validateStem("flag.1")).toEqual({ ok: true, stem: "flag.1" });
  });
});
