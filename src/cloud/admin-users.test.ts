import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail, maskToolsError } from "./admin-users";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  First.Last@Example.com  ")).toBe(
      "first.last@example.com",
    );
  });

  it("leaves an already-clean address unchanged", () => {
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("first.last@example.com")).toBe(true);
  });

  it.each(["", "no-at-sign", "a@b", "a @b.co", "a@b .co", "@b.co", "a@.co"])(
    "rejects %j",
    (bad) => {
      expect(isValidEmail(bad)).toBe(false);
    },
  );
});

describe("maskToolsError", () => {
  it("expands the bare authorization message into a sentence", () => {
    expect(maskToolsError("not authorized").message).toMatch(
      /already has the mask tools/,
    );
  });

  it("still expands it when Postgres prefixes the context", () => {
    expect(
      maskToolsError('failed to run "grant_mask_tools": not authorized').message,
    ).toMatch(/already has the mask tools/);
  });

  it("passes any other server message through verbatim", () => {
    expect(maskToolsError("cannot revoke yourself").message).toBe(
      "cannot revoke yourself",
    );
  });
});
