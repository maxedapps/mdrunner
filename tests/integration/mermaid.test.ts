import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "satteri";

import { ExpectedError, errorCodes, formatError } from "../../src/errors.ts";
import { mermaidDiagramPlugin } from "../../src/plugins/mermaid.ts";
import type { MarkdownSource } from "../../src/source.ts";

function source(markdown: string): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: "/workspace/diagrams.md",
    assetBase: "/workspace",
    label: "/workspace/diagrams.md",
  };
}

async function render(markdown: string): Promise<string> {
  return (await markdownToHtml(markdown, { hastPlugins: [mermaidDiagramPlugin(source(markdown))] }))
    .html;
}

async function failure(markdown: string): Promise<ExpectedError> {
  try {
    await render(markdown);
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected Mermaid rendering to fail");
}

const FAMILIES = [
  ["flowchart", "graph TD\n  Start[Start] --> End[End]"],
  ["state", "stateDiagram-v2\n  [*] --> Ready\n  Ready --> [*]"],
  ["sequence", "sequenceDiagram\n  Alice->>Bob: Hello"],
  ["class", "classDiagram\n  Animal <|-- Dog"],
  ["ER", "erDiagram\n  CUSTOMER ||--o{ ORDER : places"],
  ["XY", 'xychart-beta\n  title "Sales"\n  x-axis [Jan, Feb]\n  bar [4, 7]'],
] as const;

describe("static Mermaid integration", () => {
  test.each(FAMILIES)(
    "renders the supported %s family with the real library",
    async (family, body) => {
      const html = await render(`\`\`\`mermaid\n${body}\n\`\`\``);
      const openingSvg = html.match(/<svg\b[^>]*>/)?.[0] ?? "";

      expect(html).toContain('<figure class="mermaid-diagram" role="img"');
      expect(html).toContain(`aria-label="Mermaid ${family} diagram"`);
      expect(openingSvg).toContain('viewBox="');
      expect(openingSvg).toContain('width="100%"');
      expect(openingSvg).toContain('height="auto"');
      expect(openingSvg).toContain("--bg:var(--mdrunner-background)");
      expect(openingSvg).toContain("--fg:var(--mdrunner-foreground)");
      expect(openingSvg).not.toContain("background:var(--bg)");
      expect(html).toContain("font-family: 'system-ui', system-ui, sans-serif");
      expect(html).not.toContain("language-mermaid");
      expect(html).not.toContain("```mermaid");
      expect(html).not.toMatch(/@import\b/i);
    },
  );

  test.each([
    ["unsupported family", "mindmap\n  root((Topic))"],
    ["empty diagram", ""],
    ["header-only diagram", "graph TD"],
    ["silently ignored flow statement", "graph TD\n  A -->"],
    ["silently ignored state statement", "stateDiagram-v2\n  Ready -->"],
    ["silently ignored sequence statement", "sequenceDiagram\n  Alice->>Bob"],
    ["silently ignored class statement", "classDiagram\n  Animal <|--"],
    ["silently ignored ER statement", "erDiagram\n  CUSTOMER ||--o{"],
    ["non-numeric XY series", "xychart-beta\n  bar [one, two]"],
  ])("rejects %s before producing partial output", async (_description, body) => {
    const error = await failure(`\`\`\`mermaid\n${body}\n\`\`\``);

    expect(error.code).toBe(errorCodes.mermaidInvalid);
    expect(error.source).toEqual({ label: "/workspace/diagrams.md", line: 1, column: 1 });
  });

  test("maps upstream failures to a concise line-aware expected error", async () => {
    const markdown = "# Before\n\n```mermaid\ngraph TD\n  A --> B\n```\n";
    try {
      await markdownToHtml(markdown, {
        hastPlugins: [
          mermaidDiagramPlugin(source(markdown), () => {
            throw new Error("renderer internals");
          }),
        ],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ExpectedError);
      const expected = error as ExpectedError;
      expect(expected.code).toBe(errorCodes.mermaidInvalid);
      expect(expected.source).toEqual({
        label: "/workspace/diagrams.md",
        line: 3,
        column: 1,
      });
      expect(formatError(expected)).toStartWith("/workspace/diagrams.md:3:1:");
      return;
    }
    throw new Error("Expected renderer failure");
  });
});
