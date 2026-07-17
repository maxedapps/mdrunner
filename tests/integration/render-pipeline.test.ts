import { expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderMarkdown } from "../../src/render.ts";
import type { MarkdownSource } from "../../src/source.ts";

const assetBase = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/images");

function source(markdown: string): MarkdownSource {
  const canonicalPath = join(assetBase, "complete.md");
  return { kind: "file", markdown, canonicalPath, assetBase, label: canonicalPath };
}

test("runs the complete ordered fragment pipeline with only validated static output", async () => {
  const markdown = `# Complete pipeline

<script>alert("never")</script>

![pixel](pixel.png)

\`\`\`mermaid
graph TD
  Markdown --> HTML
\`\`\`

\`\`\`ts title="pipeline.ts" {1}
const finished: boolean = true;
\`\`\`
`;

  const rendered = await renderMarkdown(source(markdown));

  expect(rendered.title).toBe("Complete pipeline");
  expect(rendered.fragment).toContain("&lt;script&gt;");
  expect(rendered.fragment).toContain('src="data:image/png;base64,');
  expect(rendered.fragment).toContain('<figure class="mermaid-diagram" role="img"');
  expect(rendered.fragment).toContain('<div class="expressive-code">');
  expect(rendered.fragment).toContain('<span class="title">pipeline.ts</span>');
  expect(rendered.fragment).not.toContain("<script");
  expect(rendered.fragment).not.toContain("language-mermaid");
  expect(rendered.fragment).not.toMatch(/@import\b/i);
}, 10_000);
