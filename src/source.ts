import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { ExpectedError } from "./errors.ts";

export type MarkdownSource =
  | {
      readonly kind: "file";
      readonly markdown: string;
      readonly canonicalPath: string;
      readonly assetBase: string;
      readonly label: string;
    }
  | {
      readonly kind: "stdin";
      readonly markdown: string;
      readonly cwd: string;
      readonly assetBase: string;
      readonly label: "stdin";
    };

export type SourceSelection =
  | { readonly kind: "help" }
  | { readonly kind: "render"; readonly source: MarkdownSource };

export const HELP_SELECTION: SourceSelection = Object.freeze({ kind: "help" });

function sourceError(message: string, label?: string): ExpectedError {
  return new ExpectedError(message, label === undefined ? undefined : { label });
}

function hasNodeCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw sourceError("Input is not valid UTF-8.", label);
  }
}

async function readFileSource(argument: string, cwd: string): Promise<MarkdownSource> {
  const requestedPath = resolve(cwd, argument);
  if (extname(argument).toLowerCase() !== ".md") {
    throw sourceError("Expected a Markdown file with a .md extension.", requestedPath);
  }

  let canonicalPath: string;
  try {
    canonicalPath = resolve(cwd, await realpath(requestedPath));
  } catch (error) {
    if (hasNodeCode(error, "ENOENT", "ENOTDIR")) {
      throw sourceError("Markdown file was not found.", requestedPath);
    }
    throw sourceError("Markdown file could not be read.", requestedPath);
  }

  try {
    if (!(await stat(canonicalPath)).isFile()) {
      throw sourceError("Markdown source is not a regular file.", canonicalPath);
    }
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    if (hasNodeCode(error, "ENOENT", "ENOTDIR")) {
      throw sourceError("Markdown file was not found.", canonicalPath);
    }
    throw sourceError("Markdown file could not be read.", canonicalPath);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readFile(canonicalPath);
  } catch {
    throw sourceError("Markdown file could not be read.", canonicalPath);
  }

  return {
    kind: "file",
    markdown: decodeUtf8(bytes, canonicalPath),
    canonicalPath,
    assetBase: dirname(canonicalPath),
    label: canonicalPath,
  };
}

async function readStdinSource(cwd: string): Promise<MarkdownSource> {
  if (process.stdin.isTTY === true) {
    throw sourceError("Provide one .md file or pipe Markdown through stdin.");
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer());
  } catch {
    throw sourceError("Could not read Markdown from stdin.", "stdin");
  }

  const markdown = decodeUtf8(bytes, "stdin");
  if (markdown.trim() === "") throw sourceError("Piped Markdown is empty.", "stdin");
  return { kind: "stdin", markdown, cwd, assetBase: cwd, label: "stdin" };
}

/** Select and fully acquire one Markdown source from user CLI arguments. */
export async function readMarkdownSource(args: readonly string[]): Promise<SourceSelection> {
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) return HELP_SELECTION;
  if (args.length > 1) {
    throw sourceError("Expected one .md file or piped Markdown; use --help for usage.");
  }

  const cwd = resolve(process.cwd());
  return args.length === 1
    ? { kind: "render", source: await readFileSource(args[0]!, cwd) }
    : { kind: "render", source: await readStdinSource(cwd) };
}
