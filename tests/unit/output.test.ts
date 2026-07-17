import { describe, expect, test } from "bun:test";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { ExpectedError, errorCodes, formatError } from "../../src/errors.ts";
import {
  cacheDigest,
  outputPathForSource,
  sanitizeOutputStem,
  writeOutput,
  type OutputFileSystem,
} from "../../src/output.ts";
import type { MarkdownSource } from "../../src/source.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

function fileSource(canonicalPath = "/workspace/Notes & Résumé.md"): MarkdownSource {
  return {
    kind: "file",
    markdown: "ignored for file identity",
    canonicalPath,
    assetBase: dirname(canonicalPath),
    label: canonicalPath,
  };
}

function stdinSource(markdown = "# Hello\n", cwd = "/workspace"): MarkdownSource {
  return { kind: "stdin", markdown, cwd, assetBase: cwd, label: "stdin" };
}

function nodeFileSystem(overrides: Partial<OutputFileSystem> = {}): OutputFileSystem {
  return {
    async mkdir(path) {
      await mkdir(path, { recursive: true });
    },
    async openExclusive(path) {
      return open(path, "wx", 0o600);
    },
    rename,
    unlink,
    ...overrides,
  };
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}

describe("deterministic cache paths", () => {
  test("uses the full SHA-256 of a canonical file path and a stable source stem", () => {
    const source = fileSource();

    expect(cacheDigest(source)).toBe(
      "f169b6d85ba7fa48d07076425080cfa1993638e608710cee9ae8e50e6926428c",
    );
    expect(outputPathForSource(source, "/cache root")).toBe(
      join(
        "/cache root",
        "mdrunner",
        "f169b6d85ba7fa48d07076425080cfa1993638e608710cee9ae8e50e6926428c",
        "Notes & Résumé.html",
      ),
    );
    expect(cacheDigest({ ...source, markdown: "changed but irrelevant" })).toBe(
      cacheDigest(source),
    );
  });

  test("separates stdin cwd and contents with NUL and always names it stdin.html", () => {
    const source = stdinSource();

    expect(cacheDigest(source)).toBe(
      "d64fe0560e5c180ebeb11325ff15f1dd4179ff3156bf53e082f36ea290909453",
    );
    expect(outputPathForSource(source, "/cache")).toBe(
      join(
        "/cache",
        "mdrunner",
        "d64fe0560e5c180ebeb11325ff15f1dd4179ff3156bf53e082f36ea290909453",
        "stdin.html",
      ),
    );
    expect(cacheDigest(stdinSource("# Changed\n"))).toBe(
      "349299ba0b94ffa3f6f9989d83116f60593b8078a8d2be77679b5e50c611ac6c",
    );
    expect(cacheDigest(stdinSource("# Hello\n", "/other"))).toBe(
      "5a4f46125d5f02f15776079e5bc48da07ee071780561167ac888f0ebdc07522c",
    );
  });

  test("sanitizes only non-portable stem text deterministically", () => {
    expect(sanitizeOutputStem("/tmp/archive.tar.md")).toBe("archive.tar");
    expect(sanitizeOutputStem("/tmp/bad<name> .md")).toBe("bad-name-");
    expect(sanitizeOutputStem("/tmp/con.md")).toBe("_con");
    expect(sanitizeOutputStem("/tmp/CON.report.md")).toBe("_CON.report");
    expect(sanitizeOutputStem("/tmp/Café.md")).toBe("Café");
    expect(sanitizeOutputStem("/tmp/....md")).toBe("document");
    expect(sanitizeOutputStem(`/tmp/${"é".repeat(100)}.md`)).toBe("é".repeat(60));
  });
});

