import { describe, it, expect } from "vitest";
import { normalizeEmail, isValidEmail } from "./admin-users";

describe("normalizeEmail", () => {
  it("trims surrounding whitespace and lowercases", () => {
    expect(normalizeEmail("  Khaled.Ahmed@SIU.edu  ")).toBe("khaled.ahmed@siu.edu");
  });

  it("leaves an already-clean address unchanged", () => {
    expect(normalizeEmail("a@b.co")).toBe("a@b.co");
  });
});

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("khaled.ahmed@siu.edu")).toBe(true);
  });

  it.each(["", "no-at-sign", "a@b", "a @b.co", "a@b .co", "@b.co", "a@.co"])(
    "rejects %j",
    (bad) => {
      expect(isValidEmail(bad)).toBe(false);
    },
  );
});
