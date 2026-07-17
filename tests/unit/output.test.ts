import { describe, expect, test } from "bun:test";
import { readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { ExpectedError, formatError } from "../../src/errors.ts";
import {
  cacheDigest,
  outputPathForSource,
  replaceCompletedFile,
  sanitizeOutputStem,
  writeOutput,
  type ReplacementOperations,
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

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe("deterministic cache paths", () => {
  test("uses the full source identity hash and portable output names", () => {
    const file = fileSource();
    expect(cacheDigest(file)).toBe(
      "f169b6d85ba7fa48d07076425080cfa1993638e608710cee9ae8e50e6926428c",
    );
    expect(outputPathForSource(file, "/cache root")).toBe(
      join(
        "/cache root",
        "mdr",
        "f169b6d85ba7fa48d07076425080cfa1993638e608710cee9ae8e50e6926428c",
        "Notes & Résumé.html",
      ),
    );
    expect(cacheDigest({ ...file, markdown: "changed" })).toBe(cacheDigest(file));

    const stdin = stdinSource();
    expect(cacheDigest(stdin)).toBe(
      "d64fe0560e5c180ebeb11325ff15f1dd4179ff3156bf53e082f36ea290909453",
    );
    expect(outputPathForSource(stdin, "/cache")).toEndWith(join("stdin.html"));
    expect(cacheDigest(stdinSource("# Changed\n"))).not.toBe(cacheDigest(stdin));
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
  test("writes, reuses, and completely replaces one deterministic destination", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = fileSource(join(temporaryDirectory, "source.md"));
      const firstPath = await writeOutput(source, "first complete", temporaryDirectory);
      const secondPath = await writeOutput(source, "second complete", temporaryDirectory);

      expect(secondPath).toBe(firstPath);
      expect(await readFile(firstPath, "utf8")).toBe("second complete");
      expect(await readdir(dirname(firstPath))).toEqual([basename(firstPath)]);
    });
  });

  test("concurrent writers leave exactly one complete candidate and no siblings", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const source = stdinSource("same identity", temporaryDirectory);
      const candidateA = `A:${"a".repeat(128_000)}:end-A`;
      const candidateB = `B:${"b".repeat(128_000)}:end-B`;
      const [destination] = await Promise.all([
        writeOutput(source, candidateA, temporaryDirectory),
        writeOutput(source, candidateB, temporaryDirectory),
      ]);

      expect([candidateA, candidateB]).toContain(await readFile(destination, "utf8"));
      expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
    });
  });

  test("maps a real filesystem failure without leaving a generated tree", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
      const unusableRoot = join(temporaryDirectory, "not-a-directory");
      await writeFile(unusableRoot, "file");
      const source = fileSource(join(temporaryDirectory, "source.md"));

      let error: unknown;
      try {
        await writeOutput(source, "complete", unusableRoot);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(ExpectedError);
      expect(formatError(error)).toEndWith(": Could not write generated HTML.");
      expect(await readdir(temporaryDirectory)).toEqual(["not-a-directory"]);
    });
  });
});

describe("Windows completed-file replacement", () => {
  test("uses a backup when rename-over-existing is refused", async () => {
    await withTemporaryDirectory(async (directory) => {
      const temporary = join(directory, "candidate.tmp");
      const destination = join(directory, "mdr.exe");
      const backup = join(directory, "backup.exe");
      await writeFile(temporary, "new complete");
      await writeFile(destination, "previous valid");
      let installs = 0;
      const operations: ReplacementOperations = {
        async rename(from, to) {
          if (from === temporary && to === destination && ++installs === 1) {
            throw codedError("EEXIST");
          }
          await rename(from, to);
        },
        unlink,
      };

      await replaceCompletedFile(temporary, destination, backup, "win32", operations);
      expect(await readFile(destination, "utf8")).toBe("new complete");
      expect(await readdir(directory)).toEqual(["mdr.exe"]);
    });
  });

  test("restores the prior destination when installation fails", async () => {
    await withTemporaryDirectory(async (directory) => {
      const temporary = join(directory, "candidate.tmp");
      const destination = join(directory, "mdr.exe");
      const backup = join(directory, "backup.exe");
      await writeFile(temporary, "new complete");
      await writeFile(destination, "previous valid");
      let installs = 0;
      const operations: ReplacementOperations = {
        async rename(from, to) {
          if (from === temporary && to === destination) {
            installs += 1;
            throw codedError(installs === 1 ? "EEXIST" : "EACCES");
          }
          await rename(from, to);
        },
        unlink,
      };

      await expect(
        replaceCompletedFile(temporary, destination, backup, "win32", operations),
      ).rejects.toThrow("EACCES");
      expect(await readFile(destination, "utf8")).toBe("previous valid");
      expect(await readFile(temporary, "utf8")).toBe("new complete");
      expect(await readdir(directory)).toEqual(["candidate.tmp", "mdr.exe"]);
    });
  });
});