describe("atomic output persistence", () => {
  test("reuses and completely replaces one destination without sibling residue", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = fileSource(join(temporaryDirectory, "source.md"));
      const first = "<!doctype html><p>first document</p>";
      const second = "<!doctype html><p>second document is longer</p>";

      const firstPath = await writeOutput(source, first, { temporaryDirectory });
      const secondPath = await writeOutput(source, second, { temporaryDirectory });

      expect(secondPath).toBe(firstPath);
      expect(await readFile(firstPath, "utf8")).toBe(second);
      expect(await readdir(dirname(firstPath))).toEqual([basename(firstPath)]);
    });
  });

  test("coordinates concurrent complete writers and never exposes a partial candidate", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = stdinSource("same identity", temporaryDirectory);
      const destination = await writeOutput(source, "old-complete", { temporaryDirectory });
      const candidateA = `A:${"a".repeat(128_000)}:end-A`;
      const candidateB = `B:${"b".repeat(128_000)}:end-B`;
      let synchronized = 0;
      let releaseWrites!: () => void;
      let reportSynchronized!: () => void;
      const writeGate = new Promise<void>((resolve) => {
        releaseWrites = resolve;
      });
      const bothSynchronized = new Promise<void>((resolve) => {
        reportSynchronized = resolve;
      });
      const fileSystem = nodeFileSystem({
        async openExclusive(path) {
          const handle = await open(path, "wx", 0o600);
          return {
            writeFile: (contents) => handle.writeFile(contents),
            async sync() {
              await handle.sync();
              synchronized += 1;
              if (synchronized === 2) reportSynchronized();
              await writeGate;
            },
            close: () => handle.close(),
          };
        },
        async rename(from, to) {
          await rename(from, to);
          await Bun.sleep(5);
        },
      });

      const writes = Promise.all([
        writeOutput(source, candidateA, { fileSystem, temporaryDirectory }),
        writeOutput(source, candidateB, { fileSystem, temporaryDirectory }),
      ]);
      await bothSynchronized;
      expect(await readFile(destination, "utf8")).toBe("old-complete");

      const observed = new Set<string>();
      let observing = true;
      const observer = (async () => {
        while (observing) {
          const contents = await readFile(destination, "utf8");
          expect(["old-complete", candidateA, candidateB]).toContain(contents);
          observed.add(contents);
          await Bun.sleep(1);
        }
      })();
      releaseWrites();
      await writes;
      observing = false;
      await observer;

      expect([candidateA, candidateB]).toContain(await readFile(destination, "utf8"));
      expect(observed.size).toBeGreaterThan(0);
      expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
    });
  });

  test("flushes and closes before replacement and cleans a temp after replacement failure", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = fileSource(join(temporaryDirectory, "ordered.md"));
      const destination = await writeOutput(source, "last valid", { temporaryDirectory });
      const operations: string[] = [];
      const fileSystem = nodeFileSystem({
        async openExclusive(path) {
          operations.push("open");
          const handle = await open(path, "wx", 0o600);
          return {
            async writeFile(contents) {
              operations.push("write");
              await handle.writeFile(contents);
            },
            async sync() {
              operations.push("sync");
              await handle.sync();
            },
            async close() {
              operations.push("close");
              await handle.close();
            },
          };
        },
        async rename() {
          operations.push("rename");
          throw codedError("EIO");
        },
        async unlink(path) {
          operations.push("unlink");
          await unlink(path);
        },
      });

      const failure = writeOutput(source, "new complete", { fileSystem, temporaryDirectory });
      await expect(failure).rejects.toMatchObject({
        code: errorCodes.outputWriteFailed,
        message: "Could not write generated HTML.",
      });
      expect(operations).toEqual(["open", "write", "sync", "close", "rename", "unlink"]);
      expect(await readFile(destination, "utf8")).toBe("last valid");
      expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
    });
  });

  test("cleans a partially written temp when writing fails", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = stdinSource("write failure", temporaryDirectory);
      const fileSystem = nodeFileSystem({
        async openExclusive(path) {
          const handle = await open(path, "wx", 0o600);
          return {
            async writeFile(contents) {
              await handle.writeFile(contents.slice(0, 4));
              throw codedError("ENOSPC");
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      });

      const error = await captureFailure(() =>
        writeOutput(source, "complete candidate", { fileSystem, temporaryDirectory }),
      );
      expect(error).toBeInstanceOf(ExpectedError);
      const destination = outputPathForSource(source, temporaryDirectory);
      expect(formatError(error)).toBe(`${destination}: Could not write generated HTML.`);
      expect(await readdir(dirname(destination))).toEqual([]);
    });
  });

  test("uses a completed sibling and backup for Windows replacement", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = fileSource(join(temporaryDirectory, "windows.md"));
      const destination = await writeOutput(source, "previous valid", { temporaryDirectory });
      let installAttempts = 0;
      const operations: string[] = [];
      const fileSystem = nodeFileSystem({
        async rename(from, to) {
          if (to === destination && from.endsWith(".tmp")) {
            installAttempts += 1;
            operations.push(`install-${installAttempts}`);
            if (installAttempts === 1) throw codedError("EEXIST");
          } else if (from === destination) {
            operations.push("preserve-old");
            expect(await readFile(from, "utf8")).toBe("previous valid");
          }
          await rename(from, to);
        },
        async unlink(path) {
          operations.push("remove-backup");
          await unlink(path);
        },
      });

      await writeOutput(source, "new complete", {
        fileSystem,
        platform: "win32",
        temporaryDirectory,
      });

      expect(operations).toEqual(["install-1", "preserve-old", "install-2", "remove-backup"]);
      expect(await readFile(destination, "utf8")).toBe("new complete");
      expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
    });
  });

  test("restores the last valid Windows destination when fallback installation fails", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = fileSource(join(temporaryDirectory, "windows-rollback.md"));
      const destination = await writeOutput(source, "previous valid", { temporaryDirectory });
      let installAttempts = 0;
      const fileSystem = nodeFileSystem({
        async rename(from, to) {
          if (to === destination && from.endsWith(".tmp")) {
            installAttempts += 1;
            throw codedError(installAttempts === 1 ? "EEXIST" : "EACCES");
          }
          await rename(from, to);
        },
      });

      await expect(
        writeOutput(source, "new complete", {
          fileSystem,
          platform: "win32",
          temporaryDirectory,
        }),
      ).rejects.toMatchObject({ code: errorCodes.outputWriteFailed });

      expect(await readFile(destination, "utf8")).toBe("previous valid");
      expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
    });
  });
});
