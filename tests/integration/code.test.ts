import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { markdownToHtml } from "satteri";

import { ExpectedError, errorCodes, formatError } from "../../src/errors.ts";
import { staticExpressiveCodePlugin } from "../../src/plugins/expressive-code.ts";
import { mermaidDiagramPlugin } from "../../src/plugins/mermaid.ts";
import type { MarkdownSource } from "../../src/source.ts";

function source(markdown: string): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: "/workspace/code.md",
    assetBase: "/workspace",
    label: "/workspace/code.md",
  };
}

async function render(markdown: string): Promise<string> {
  const markdownSource = source(markdown);
  return (
    await markdownToHtml(markdown, {
      hastPlugins: [
        mermaidDiagramPlugin(markdownSource),
        staticExpressiveCodePlugin(markdownSource),
      ],
    })
  ).html;
}

afterEach(() => {
  // Bun restores all spies installed by an individual test, but explicit restore
  // keeps this suite isolated if its behavior changes.
  (console.warn as { mockRestore?: () => void }).mockRestore?.();
  (console.error as { mockRestore?: () => void }).mockRestore?.();
});

describe("static Expressive Code integration", () => {
  test("renders known-language tokens and both automatic GitHub themes", async () => {
    const html = await render("```ts\nconst answer: number = 42;\n```\n");

    expect(html).toContain('<div class="expressive-code">');
    expect(html).toContain('<pre data-language="ts">');
    expect(html).toMatch(/<span style="--0:#[\dA-F]+;--1:#[\dA-F]+">const<\/span>/i);
    expect(html).toContain("github-light");
    expect(html).toContain("github-dark");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).not.toContain("<script");
  });

  test("retains frames, titles, and line markers", async () => {
    const html = await render(`\`\`\`ts title="example.ts" {2} ins={3}
const answer = 42;
console.log(answer);
return answer;
\`\`\``);

    expect(html).toContain('<figure class="frame has-title">');
    expect(html).toContain('<span class="title">example.ts</span>');
    expect(html).toContain('class="ec-line highlight mark"');
    expect(html).toContain('class="ec-line highlight ins"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain('type="module"');
  });

  test("uses a readable txt fallback for unknown languages without successful stderr warnings", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const html = await render(
      "```language-that-does-not-exist\nalpha < beta && gamma > delta\n```\n",
    );

    expect(html).toContain('data-language="language-that-does-not-exist"');
    expect(html).toContain("alpha &lt; beta &amp;&amp; gamma &gt; delta");
    expect(html).toContain('class="ec-line"');
    expect(html).not.toContain('<div class="copy">');
    expect(html).not.toMatch(/<button\b/iu);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  test("processes Mermaid before Expressive Code and leaves ordinary code highlighting intact", async () => {
    const html = await render(`\`\`\`mermaid
graph TD
  A --> B
\`\`\`

\`\`\`js
console.log("ordinary");
\`\`\``);

    expect(html).toContain('<figure class="mermaid-diagram"');
    expect(html).toContain('<div class="expressive-code">');
    expect(html).toContain('data-language="js"');
    expect(html).not.toContain('data-language="mermaid"');
    expect(html).not.toContain("graph TD");
    expect(html).not.toContain("<script");
  });

  test("maps thrown renderer initialization failures to source-aware expected errors", async () => {
    const markdown = "Paragraph\n\n```ts\nconst value = 1;\n```\n";
    try {
      await markdownToHtml(markdown, {
        hastPlugins: [
          staticExpressiveCodePlugin(source(markdown), async () => {
            throw new Error("renderer unavailable");
          }),
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ExpectedError);
      const expected = error as ExpectedError;
      expect(expected.code).toBe(errorCodes.codeHighlightFailed);
      expect(expected.message).toContain("renderer unavailable");
      expect(expected.source).toEqual({ label: "/workspace/code.md", line: 3, column: 1 });
      expect(formatError(expected)).toStartWith("/workspace/code.md:3:1:");
      return;
    }
    throw new Error("Expected code renderer failure");
  });
});
