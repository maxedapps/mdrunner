import { describe, expect, test } from "bun:test";

import { renderDocument } from "../../src/render.ts";
import type { MarkdownSource } from "../../src/source.ts";

function fileSource(markdown: string, name = "Guide.md"): MarkdownSource {
  const canonicalPath = `/workspace/docs/${name}`;
  return {
    kind: "file",
    markdown,
    canonicalPath,
    assetBase: "/workspace/docs",
    label: canonicalPath,
  };
}

function stdinSource(markdown: string): MarkdownSource {
  return {
    kind: "stdin",
    markdown,
    cwd: "/workspace",
    assetBase: "/workspace",
    label: "stdin",
  };
}

describe("real Sätteri Markdown compilation", () => {
  test.each([
    ["YAML", "---\nauthor: Ada\n---", "author: Ada"],
    ["TOML", '+++\nauthor = "Ada"\n+++', 'author = "Ada"'],
  ])("accepts and omits %s frontmatter while rendering GFM", async (_kind, frontmatter, hidden) => {
    const html = await renderDocument(
      fileSource(`${frontmatter}
## Features

> A **strong** quote with \`code\`.

| Item | Ready |
| :--- | ---: |
| Parser | yes |

- [x] rendered

~~obsolete~~ and https://example.com/docs.

A note.[^note]

[^note]: Footnote text.
`),
    );

    expect(html).toContain('<h2 id="features">Features</h2>');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain("<del>obsolete</del>");
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain("data-footnotes");
    expect(html).not.toContain(hidden);
    expect(html).toContain("<title>Guide</title>");
  });

  test("adds deterministic Unicode, duplicate, fallback, and footnote-safe heading IDs", async () => {
    const source = fileSource(`# Footnote label

## user-content-fn-note

## Café 世界

## Café 世界

## 🐈

Reference.[^note]

[^note]: Footnote text.
`);
    const first = await renderDocument(source);
    const second = await renderDocument(source);
    const ids = [...first.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]!);

    expect(new Set(ids).size).toBe(ids.length);
    expect(first).toContain('<h1 id="footnote-label-2">Footnote label</h1>');
    expect(first).toContain('<h2 id="user-content-fn-note-2">user-content-fn-note</h2>');
    expect(first).toContain('<h2 id="café-世界">Café 世界</h2>');
    expect(first).toContain('<h2 id="café-世界-2">Café 世界</h2>');
    expect(first).toContain('<h2 id="section">🐈</h2>');
    expect(second).toBe(first);
  });

  test("uses the first H1, file stem, or stdin fallback as title", async () => {
    expect(await renderDocument(fileSource("## Before\n\n# First *document* title\n"))).toContain(
      "<title>First document title</title>",
    );
    expect(await renderDocument(fileSource("## Child\n", "API Notes.MD"))).toContain(
      "<title>API Notes</title>",
    );
    expect(await renderDocument(stdinSource("## Child\n"))).toContain(
      "<title>Markdown document</title>",
    );
  });

  test("treats authored heading attributes as heading text", async () => {
    const html = await renderDocument(fileSource("# Heading {#authored .danger}\n"));
    expect(html).toContain('<h1 id="heading-authored-danger">Heading {#authored .danger}</h1>');
    expect(html).not.toContain('class="danger"');
    expect(html).not.toContain('id="authored"');
  });
});
