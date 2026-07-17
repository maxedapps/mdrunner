import { describe, expect, test } from "bun:test";

import { createHeadingSlugger, slugifyHeading } from "../../src/slug.ts";

describe("slugifyHeading", () => {
  test.each([
    ["Hello, static Markdown!", "hello-static-markdown"],
    ["  many --- separators___here  ", "many-separators-here"],
    ["HÉLLO 世界 Привет", "héllo-世界-привет"],
    ["Cafe\u0301", "café"],
    ["🐈 💫 --", "section"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(slugifyHeading(input)).toBe(expected);
  });
});

describe("createHeadingSlugger", () => {
  test("deduplicates normalized slugs with suffixes starting at two", () => {
    const slugger = createHeadingSlugger();

    expect(slugger.slug("Hello")).toBe("hello");
    expect(slugger.slug("HELLO!")).toBe("hello-2");
    expect(slugger.slug("Hello")).toBe("hello-3");
    expect(slugger.slug("🐈")).toBe("section");
    expect(slugger.slug("💫")).toBe("section-2");
  });

  test("keeps state isolated between documents", () => {
    expect(createHeadingSlugger().slug("Repeat")).toBe("repeat");
    expect(createHeadingSlugger().slug("Repeat")).toBe("repeat");
  });
});
