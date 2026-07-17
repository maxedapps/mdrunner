import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "satteri";

import { ExpectedError, errorCodes } from "../../src/errors.ts";
import { mermaidDiagramPlugin, validateGeneratedMermaidSvg } from "../../src/plugins/mermaid.ts";
import type { MarkdownSource } from "../../src/source.ts";

function source(markdown: string): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: "/workspace/security.md",
    assetBase: "/workspace",
    label: "/workspace/security.md",
  };
}

const VALID_FENCE = "```mermaid\ngraph TD\n  A --> B\n```";

async function injectedFailure(svg: string): Promise<ExpectedError> {
  const markdown = VALID_FENCE;
  try {
    await markdownToHtml(markdown, {
      hastPlugins: [mermaidDiagramPlugin(source(markdown), () => svg)],
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected unsafe generated SVG to fail");
}

describe("Mermaid trusted-output boundary", () => {
  test("keeps label injection escaped as text", async () => {
    const markdown = `\`\`\`mermaid
graph TD
  A["<script>alert(1)</script>"] --> B["<b>safe text</b>"]
\`\`\``;
    const html = (
      await markdownToHtml(markdown, {
        hastPlugins: [mermaidDiagramPlugin(source(markdown))],
      })
    ).html;

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;safe text&lt;/b&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<b>safe text</b>");
  });

  test("rejects external style URLs supplied through Mermaid directives", async () => {
    const markdown = `\`\`\`mermaid
graph TD
  A --> B
  style A fill:url(https://assets.example.test/pattern.svg)
\`\`\``;
    try {
      await markdownToHtml(markdown, {
        hastPlugins: [mermaidDiagramPlugin(source(markdown))],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ExpectedError);
      expect((error as ExpectedError).code).toBe(errorCodes.mermaidUnsafe);
      expect((error as ExpectedError).source?.line).toBe(1);
      return;
    }
    throw new Error("Expected external style URL to fail");
  });

  test.each([
    ["a script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    [
      "foreign content",
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>active</div></foreignObject></svg>',
    ],
    ["an event attribute", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ["a non-SVG namespace", '<svg xmlns="https://example.test/not-svg"><rect/></svg>'],
    [
      "an external href",
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.test/"><text>x</text></a></svg>',
    ],
    [
      "an external source",
      '<svg xmlns="http://www.w3.org/2000/svg"><image src="data:image/png;base64,AA=="/></svg>',
    ],
    [
      "a CSS import",
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://example.test/a.css");</style></svg>',
    ],
    [
      "an external CSS URL",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://example.test/a.svg#x)"/></svg>',
    ],
    [
      "an escaped external CSS URL",
      '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\\72l(https://example.test/a.svg#x)"/></svg>',
    ],
    [
      "multiple SVG roots",
      '<svg xmlns="http://www.w3.org/2000/svg"></svg><svg xmlns="http://www.w3.org/2000/svg"></svg>',
    ],
  ])("rejects generated SVG containing %s", async (_description, svg) => {
    const error = await injectedFailure(svg);

    expect(error.code).toBe(errorCodes.mermaidUnsafe);
    expect(error.source).toEqual({ label: "/workspace/security.md", line: 1, column: 1 });
  });

  test("allows internal paint references and makes accepted SVG responsive", () => {
    const markdownSource = source(VALID_FENCE);
    const svg = validateGeneratedMermaidSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10" viewBox="0 0 20 10">
  <defs><linearGradient id="safe-gradient"><stop offset="0"/></linearGradient></defs>
  <rect width="20" height="10" fill="url(#safe-gradient)"/>
</svg>`,
      markdownSource,
    );

    const openingSvg = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
    expect(svg).toContain('fill="url(#safe-gradient)"');
    expect(openingSvg).toContain('width="100%"');
    expect(openingSvg).toContain('height="auto"');
    expect(openingSvg).not.toContain('width="20"');
  });

  test("strips generated Google Fonts imports while retaining safe internal class markers", async () => {
    const markdown = "```mermaid\nclassDiagram\n  Animal <|-- Dog\n```";
    const html = (
      await markdownToHtml(markdown, {
        hastPlugins: [mermaidDiagramPlugin(source(markdown))],
      })
    ).html;

    expect(html).toContain("url(#cls-inherit)");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toMatch(/@import\b/i);
  });
});
