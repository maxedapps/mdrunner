import { describe, expect, test } from "bun:test";
import { access, chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ExpectedError, formatError, normalizeError } from "../../src/errors.ts";
import { HELP_SELECTION, readMarkdownSource } from "../../src/source.ts";
import { createTemporaryDirectory, withTemporaryDirectory } from "../helpers/temp-dir.ts";

async function captureFailure(run: () => Promise<unknown>): Promise<ExpectedError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected operation to fail");
}

describe("source selection", () => {
  test.each(["-h", "--help"])("%s returns the shared help selection", async (flag) => {
    expect(await readMarkdownSource([flag])).toBe(HELP_SELECTION);
  });

  test.each([
    ["two paths", ["one.md", "two.md"]],
    ["help plus a path", ["-h", "one.md"]],
  ])("rejects %s", async (_name, args) => {
    const error = await captureFailure(() => readMarkdownSource(args));
    expect(error.message).toBe("Expected one .md file or piped Markdown; use --help for usage.");
  });
});

describe("file acquisition", () => {
  test.each(["document.txt", "markdown", ".mdx", "--unknown"])(
    "rejects unsupported extension %s",
    async (argument) => {
      const error = await captureFailure(() => readMarkdownSource([argument]));
      expect(error.message).toBe("Expected a Markdown file with a .md extension.");
      expect(formatError(error)).toEndWith("Expected a Markdown file with a .md extension.");
    },
  );

  test("accepts a case-insensitive extension and preserves Unicode", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "Résumé 世界.MD");
      const markdown = "# Crème brûlée 🧁\n";
      await writeFile(path, markdown);
      const canonicalPath = await realpath(path);

      expect(await readMarkdownSource([path])).toEqual({
        kind: "render",
        source: {
          kind: "file",
          markdown,
          canonicalPath,
          assetBase: dirname(canonicalPath),
          label: canonicalPath,
        },
      });
    });
  });

  test("resolves symlinks and records canonical asset context", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourceDirectory = join(directory, "real source");
      await mkdir(sourceDirectory);
      const target = join(sourceDirectory, "target.md");
      const alias = join(directory, "linked.md");
      await writeFile(target, "# linked\n");
      await symlink(target, alias);
      const canonicalPath = await realpath(target);

      expect(await readMarkdownSource([alias])).toEqual({
        kind: "render",
        source: {
          kind: "file",
          markdown: "# linked\n",
          canonicalPath,
          assetBase: dirname(canonicalPath),
          label: canonicalPath,
        },
      });
    });
  });

  test("reports missing files, directories, and malformed UTF-8 concisely", async () => {
    await withTemporaryDirectory(async (directory) => {
      const missing = join(directory, "missing.md");
      const missingError = await captureFailure(() => readMarkdownSource([missing]));
      expect(formatError(missingError)).toBe(`${missing}: Markdown file was not found.`);

      const folder = join(directory, "folder.md");
      await mkdir(folder);
      const folderError = await captureFailure(() => readMarkdownSource([folder]));
      expect(folderError.message).toBe("Markdown source is not a regular file.");

      const invalid = join(directory, "invalid.md");
      await writeFile(invalid, new Uint8Array([0xc3, 0x28]));
      const invalidError = await captureFailure(() => readMarkdownSource([invalid]));
      expect(formatError(invalidError)).toBe(
        `${await realpath(invalid)}: Input is not valid UTF-8.`,
      );
    });
  });

  const permissionsAreEnforced =
    process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
  test.skipIf(!permissionsAreEnforced)("rejects a real unreadable file", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "unreadable.md");
      await writeFile(path, "# secret\n");
      await chmod(path, 0o000);
      try {
        expect((await captureFailure(() => readMarkdownSource([path]))).message).toBe(
          "Markdown file could not be read.",
        );
      } finally {
        await chmod(path, 0o600);
      }
    });
  });
});

describe("expected errors and temporary cleanup", () => {
  test("copies source values and formats line and column without a stack", () => {
    const source = { label: "notes.md", line: 7, column: 3 };
    const error = new ExpectedError("Invalid content.", source);
    source.label = "mutated.md";

    expect(error.source).toEqual({ label: "notes.md", line: 7, column: 3 });
    expect(Object.isFrozen(error.source)).toBe(true);
    expect(formatError(error)).toBe("notes.md:7:3: Invalid content.");
    expect(formatError(error)).not.toContain(" at ");
  });

  test.each([
    [new Error("renderer exploded"), "renderer exploded"],
    ["plain failure", "plain failure"],
    [{ secret: true }, "Unexpected error."],
  ])("normalizes unknown failures %#", (value, message) => {
    const normalized = normalizeError(value);
    expect(normalized).toBeInstanceOf(ExpectedError);
    expect(normalized.message).toBe(message);
    expect(normalized).not.toHaveProperty("cause");
  });

  test("temporary-directory cleanup is idempotent and handles callback failure", async () => {
    const directory = await createTemporaryDirectory();
    await writeFile(join(directory.path, "marker"), "temporary");
    await directory.cleanup();
    await directory.cleanup();
    await expect(access(directory.path)).rejects.toBeDefined();

    let retainedPath = "";
    await expect(
      withTemporaryDirectory(async (path) => {
        retainedPath = path;
        throw new Error("test sentinel");
      }),
    ).rejects.toThrow("test sentinel");
    await expect(access(retainedPath)).rejects.toBeDefined();
  });
});
