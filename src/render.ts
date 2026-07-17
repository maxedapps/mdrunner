import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { markdownToHtml, type Data, type Frontmatter, type HastPluginInput } from "satteri";

import { headingMetadataPlugin } from "./plugins/headings.ts";
import { authoredContentSafetyPlugin } from "./plugins/safety.ts";
import type { MarkdownSource } from "./source.ts";

export interface RenderedMarkdown {
  /** An HTML fragment, deliberately not the final document shell. */
  readonly fragment: string;
  readonly title: string;
  readonly frontmatter: Readonly<Frontmatter> | null;
  /** A detached document-data snapshot; no parser nodes or visitor stubs are retained. */
  readonly data: Readonly<Record<string, unknown>>;
}

function fallbackTitle(source: MarkdownSource): string {
  if (source.kind === "stdin") return "Markdown document";
  const stem = basename(source.canonicalPath, extname(source.canonicalPath));
  return stem === "" ? "Markdown document" : stem;
}

function pluginAssembly(source: MarkdownSource): HastPluginInput[] {
  return [
    // Authored transforms must stay before plugins that add trusted generated markup.
    authoredContentSafetyPlugin(source),
    headingMetadataPlugin(),
  ];
}

function copyFrontmatter(frontmatter: Frontmatter | null): Readonly<Frontmatter> | null {
  return frontmatter === null
    ? null
    : Object.freeze({ kind: frontmatter.kind, value: frontmatter.value });
}

/** Compile one source with the real Sätteri pipeline and per-document plugin factories. */
export async function renderMarkdown(source: MarkdownSource): Promise<RenderedMarkdown> {
  const data: Data = {};
  const result = await markdownToHtml(source.markdown, {
    data,
    features: {
      frontmatter: true,
      gfm: true,
      headingAttributes: false,
    },
    hastPlugins: pluginAssembly(source),
    ...(source.kind === "file" ? { fileURL: pathToFileURL(source.canonicalPath) } : {}),
  });

  const title = typeof result.data.title === "string" ? result.data.title : fallbackTitle(source);
  return Object.freeze({
    fragment: result.html,
    title,
    frontmatter: copyFrontmatter(result.frontmatter),
    data: Object.freeze({ ...result.data }),
  });
}
