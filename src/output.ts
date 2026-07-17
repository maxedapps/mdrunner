import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";

import { ExpectedError } from "./errors.ts";
import type { MarkdownSource } from "./source.ts";

const WINDOWS_RESERVED_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_STEM_BYTES = 120;

export interface ReplacementOperations {
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

const replacementOperations: ReplacementOperations = { rename, unlink };

function hasNodeCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

async function safelyUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Cleanup must not replace the primary CLI diagnostic.
  }
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

function uniqueComponent(): string {
  return randomUUID().replaceAll(/[^a-zA-Z0-9_-]/g, "-");
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
  return join(temporaryDirectory, "mdr", cacheDigest(source), outputName);
}

/** Replace a completed sibling while retaining/restoring the previous Windows artifact. */
export async function replaceCompletedFile(
  temporaryPath: string,
  destination: string,
  backupPath: string,
  platform: NodeJS.Platform = process.platform,
  operations: ReplacementOperations = replacementOperations,
): Promise<void> {
  if (platform !== "win32") {
    await operations.rename(temporaryPath, destination);
    return;
  }

  try {
    await operations.rename(temporaryPath, destination);
    return;
  } catch (error) {
    if (!hasNodeCode(error, "EACCES", "EEXIST", "EPERM")) throw error;
  }

  await operations.rename(destination, backupPath);
  try {
    await operations.rename(temporaryPath, destination);
  } catch (error) {
    try {
      await operations.rename(backupPath, destination);
    } catch {
      // The previous complete output remains at backupPath if restoration itself fails.
    }
    throw error;
  }
  await operations.unlink(backupPath);
}

async function writeCompletedSibling(directory: string, destinationName: string, html: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const path = join(directory, `.${destinationName}.${process.pid}-${uniqueComponent()}.tmp`);
    let handle;
    try {
      handle = await open(path, "wx", 0o600);
    } catch (error) {
      if (hasNodeCode(error, "EEXIST")) continue;
      throw error;
    }

    try {
      await handle.writeFile(html);
      await handle.sync();
      await handle.close();
      return path;
    } catch (error) {
      await handle.close().catch(() => undefined);
      await safelyUnlink(path);
      throw error;
    }
  }
  throw new Error("Could not allocate a unique output temporary file.");
}

/** Persist a complete document and atomically replace its deterministic cache path. */
export async function writeOutput(
  source: MarkdownSource,
  html: string,
  temporaryDirectory = tmpdir(),
): Promise<string> {
  const destination = outputPathForSource(source, temporaryDirectory);
  const directory = dirname(destination);
  let temporaryPath: string | undefined;

  try {
    await mkdir(directory, { recursive: true });
    temporaryPath = await writeCompletedSibling(directory, basename(destination), html);
    const backupPath = join(
      directory,
      `.${basename(destination)}.${process.pid}-${uniqueComponent()}.backup`,
    );
    await replaceCompletedFile(temporaryPath, destination, backupPath);
    temporaryPath = undefined;
    return destination;
  } catch {
    if (temporaryPath !== undefined) await safelyUnlink(temporaryPath);
    throw new ExpectedError("Could not write generated HTML.", { label: destination });
  }
}
