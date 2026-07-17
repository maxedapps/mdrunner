import { describe, expect, test } from "bun:test";

import { renderMarkdown } from "../../src/render.ts";
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
  test("renders CommonMark and enabled GFM features while hiding frontmatter", async () => {
    const result = await renderMarkdown(
      fileSource(`---
author: Ada
---
## Features

> A **strong** quote with \`code\`.

| Item | Ready |
| :--- | ---: |
| Parser | yes |

- [x] rendered
- [ ] pending

~~obsolete~~ and https://example.com/docs.

A note.[^note]

[^note]: Footnote text.
`),
    );

    expect(result.fragment).toContain('<h2 id="features">Features</h2>');
    expect(result.fragment).toContain("<blockquote>");
    expect(result.fragment).toContain("<strong>strong</strong>");
    expect(result.fragment).toContain("<code>code</code>");
    expect(result.fragment).toContain("<table>");
    expect(result.fragment).toContain('class="contains-task-list"');
    expect(result.fragment).toContain('type="checkbox" checked disabled');
    expect(result.fragment).toContain("<del>obsolete</del>");
    expect(result.fragment).toContain('href="https://example.com/docs"');
    expect(result.fragment).toContain("data-footnotes");
    expect(result.fragment).toContain("Footnote text");
    expect(result.fragment).not.toContain("author: Ada");
    expect(result.frontmatter).toEqual({ kind: "yaml", value: "author: Ada" });
  });

  test("adds deterministic Unicode, duplicate, and fallback heading IDs", async () => {
    const markdown = `# Café 世界

## Cafe\u0301 世界

## 🐈

### 🐕
`;
    const first = await renderMarkdown(fileSource(markdown));
    const second = await renderMarkdown(fileSource(markdown));

    expect(first.fragment).toContain('<h1 id="café-世界">Café 世界</h1>');
    expect(first.fragment).toContain('<h2 id="café-世界-2">Café 世界</h2>');
    expect(first.fragment).toContain('<h2 id="section">🐈</h2>');
    expect(first.fragment).toContain('<h3 id="section-2">🐕</h3>');
    expect(second.fragment).toBe(first.fragment);
  });

  test("keeps authored heading IDs unique from generated GFM footnote targets", async () => {
    const result = await renderMarkdown(
      fileSource(`# Footnote label

## user-content-fn-note

## user-content-fnref-note

Reference.[^note]

[^note]: Footnote text.
`),
    );
    const ids = [...result.fragment.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]!);

    expect(new Set(ids).size).toBe(ids.length);
    expect(result.fragment).toContain('<h1 id="footnote-label-2">Footnote label</h1>');
    expect(result.fragment).toContain('<h2 id="user-content-fn-note-2">user-content-fn-note</h2>');
    expect(result.fragment).toContain(
      '<h2 id="user-content-fnref-note-2">user-content-fnref-note</h2>',
    );
    expect(result.fragment).toContain('href="#user-content-fn-note"');
    expect(result.fragment).toContain('href="#user-content-fnref-note"');
    expect(result.fragment).toContain('aria-describedby="footnote-label"');
  });

  test("captures the first H1 as durable title metadata", async () => {
    const result = await renderMarkdown(
      fileSource("## Before\n\n# First *document* title\n\n# Later title\n"),
    );

    expect(result.title).toBe("First document title");
    expect(result.data.title).toBe("First document title");
    expect(result.fragment).toContain('<h1 id="first-document-title">');
    expect(result.fragment).toContain('<h1 id="later-title">');
    expect(Object.isFrozen(result.data)).toBe(true);
  });

  test("uses the source stem or stdin default when no H1 exists", async () => {
    expect((await renderMarkdown(fileSource("## Child\n", "API Notes.MD"))).title).toBe(
      "API Notes",
    );
    expect((await renderMarkdown(stdinSource("## Child\n"))).title).toBe("Markdown document");
  });

  test("explicitly disables authored heading attributes", async () => {
    const result = await renderMarkdown(fileSource("# Heading {#authored .danger}\n"));

    expect(result.fragment).toContain(
      '<h1 id="heading-authored-danger">Heading {#authored .danger}</h1>',
    );
    expect(result.fragment).not.toContain('class="danger"');
    expect(result.fragment).not.toContain('id="authored"');
  });
});
