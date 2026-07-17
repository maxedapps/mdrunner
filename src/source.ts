import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { Stats } from "node:fs";

import { ExpectedError, errorCodes } from "./errors.ts";

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

export interface StdinBoundary {
  isTTY(): boolean;
  readAll(): Promise<Uint8Array>;
}

export interface SourceFileSystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<Pick<Stats, "isFile">>;
  readFile(path: string): Promise<Uint8Array>;
}

export interface ReadMarkdownSourceOptions {
  /** Absolute or relative working directory. Relative values are resolved once. */
  readonly cwd?: string;
  readonly stdin?: StdinBoundary;
  readonly fileSystem?: SourceFileSystem;
}

export const HELP_SELECTION: SourceSelection = Object.freeze({ kind: "help" });

const defaultFileSystem: SourceFileSystem = { readFile, realpath, stat };

function defaultStdinBoundary(): StdinBoundary {
  return {
    isTTY: () => process.stdin.isTTY === true,
    readAll: async () => new Uint8Array(await new Response(Bun.stdin.stream()).arrayBuffer()),
  };
}

function sourceError(
  code: (typeof errorCodes)[keyof typeof errorCodes],
  message: string,
  label?: string,
): ExpectedError {
  return new ExpectedError(code, message, label === undefined ? undefined : { label });
}

function hasNodeCode(error: unknown, ...codes: string[]): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return codes.includes(String(error.code));
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw sourceError(errorCodes.invalidUtf8, "Input is not valid UTF-8.", label);
  }
}

async function readFileSource(
  argument: string,
  cwd: string,
  fileSystem: SourceFileSystem,
): Promise<MarkdownSource> {
  const requestedPath = resolve(cwd, argument);
  if (extname(argument).toLowerCase() !== ".md") {
    throw sourceError(
      errorCodes.invalidExtension,
      "Expected a Markdown file with a .md extension.",
      requestedPath,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = resolve(cwd, await fileSystem.realpath(requestedPath));
  } catch (error) {
    if (hasNodeCode(error, "ENOENT", "ENOTDIR")) {
      throw sourceError(errorCodes.fileNotFound, "Markdown file was not found.", requestedPath);
    }
    throw sourceError(errorCodes.fileUnreadable, "Markdown file could not be read.", requestedPath);
  }

  let metadata: Pick<Stats, "isFile">;
  try {
    metadata = await fileSystem.stat(canonicalPath);
  } catch (error) {
    if (hasNodeCode(error, "ENOENT", "ENOTDIR")) {
      throw sourceError(errorCodes.fileNotFound, "Markdown file was not found.", canonicalPath);
    }
    throw sourceError(errorCodes.fileUnreadable, "Markdown file could not be read.", canonicalPath);
  }
  if (!metadata.isFile()) {
    throw sourceError(
      errorCodes.notRegularFile,
      "Markdown source is not a regular file.",
      canonicalPath,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await fileSystem.readFile(canonicalPath);
  } catch {
    throw sourceError(errorCodes.fileUnreadable, "Markdown file could not be read.", canonicalPath);
  }

  return {
    kind: "file",
    markdown: decodeUtf8(bytes, canonicalPath),
    canonicalPath,
    assetBase: dirname(canonicalPath),
    label: canonicalPath,
  };
}

async function readStdinSource(cwd: string, stdin: StdinBoundary): Promise<MarkdownSource> {
  if (stdin.isTTY()) {
    throw sourceError(
      errorCodes.sourceRequired,
      "Provide one .md file or pipe Markdown through stdin.",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await stdin.readAll();
  } catch {
    throw sourceError(errorCodes.stdinUnreadable, "Could not read Markdown from stdin.", "stdin");
  }

  const markdown = decodeUtf8(bytes, "stdin");
  if (markdown.trim() === "") {
    throw sourceError(errorCodes.emptyStdin, "Piped Markdown is empty.", "stdin");
  }

  return {
    kind: "stdin",
    markdown,
    cwd,
    assetBase: cwd,
    label: "stdin",
  };
}

/**
 * Select and fully acquire one Markdown source. `args` contains only user CLI
 * arguments (not the Bun executable or entrypoint).
 */
export async function readMarkdownSource(
  args: readonly string[],
  options: ReadMarkdownSourceOptions = {},
): Promise<SourceSelection> {
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    return HELP_SELECTION;
  }
  if (args.length > 1) {
    throw sourceError(
      errorCodes.invalidArguments,
      "Expected one .md file or piped Markdown; use --help for usage.",
    );
  }

  const cwd = resolve(options.cwd ?? process.cwd());
  const stdin = options.stdin ?? defaultStdinBoundary();
  if (args.length === 1) {
    return {
      kind: "render",
      source: await readFileSource(args[0]!, cwd, options.fileSystem ?? defaultFileSystem),
    };
  }

  return { kind: "render", source: await readStdinSource(cwd, stdin) };
}
