import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { markdownToHtml } from "satteri";

import { imageEmbeddingPlugin } from "../../src/plugins/images.ts";
import { authoredContentSafetyPlugin } from "../../src/plugins/safety.ts";
import type { MarkdownSource } from "../../src/source.ts";

const fixtureBase = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/images");

function source(kind: "file" | "stdin", markdown: string, assetBase = fixtureBase): MarkdownSource {
  if (kind === "file") {
    return {
      kind,
      markdown,
      canonicalPath: join(assetBase, "document.md"),
      assetBase,
      label: join(assetBase, "document.md"),
    };
  }
  return { kind, markdown, cwd: assetBase, assetBase, label: "stdin" };
}

async function render(input: MarkdownSource): Promise<string> {
  const result = await markdownToHtml(input.markdown, {
    hastPlugins: [authoredContentSafetyPlugin(input), imageEmbeddingPlugin(input)],
  });
  return result.html;
}

function escapedDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

describe("local image integration", () => {
  for (const kind of ["file", "stdin"] as const) {
    test(`embeds PNG, JPEG, GIF, WebP, and SVG for a ${kind} asset base`, async () => {
      const cases = [
        ["pixel.png", "image/png"],
        ["pixel.jpg", "image/jpeg"],
        ["pixel.gif", "image/gif"],
        ["pixel.webp", "image/webp"],
        ["safe.svg", "image/svg+xml"],
      ] as const;
      const markdown = cases.map(([path], index) => `![image ${index}](${path})`).join("\n\n");
      const html = await render(source(kind, markdown));

      for (const [[path, mime], bytes] of await Promise.all(
        cases.map(async (item) => [item, await readFile(join(fixtureBase, item[0]))] as const),
      )) {
        expect(html).toContain(`src="${escapedDataUri(mime, bytes)}"`);
        expect(html).not.toContain(path);
      }
    });
  }

  test("decodes nested paths with spaces and Unicode and ignores query/fragment", async () => {
    const path = "nested/Unicode%20%C3%BC%20space/tiny%20image.png?download=1#preview";
    const html = await render(source("file", `![nested](${path})\n`));
    const bytes = await readFile(join(fixtureBase, "nested/Unicode ü space/tiny image.png"));

    expect(html).toContain(`src="${escapedDataUri("image/png", bytes)}"`);
    expect(html).not.toContain("download=1");
    expect(html).not.toContain("preview");
  });

  test("preserves remote HTTP(S) without fetching and escapes authored alt/title", async () => {
    const markdown = `![<remote & image>](https://images.example.test/a.png?q=1 "a &quot;title&quot; & more")\n`;
    const html = await render(source("stdin", markdown));

    expect(html).toContain('src="https://images.example.test/a.png?q=1"');
    expect(html).toContain('alt="<remote &amp; image>"');
    expect(html).toContain('title="a &quot;title&quot; &amp; more"');
  });
});
