import { basename, extname } from "node:path";
import { pathToFileURL } from "node:url";

import { markdownToHtml, type Data, type HastPluginInput } from "satteri";

import { createHtmlDocument } from "./document.ts";
import { staticExpressiveCodePlugin } from "./plugins/expressive-code.ts";
import { headingMetadataPlugins } from "./plugins/headings.ts";
import { imageEmbeddingPlugin } from "./plugins/images.ts";
import { mermaidDiagramPlugin } from "./plugins/mermaid.ts";
import { authoredContentSafetyPlugin } from "./plugins/safety.ts";
import type { MarkdownSource } from "./source.ts";

function fallbackTitle(source: MarkdownSource): string {
  if (source.kind === "stdin") return "Markdown document";
  const stem = basename(source.canonicalPath, extname(source.canonicalPath));
  return stem === "" ? "Markdown document" : stem;
}

function pluginAssembly(source: MarkdownSource): HastPluginInput[] {
  return [
    // Authored transforms must stay before plugins that add trusted generated markup.
    authoredContentSafetyPlugin(source),
    imageEmbeddingPlugin(source),
    ...headingMetadataPlugins(),
    mermaidDiagramPlugin(source),
    staticExpressiveCodePlugin(source),
  ];
}

/** Render a source through the complete static pipeline and validated document shell. */
export async function renderDocument(source: MarkdownSource): Promise<string> {
  const data: Data = {};
  const result = await markdownToHtml(source.markdown, {
    data,
    features: { frontmatter: true, gfm: true, headingAttributes: false },
    hastPlugins: pluginAssembly(source),
    ...(source.kind === "file" ? { fileURL: pathToFileURL(source.canonicalPath) } : {}),
  });
  const title = typeof result.data.title === "string" ? result.data.title : fallbackTitle(source);
  return createHtmlDocument(title, result.html);
}
