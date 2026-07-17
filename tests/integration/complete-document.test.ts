import { beforeAll, describe, expect, test } from "bun:test";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DOCUMENT_CSP } from "../../src/document.ts";
import { renderDocument } from "../../src/render.ts";
import { readMarkdownSource, type MarkdownSource } from "../../src/source.ts";

const fixtureDirectory = join(import.meta.dir, "../fixtures/documents");
const fixturePath = join(fixtureDirectory, "complete.md");

let html = "";
let source: MarkdownSource;

beforeAll(async () => {
  const selection = await readMarkdownSource([fixturePath]);
  if (selection.kind !== "render") throw new Error("Expected complete fixture source");
  source = selection.source;
  html = await renderDocument(source);
}, 20_000);

function count(pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

describe("representative complete document", () => {
  test("assembles one complete shell with escaped metadata and the restrictive CSP", () => {
    expect(html).toStartWith('<!doctype html>\n<html lang="en">\n<head>\n');
    expect(html).toEndWith("</main>\n</body>\n</html>\n");
    expect(count(/<html\b/gu)).toBe(1);
    expect(count(/<head>/gu)).toBe(1);
    expect(count(/<body>/gu)).toBe(1);
    expect(count(/<main class="markdown-body">/gu)).toBe(1);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${DOCUMENT_CSP}">`);
    expect(DOCUMENT_CSP).toContain("default-src 'none'");
    expect(DOCUMENT_CSP).toContain("connect-src 'none'");
    expect(DOCUMENT_CSP).toContain("font-src 'none'");
    expect(DOCUMENT_CSP).toContain("script-src 'none'");
    expect(html).toContain("<title>Café 世界 — Static output</title>");
  });

  test("crosses GFM, frontmatter, duplicate and Unicode headings, and layout extremes", () => {
    expect(html).toContain('<h1 id="café-世界-static-output">');
    expect(html).toContain('<h2 id="repeated-heading">Repeated heading</h2>');
    expect(html).toContain('<h2 id="repeated-heading-2">Repeated heading</h2>');
    expect(html).toContain('<h2 id="unicode-καλημέρα">Unicode Καλημέρα</h2>');
    expect(html).toContain("<table>");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('type="checkbox" checked disabled');
    expect(html).toContain("<del>obsolete text</del>");
    expect(html).toContain("data-footnotes");
    expect(html).toContain("a-layout-token-that-is-intentionally-long");
    expect(html).not.toContain("purpose: representative source contract");
    expect(html).not.toContain("author: Ada Lovelace");
  });

  test("renders six Mermaid families and known and unknown code as static output", () => {
    expect(count(/<figure class="mermaid-diagram" role="img"/gu)).toBe(6);
    expect(count(/<svg\b/gu)).toBe(6);
    for (const family of ["flowchart", "state", "sequence", "class", "ER", "XY"]) {
      expect(html).toContain(`aria-label="Mermaid ${family} diagram"`);
    }
    expect(html).toContain('<pre data-language="ts">');
    expect(html).toContain('<span class="title">complete.ts</span>');
    expect(html).toContain('data-language="unknown-language"');
    expect(html).toContain("literal &lt;tag&gt; &amp; a-layout-token");
    expect(html).not.toContain('<div class="copy">');
    expect(html).not.toMatch(/<button\b/iu);
    expect(html).not.toContain('data-language="mermaid"');
  });

  test("embeds contained images, preserves authored remote URLs, and rewrites a local link", async () => {
    const canonicalFixtureDirectory = await realpath(fixtureDirectory);
    const localGuide = new URL("guide.md#start", pathToFileURL(`${canonicalFixtureDirectory}/`));

    expect(count(/src="data:image\/(?:png|svg\+xml);base64,/gu)).toBe(2);
    expect(html).toContain('src="https://images.example.test/preview.png"');
    expect(html).toContain('href="https://docs.example.test/guide?q=static#output"');
    expect(html).toContain('href="mailto:reader@example.test"');
    expect(html).toContain('href="tel:+12025550123"');
    expect(html).toContain(`href="${localGuide.href}"`);
    expect(html).toContain('href="#repeated-heading-2"');
    expect(html).not.toContain("assets/pixel.png");
    expect(html).not.toContain("assets/safe.svg");
    expect(html).not.toMatch(/<img\b[^>]*\bsrc=["']file:/iu);
  });

  test("keeps authored HTML inert and includes responsive light, dark, and print CSS", () => {
    expect(html).toContain('&lt;script data-origin="authored"&gt;');
    expect(html).toContain("&lt;/script&gt;");
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).toContain(".markdown-body .mermaid-diagram svg");
    expect(html).toContain(".markdown-body table");
    expect(html).toContain("overflow-x: auto");
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("@media (max-width: 40rem)");
    expect(html).toContain("@media print");
  });

  test("contains no renderer runtime, external product asset, font import, or module script", () => {
    expect(html).not.toMatch(/<script\b/iu);
    expect(html).not.toMatch(/<link\b/iu);
    expect(html).not.toMatch(/type=["']module["']/iu);
    expect(html).not.toMatch(/\b(?:modulepreload|mermaid\.min\.js|mermaid\.initialize)\b/iu);
    expect(html).not.toMatch(/@import\b/iu);
    expect(html).not.toMatch(/@font-face\b/iu);
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("fonts.gstatic.com");
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).not.toContain("unpkg.com");
  });

  test("is deterministic for the same representative file source", async () => {
    const markdown = await readFile(fixturePath, "utf8");
    expect(source.markdown).toBe(markdown);
    await expect(renderDocument(source)).resolves.toBe(html);
  }, 20_000);
});
