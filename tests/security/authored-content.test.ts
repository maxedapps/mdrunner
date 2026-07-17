import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ExpectedError, formatError } from "../../src/errors.ts";
import { renderDocument } from "../../src/render.ts";
import type { MarkdownSource } from "../../src/source.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

function fileSource(markdown: string, base = "/workspace/docs"): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: join(base, "unsafe.md"),
    assetBase: base,
    label: join(base, "unsafe.md"),
  };
}

async function expectedFailure(markdown: string): Promise<ExpectedError> {
  try {
    await renderDocument(fileSource(markdown));
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected rendering to fail");
}

describe("authored raw HTML safety", () => {
  test("turns scripts, styles, and event-handler markup into inert text", async () => {
    const html = await renderDocument(
      fileSource(`<script>alert("executed")</script>

<style>body { display: none }</style>

<img src=x onerror="alert(1)">

<a href="javascript:alert(1)" onclick="alert(2)">raw link</a>
`),
    );

    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;style&gt;");
    expect(html).toContain("&lt;img src=x onerror=");
    expect(html).toContain("&lt;a href=");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<a\b[^>]*href=/i);
  });
});

describe("authored anchor URL policy", () => {
  test("keeps safe remote, mail, telephone, fragment, and contained local links usable", async () => {
    await withTemporaryDirectory(async (base) => {
      const html = await renderDocument(
        fileSource(
          `[remote]( HTTPS://Example.COM:443/a?q=1#part )
[mail](mailto:reader@example.com)
[phone](tel:+12025550123)
[fragment](#café)
[local](guides/intro%20page.md?mode=print#start)
`,
          base,
        ),
      );
      const localUrl = new URL(
        "guides/intro%20page.md?mode=print#start",
        pathToFileURL(`${base}/`),
      );

      expect(html).toContain('href="https://example.com/a?q=1#part"');
      expect(html).toContain('href="mailto:reader@example.com"');
      expect(html).toContain('href="tel:+12025550123"');
      expect(html).toContain('href="#caf%C3%A9"');
      expect(html).toContain(`href="${localUrl.href}"`);
    });
  });

  test.each([
    ["mixed-case executable scheme", "JaVaScRiPt:alert(1)"],
    ["percent-encoded executable scheme", "jav%61script:alert(1)"],
    ["encoded control obfuscation", "java%0Ascript:alert(1)"],
    ["double-encoded executable scheme", "jav%2561script:alert(1)"],
    ["explicit file scheme", "FiLe:///etc/passwd"],
    ["data scheme", "data:text/html,hello"],
    ["unknown scheme", "custom:payload"],
    ["protocol-relative URL", "//example.test/path"],
    ["absolute local path", "/etc/passwd"],
    ["parent traversal", "../outside.txt"],
    ["encoded parent traversal", "%2e%2e/outside.txt"],
    ["double-encoded parent traversal", "%252e%252e/outside.txt"],
    ["encoded backslash ambiguity", "..%5Coutside.txt"],
  ])("rejects %s", async (_description, url) => {
    const error = await expectedFailure(`[unsafe](${url})\n`);
    expect(error.message).toStartWith("Unsafe link URL:");
  });

  test("reports the installed Sätteri source position", async () => {
    const error = await expectedFailure("# Safe\n\nParagraph\n\n[unsafe](javascript:alert(1))\n");
    expect(error.source).toEqual({ label: "/workspace/docs/unsafe.md", line: 5, column: 1 });
    expect(formatError(error)).toStartWith("/workspace/docs/unsafe.md:5:1:");
  });
});
