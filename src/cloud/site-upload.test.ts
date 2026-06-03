import { describe, it, expect } from "vitest";
import { validateSiteName, uploadTargetForSite } from "./site-upload";

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
