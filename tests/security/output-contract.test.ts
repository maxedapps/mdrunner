import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { markdownToHtml } from "satteri";

import { ExpectedError, errorCodes } from "../../src/errors.ts";
import { runMdrunner, type MdrunnerDependencies } from "../../src/main.ts";
import { renderDocument, renderMarkdown } from "../../src/render.ts";
import { readMarkdownSource, type MarkdownSource } from "../../src/source.ts";

const fixtureDirectory = join(import.meta.dir, "../fixtures/documents");

async function fixtureSource(name: string): Promise<MarkdownSource> {
  const selection = await readMarkdownSource([join(fixtureDirectory, name)]);
  if (selection.kind !== "render") throw new Error(`Expected render source for ${name}`);
  return selection.source;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await collectSourceFiles(path)));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".css")) paths.push(path);
  }
  return paths.sort();
}

async function expectedFailure(run: () => Promise<unknown>): Promise<ExpectedError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected rendering to fail");
}

describe("pinned upstream adaptations", () => {
  test("keeps the security-sensitive Sätteri plugin order fixed", async () => {
    const renderSource = await readFile(join(import.meta.dir, "../../src/render.ts"), "utf8");
    const assembly = /function pluginAssembly[\s\S]*?\n\}\n\nfunction copyFrontmatter/u.exec(
      renderSource,
    )?.[0];
    expect(assembly).toBeDefined();

    const plugins = [
      ...assembly!.matchAll(
        /\b(authoredContentSafetyPlugin|imageEmbeddingPlugin|headingMetadataPlugin|mermaidDiagramPlugin|staticExpressiveCodePlugin)\(/gu,
      ),
    ].map((match) => match[1]);
    expect(plugins).toEqual([
      "authoredContentSafetyPlugin",
      "imageEmbeddingPlugin",
      "headingMetadataPlugin",
      "mermaidDiagramPlugin",
      "staticExpressiveCodePlugin",
    ]);
  });

  test("proves the product adapts Sätteri's unsafe raw HTML and URL defaults", async () => {
    const baselineMarkdown =
      '<script data-origin="baseline">alert(1)</script>\n\n[unsafe](javascript:alert)\n';
    const baseline = await markdownToHtml(baselineMarkdown);
    expect(baseline.html).toContain('<script data-origin="baseline">');
    expect(baseline.html).toContain('href="javascript:alert"');

    const rawSource = await fixtureSource("raw-html.md");
    const adapted = await renderMarkdown(rawSource);
    expect(adapted.fragment).toContain('&lt;script data-origin="authored"&gt;');
    expect(adapted.fragment).toContain("&lt;img src=x onerror=");
    expect(adapted.fragment).not.toMatch(/<script\b|<img\b/iu);

    const unsafeSource = await fixtureSource("unsafe-protocol.md");
    const error = await expectedFailure(() => renderMarkdown(unsafeSource));
    expect(error).toMatchObject({
      code: errorCodes.unsafeLinkUrl,
      source: { label: unsafeSource.label, line: 5, column: 1 },
    });
  });

  test("rejects a known silently tolerated Mermaid statement with its installed source position", async () => {
    const malformedSource = await fixtureSource("malformed-mermaid.md");
    const error = await expectedFailure(() => renderDocument(malformedSource));

    expect(error).toMatchObject({
      code: errorCodes.mermaidInvalid,
      source: { label: malformedSource.label, line: 5, column: 1 },
    });
  });
});

describe("generation-only output boundary", () => {
  test("never writes, prints, or opens a partial document after a renderer failure", async () => {
    const malformedSource = await fixtureSource("malformed-mermaid.md");
    const effects: string[] = [];
    const dependencies: MdrunnerDependencies = {
      async readSource() {
        effects.push("read");
        return { kind: "render", source: malformedSource };
      },
      async render(source) {
        effects.push("render");
        return renderDocument(source);
      },
      async writeOutput() {
        effects.push("write");
        return "/tmp/must-not-exist.html";
      },
      printOutput() {
        effects.push("print");
      },
      async openBrowser() {
        effects.push("open");
      },
    };

    const result = await runMdrunner([], dependencies);

    expect(result.exitCode).toBe(1);
    if (result.exitCode !== 1) throw new Error("Expected renderer failure");
    expect(result.error).toMatchObject({ code: errorCodes.mermaidInvalid });
    expect(result.outputPath).toBeUndefined();
    expect(effects).toEqual(["read", "render"]);
  });

  test("contains no product network client, HTTP server, listener, or runtime socket path", async () => {
    const sourceRoot = join(import.meta.dir, "../../src");
    const files = await collectSourceFiles(sourceRoot);
    const inspected = (
      await Promise.all(
        files.map(async (path) => `\n/* ${path} */\n${await readFile(path, "utf8")}`),
      )
    ).join("\n");

    expect(files.length).toBeGreaterThan(0);
    expect(inspected).not.toMatch(/\bBun\.serve\s*\(/u);
    expect(inspected).not.toMatch(/\bfetch\s*\(/u);
    expect(inspected).not.toMatch(/\bcreateServer\s*\(/u);
    expect(inspected).not.toMatch(/\.(?:listen|connect)\s*\(/u);
    expect(inspected).not.toMatch(/from\s+["']node:(?:http|https|net|tls|dgram)["']/u);
    expect(inspected).not.toMatch(/\bnew\s+(?:EventSource|WebSocket)\s*\(/u);
  });
});
