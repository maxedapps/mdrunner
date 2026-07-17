import { pathToFileURL } from "node:url";

import type { MarkdownSource, SourceSelection } from "./source.ts";

export const USAGE_TEXT = `Usage: mdrunner <file.md>
       command-producing-markdown | mdrunner`;

export interface MdrunnerDependencies {
  readSource(args: readonly string[]): Promise<SourceSelection>;
  render(source: MarkdownSource): Promise<string>;
  writeOutput(source: MarkdownSource, html: string): Promise<string>;
  printOutput(value: string): void;
  openBrowser(fileUrl: string): Promise<void>;
}

export type MdrunnerResult =
  | { readonly exitCode: 0 }
  | {
      readonly exitCode: 1;
      /** Kept unknown so the executable boundary normalizes and displays it exactly once. */
      readonly error: unknown;
      /** Present once a complete output was written, including print/opener failures. */
      readonly outputPath?: string;
    };

/**
 * Coordinate one run without owning process exit or error presentation.
 * All externally visible effects are injected so tests cannot open a real browser.
 */
export async function runMdrunner(
  args: readonly string[],
  dependencies: MdrunnerDependencies,
): Promise<MdrunnerResult> {
  let outputPath: string | undefined;

  try {
    const selection = await dependencies.readSource(args);
    if (selection.kind === "help") {
      dependencies.printOutput(USAGE_TEXT);
      return { exitCode: 0 };
    }

    const html = await dependencies.render(selection.source);
    outputPath = await dependencies.writeOutput(selection.source, html);
    dependencies.printOutput(outputPath);
    await dependencies.openBrowser(pathToFileURL(outputPath).href);
    return { exitCode: 0 };
  } catch (error) {
    return outputPath === undefined ? { exitCode: 1, error } : { exitCode: 1, error, outputPath };
  }
}
