import { describe, expect, test } from "bun:test";

import {
  createHtmlDocument,
  DOCUMENT_CSP,
  FinalDocumentError,
  validateFinalDocument,
} from "../../src/document.ts";
import { renderDocument } from "../../src/render.ts";
import type { MarkdownSource } from "../../src/source.ts";

function source(markdown: string): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: "/workspace/Document.md",
    assetBase: "/workspace",
    label: "/workspace/Document.md",
  };
}

const representativeMarkdown = `# Static <document> & "title"

| Feature | Ready |
| --- | --- |
| shell | yes |

- [x] generation time

A note.[^1]

[^1]: Complete.

\`inline code\`

\`\`\`ts title="document.ts"
const staticOutput = true;
\`\`\`

\`\`\`mermaid
graph TD
  Markdown --> HTML
\`\`\`
`;

describe("complete static document", () => {
  test("assembles required HTML5 metadata, escaped title, CSP, and semantic main", async () => {
    const html = await renderDocument(source(representativeMarkdown));

    expect(html).toStartWith('<!doctype html>\n<html lang="en">\n<head>\n');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`);
    expect(DOCUMENT_CSP).toContain("script-src 'none'");
    expect(DOCUMENT_CSP).toContain("font-src 'none'");
    expect(DOCUMENT_CSP).toContain("img-src data: http: https:");
    expect(html).toContain("<title>Static &lt;document&gt; &amp; &quot;title&quot;</title>");
    expect(html).toContain('<main class="markdown-body"><h1 id="static-document-title">');
    expect(html).toEndWith("</main>\n</body>\n</html>\n");
  }, 10_000);

  test("inlines product and Expressive Code CSS with responsive light/dark/print styling", async () => {
    const html = await renderDocument(source(representativeMarkdown));

    expect(html).toContain("<style data-mdrunner-styles>");
    expect(html).toContain("--mdrunner-background:");
    expect(html).toContain("--mdrunner-foreground:");
    expect(html).toContain("--mdrunner-surface:");
    expect(html).toContain("--mdrunner-muted:");
    expect(html).toContain("--mdrunner-border:");
    expect(html).toContain("--mdrunner-accent:");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("@media print");
    expect(html).toContain(".markdown-body table");
    expect(html).toContain("overflow-x: auto");
    expect(html).toContain(".markdown-body .mermaid-diagram svg");
    expect(html).toContain("max-width: 100%");
    expect(html).toContain(".markdown-body :focus-visible");
    expect(html).toContain('<div class="expressive-code">');
    expect(html).toContain("github-light");
    expect(html).toContain("github-dark");
    expect(html).toContain('<figure class="mermaid-diagram"');
  }, 10_000);

  test("contains no runtime JavaScript or external product stylesheet/font/module", async () => {
    const html = await renderDocument(source(representativeMarkdown));

    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/<button\b/iu);
    expect(html).not.toMatch(/<div class="copy">/iu);
    expect(html).not.toMatch(/<link\b/iu);
    expect(html).not.toMatch(/@import\b/iu);
    expect(html).not.toMatch(/@font-face\b/iu);
    expect(html).not.toMatch(/type=["']module["']/iu);
    expect(html).not.toContain("mermaid.min.js");
    expect(html).not.toContain("fonts.googleapis.com");
  }, 10_000);

  test("is byte-for-byte deterministic for identical input", async () => {
    const input = source(representativeMarkdown);
    const first = await renderDocument(input);
    const second = await renderDocument(input);

    expect(second).toBe(first);
  }, 15_000);
});

describe("final document invariant validator", () => {
  const valid = createHtmlDocument("Safe", '<h1>Safe</h1><input type="checkbox" disabled>');

  test.each([
    ["missing main", (html: string) => html.replace('class="markdown-body"', 'class="other"')],
    ["missing head close", (html: string) => html.replace("</head>", "")],
    ["script", (html: string) => html.replace("</main>", "<script>bad()</script></main>")],
    ["active SVG", (html: string) => html.replace("</main>", "<animate></animate></main>")],
    [
      "external stylesheet",
      (html: string) =>
        html.replace("</head>", '<link rel="stylesheet" href="https://x.test/x.css"></head>'),
    ],
    [
      "CSS import",
      (html: string) =>
        html.replace(
          "<style data-mdrunner-styles>",
          '<style data-mdrunner-styles>@import url("https://x.test/x.css");',
        ),
    ],
    [
      "font definition",
      (html: string) =>
        html.replace(
          "<style data-mdrunner-styles>",
          "<style data-mdrunner-styles>@font-face { font-family: x; src: local(x); }",
        ),
    ],
    ["event handler", (html: string) => html.replace("<h1>", '<h1 onclick="bad()">')],
    [
      "executable URL",
      (html: string) => html.replace("<h1>", '<a href="javascript:bad()">x</a><h1>'),
    ],
    ["active input", (html: string) => html.replace("</main>", '<input type="text"></main>')],
    ["altered CSP", (html: string) => html.replace("script-src 'none'", "script-src 'self'")],
    [
      "refresh metadata",
      (html: string) => html.replace("</head>", '<meta http-equiv="refresh" content="0"></head>'),
    ],
  ])("rejects %s before persistence", (_name, mutate) => {
    expect(() => validateFinalDocument(mutate(valid))).toThrow(FinalDocumentError);
  });

  test("accepts authored discussion of runtime names when it remains inert text", () => {
    expect(() =>
      validateFinalDocument(
        createHtmlDocument(
          "Runtime discussion",
          "<p>Do not load mermaid.min.js or modulepreload.</p>",
        ),
      ),
    ).not.toThrow();
  });
});
