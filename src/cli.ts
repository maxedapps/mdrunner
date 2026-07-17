#!/usr/bin/env bun

import { pathToFileURL } from "node:url";

import { openBrowser } from "./browser.ts";
import { formatError } from "./errors.ts";
import { writeOutput } from "./output.ts";
import { renderDocument } from "./render.ts";
import { readMarkdownSource } from "./source.ts";

export const USAGE_TEXT = `Usage: mdrunner <file.md>
       command-producing-markdown | mdrunner`;

async function main(args: readonly string[]): Promise<void> {
  const selection = await readMarkdownSource(args);
  if (selection.kind === "help") {
    console.log(USAGE_TEXT);
    return;
  }

  const html = await renderDocument(selection.source);
  const outputPath = await writeOutput(selection.source, html);
  console.log(outputPath);
  await openBrowser(pathToFileURL(outputPath).href);
}

try {
  await main(Bun.argv.slice(2));
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}
