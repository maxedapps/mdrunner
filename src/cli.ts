#!/usr/bin/env bun

import { openBrowser } from "./browser.ts";
import { formatError } from "./errors.ts";
import { runMdrunner } from "./main.ts";
import { writeOutput } from "./output.ts";
import { renderDocument } from "./render.ts";
import { readMarkdownSource } from "./source.ts";

/** Bun source scripts and standalone executables both reserve argv entries 0 and 1. */
export function userArguments(argv: readonly string[]): readonly string[] {
  return argv.slice(2);
}

const result = await runMdrunner(userArguments(Bun.argv), {
  readSource: (args) => readMarkdownSource(args),
  render: renderDocument,
  writeOutput: (source, html) => writeOutput(source, html),
  printOutput: (value) => console.log(value),
  openBrowser: (fileUrl) => openBrowser(fileUrl),
});

if (result.exitCode === 1) console.error(formatError(result.error));
process.exitCode = result.exitCode;
