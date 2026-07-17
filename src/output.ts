import { createHash, randomUUID } from "node:crypto";
import {
  mkdir as nodeMkdir,
  open as nodeOpen,
  rename as nodeRename,
  unlink as nodeUnlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { ExpectedError, errorCodes } from "./errors.ts";
import type { MarkdownSource } from "./source.ts";

export interface OutputFileHandle {
  writeFile(contents: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface OutputFileSystem {
  mkdir(path: string): Promise<void>;
  openExclusive(path: string): Promise<OutputFileHandle>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface WriteOutputOptions {
  readonly temporaryDirectory?: string;
  readonly fileSystem?: OutputFileSystem;
  readonly platform?: NodeJS.Platform;
  readonly createUniqueId?: () => string;
}

const defaultFileSystem: OutputFileSystem = {
  async mkdir(path) {
    await nodeMkdir(path, { recursive: true });
  },
  async openExclusive(path) {
    return nodeOpen(path, "wx", 0o600);
  },
  rename: nodeRename,
  unlink: nodeUnlink,
};

const destinationQueues = new Map<string, Promise<void>>();
const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_STEM_BYTES = 120;

function hasNodeCode(error: unknown, ...codes: string[]): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return codes.includes(String(error.code));
}

function outputError(destination: string): ExpectedError {
  return new ExpectedError(errorCodes.outputWriteFailed, "Could not write generated HTML.", {
    label: destination,
  });
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maximumBytes) break;
    bytes += characterBytes;
    result += character;
  }
  return result;
}

function uniqueComponent(createUniqueId: () => string): string {
  const sanitized = createUniqueId().replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  return sanitized === "" ? "unique" : sanitized;
}

/** Return a portable filename stem while preserving ordinary spaces and Unicode. */
export function sanitizeOutputStem(canonicalPath: string): string {
  const fileName = basename(canonicalPath);
  const extension = extname(fileName);
  let stem = fileName.slice(0, fileName.length - extension.length).normalize("NFC");
  stem = [...stem]
    .map((character) =>
      character.codePointAt(0)! <= 0x1f || '<>:"/\\|?*'.includes(character) ? "-" : character,
    )
    .join("")
    .replaceAll(/[ .]+$/g, "");

  if (stem === "" || stem === "." || stem === "..") stem = "document";
  if (WINDOWS_RESERVED_STEM.test(stem)) stem = `_${stem}`;
  return truncateUtf8(stem, MAX_STEM_BYTES);
}

export function cacheDigest(source: MarkdownSource): string {
  const identity =
    source.kind === "file" ? source.canonicalPath : `${source.cwd}\0${source.markdown}`;
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

export function outputPathForSource(source: MarkdownSource, temporaryDirectory = tmpdir()): string {
  const outputName =
    source.kind === "file" ? `${sanitizeOutputStem(source.canonicalPath)}.html` : "stdin.html";
  return join(temporaryDirectory, "mdrunner", cacheDigest(source), outputName);
}

async function safelyUnlink(fileSystem: OutputFileSystem, path: string): Promise<void> {
  try {
    await fileSystem.unlink(path);
  } catch (error) {
    if (!hasNodeCode(error, "ENOENT")) {
      // Cleanup is best-effort because the primary failure remains the useful CLI diagnostic.
    }
  }
}

async function withDestinationQueue<T>(
  destination: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = destinationQueues.get(destination) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  destinationQueues.set(destination, tail);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (destinationQueues.get(destination) === tail) destinationQueues.delete(destination);
  }
}

async function replaceOnWindows(
  fileSystem: OutputFileSystem,
  temporaryPath: string,
  destination: string,
  backupPath: string,
): Promise<void> {
  try {
    await fileSystem.rename(temporaryPath, destination);
    return;
  } catch (error) {
    if (!hasNodeCode(error, "EACCES", "EEXIST", "EPERM")) throw error;
  }

  // Some Windows filesystems refuse rename-over-existing. Keep the completed
  // new file and the previous valid destination as siblings throughout the
  // bounded fallback, and restore the previous file if installation fails.
  await fileSystem.rename(destination, backupPath);
  try {
    await fileSystem.rename(temporaryPath, destination);
  } catch (error) {
    try {
      await fileSystem.rename(backupPath, destination);
    } catch {
      // The original remains complete at backupPath even if an OS-level fault
      // prevents restoration. The caller still reports replacement failure.
    }
    throw error;
  }
  await fileSystem.unlink(backupPath);
}

async function createCompletedTemporaryFile(
  fileSystem: OutputFileSystem,
  directory: string,
  destinationName: string,
  html: string,
  createUniqueId: () => string,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const unique = uniqueComponent(createUniqueId);
    const temporaryPath = join(directory, `.${destinationName}.${process.pid}-${unique}.tmp`);
    let handle: OutputFileHandle;
    try {
      handle = await fileSystem.openExclusive(temporaryPath);
    } catch (error) {
      if (hasNodeCode(error, "EEXIST")) continue;
      throw error;
    }

    let closed = false;
    try {
      await handle.writeFile(html);
      await handle.sync();
      await handle.close();
      closed = true;
      return temporaryPath;
    } catch (error) {
      if (!closed) {
        try {
          await handle.close();
        } catch {
          // Unlink below is still attempted on every failure path.
        }
      }
      await safelyUnlink(fileSystem, temporaryPath);
      throw error;
    }
  }
  throw new Error("Could not allocate a unique output temporary file.");
}

/** Persist a complete document and atomically replace its deterministic cache path. */
export async function writeOutput(
  source: MarkdownSource,
  html: string,
  options: WriteOutputOptions = {},
): Promise<string> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const destination = outputPathForSource(source, options.temporaryDirectory);
  const directory = dirname(destination);
  const createUniqueId = options.createUniqueId ?? randomUUID;
  let temporaryPath: string | undefined;

  try {
    await fileSystem.mkdir(directory);
    temporaryPath = await createCompletedTemporaryFile(
      fileSystem,
      directory,
      basename(destination),
      html,
      createUniqueId,
    );

    await withDestinationQueue(destination, async () => {
      if (
        options.platform === "win32" ||
        (options.platform === undefined && process.platform === "win32")
      ) {
        const backupPath = join(
          directory,
          `.${basename(destination)}.${process.pid}-${uniqueComponent(createUniqueId)}.backup`,
        );
        await replaceOnWindows(fileSystem, temporaryPath!, destination, backupPath);
      } else {
        await fileSystem.rename(temporaryPath!, destination);
      }
      temporaryPath = undefined;
    });
    return destination;
  } catch {
    if (temporaryPath !== undefined) await safelyUnlink(fileSystem, temporaryPath);
    throw outputError(destination);
  }
}
