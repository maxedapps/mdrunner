import { describe, expect, test } from "bun:test";
import { access, chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { ExpectedError, errorCodes, formatError, normalizeError } from "../../src/errors.ts";
import {
  HELP_SELECTION,
  readMarkdownSource,
  type SourceFileSystem,
  type StdinBoundary,
} from "../../src/source.ts";
import { createTemporaryDirectory, withTemporaryDirectory } from "../helpers/temp-dir.ts";

const encoder = new TextEncoder();

function stdinBoundary(
  contents: Uint8Array | string,
  options: { tty?: boolean; fail?: boolean } = {},
): StdinBoundary & { reads: number; ttyChecks: number } {
  const bytes = typeof contents === "string" ? encoder.encode(contents) : contents;
  return {
    reads: 0,
    ttyChecks: 0,
    isTTY() {
      this.ttyChecks += 1;
      return options.tty ?? false;
    },
    async readAll() {
      this.reads += 1;
      if (options.fail === true) throw new Error("platform-specific stdin failure");
      return bytes;
    },
  };
}

function expectCode(error: unknown, code: string, message: string): void {
  expect(error).toBeInstanceOf(ExpectedError);
  expect(error).toMatchObject({ code, exitCode: 1, message });
}

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}

describe("source selection", () => {
  test.each(["-h", "--help"])(
    "%s returns the shared help selection without stdin access",
    async (flag) => {
      const stdin = stdinBoundary("ignored", { tty: false });

      const selection = await readMarkdownSource([flag], { stdin });

      expect(selection).toBe(HELP_SELECTION);
      expect(selection).toEqual({ kind: "help" });
      expect(stdin.ttyChecks).toBe(0);
      expect(stdin.reads).toBe(0);
    },
  );

  test.each([
    { args: ["one.md", "two.md"], name: "two paths" },
    { args: ["-h", "one.md"], name: "help plus a path" },
  ])("rejects $name with one stable argument error", async ({ args }) => {
    const stdin = stdinBoundary("ignored");
    const error = await captureFailure(() => readMarkdownSource(args, { stdin }));

    expectCode(
      error,
      errorCodes.invalidArguments,
      "Expected one .md file or piped Markdown; use --help for usage.",
    );
    expect(stdin.ttyChecks).toBe(0);
    expect(stdin.reads).toBe(0);
  });

  test("no arguments on a TTY fails before reading", async () => {
    const stdin = stdinBoundary("must not be read", { tty: true });
    const error = await captureFailure(() => readMarkdownSource([], { stdin }));

    expectCode(
      error,
      errorCodes.sourceRequired,
      "Provide one .md file or pipe Markdown through stdin.",
    );
    expect(stdin.ttyChecks).toBe(1);
    expect(stdin.reads).toBe(0);
  });

  test("a file argument wins without checking or consuming redirected stdin", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "preferred.md");
      await writeFile(path, "# file\n");
      const stdin = stdinBoundary("# stdin\n");

      const selection = await readMarkdownSource([path], { stdin });

      expect(selection).toMatchObject({ kind: "render", source: { markdown: "# file\n" } });
      expect(stdin.ttyChecks).toBe(0);
      expect(stdin.reads).toBe(0);
    });
  });
});

describe("stdin acquisition", () => {
  test("reads complete UTF-8 bytes and records normalized cwd context", async () => {
    const markdown = "# Héllo 世界 👋\n";
    const selection = await readMarkdownSource([], {
      cwd: ".",
      stdin: stdinBoundary(markdown),
    });

    expect(selection).toEqual({
      kind: "render",
      source: {
        kind: "stdin",
        markdown,
        cwd: resolve("."),
        assetBase: resolve("."),
        label: "stdin",
      },
    });
  });

  test.each(["", " ", "\n\t\r", "\u00a0\u2003\n"])(
    "rejects empty or whitespace-only stdin %#",
    async (markdown) => {
      const error = await captureFailure(() =>
        readMarkdownSource([], { stdin: stdinBoundary(markdown) }),
      );
      expectCode(error, errorCodes.emptyStdin, "Piped Markdown is empty.");
      expect(formatError(error)).toBe("stdin: Piped Markdown is empty.");
    },
  );

  test("rejects malformed UTF-8 without replacement characters", async () => {
    const error = await captureFailure(() =>
      readMarkdownSource([], { stdin: stdinBoundary(new Uint8Array([0x66, 0x80, 0x6f])) }),
    );

    expectCode(error, errorCodes.invalidUtf8, "Input is not valid UTF-8.");
    expect(formatError(error)).toBe("stdin: Input is not valid UTF-8.");
  });

  test("normalizes stdin boundary failures", async () => {
    const error = await captureFailure(() =>
      readMarkdownSource([], { stdin: stdinBoundary("ignored", { fail: true }) }),
    );

    expectCode(error, errorCodes.stdinUnreadable, "Could not read Markdown from stdin.");
    expect(formatError(error)).toBe("stdin: Could not read Markdown from stdin.");
  });
});

describe("file acquisition", () => {
  test.each(["document.txt", "markdown", ".mdx", "--unknown"])(
    "rejects unsupported extension %s before filesystem access",
    async (argument) => {
      let realpathCalls = 0;
      const fileSystem: SourceFileSystem = {
        async realpath() {
          realpathCalls += 1;
          return "/unused";
        },
        async stat() {
          return { isFile: () => true };
        },
        async readFile() {
          return encoder.encode("unused");
        },
      };

      const error = await captureFailure(() =>
        readMarkdownSource([argument], { cwd: "/workspace", fileSystem }),
      );

      expectCode(
        error,
        errorCodes.invalidExtension,
        "Expected a Markdown file with a .md extension.",
      );
      expect(formatError(error)).toBe(
        `${resolve("/workspace", argument)}: Expected a Markdown file with a .md extension.`,
      );
      expect(realpathCalls).toBe(0);
    },
  );

  test("accepts a case-insensitive extension and preserves Unicode", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "Résumé 世界.MD");
      const markdown = "# Crème brûlée 🧁\n";
      await writeFile(path, markdown);

      const selection = await readMarkdownSource([path]);
      const canonicalPath = await realpath(path);

      expect(selection).toEqual({
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

  test("resolves relative input, symlinks, and canonical asset context", async () => {
    await withTemporaryDirectory(async (directory) => {
      const sourceDirectory = join(directory, "real source");
      const aliasDirectory = join(directory, "aliases");
      await mkdir(sourceDirectory);
      await mkdir(aliasDirectory);
      const target = join(sourceDirectory, "target.md");
      const alias = join(aliasDirectory, "linked.md");
      await writeFile(target, "# linked\n");
      await symlink(target, alias);

      const selection = await readMarkdownSource(["aliases/linked.md"], { cwd: directory });
      const canonicalPath = await realpath(target);

      expect(selection).toEqual({
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

  test("reports a missing file without platform stack text", async () => {
    await withTemporaryDirectory(async (directory) => {
      const missing = join(directory, "missing.md");
      const error = await captureFailure(() => readMarkdownSource([missing]));

      expectCode(error, errorCodes.fileNotFound, "Markdown file was not found.");
      expect(formatError(error)).toBe(`${missing}: Markdown file was not found.`);
      expect(formatError(error)).not.toContain("ENOENT");
      expect(formatError(error)).not.toContain(" at ");
    });
  });

  test("rejects a directory whose name ends in .md", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "folder.md");
      await mkdir(path);
      const canonicalPath = await realpath(path);

      const error = await captureFailure(() => readMarkdownSource([path]));

      expectCode(error, errorCodes.notRegularFile, "Markdown source is not a regular file.");
      expect(formatError(error)).toBe(`${canonicalPath}: Markdown source is not a regular file.`);
    });
  });

  test("rejects malformed file UTF-8", async () => {
    await withTemporaryDirectory(async (directory) => {
      const path = join(directory, "invalid.md");
      await writeFile(path, new Uint8Array([0xc3, 0x28]));
      const canonicalPath = await realpath(path);

      const error = await captureFailure(() => readMarkdownSource([path]));

      expectCode(error, errorCodes.invalidUtf8, "Input is not valid UTF-8.");
      expect(formatError(error)).toBe(`${canonicalPath}: Input is not valid UTF-8.`);
    });
  });

  test("maps deterministic read failures to a stable unreadable-file error", async () => {
    const canonicalPath = "/canonical/source.md";
    const fileSystem: SourceFileSystem = {
      async realpath() {
        return canonicalPath;
      },
      async stat() {
        return { isFile: () => true };
      },
      async readFile() {
        throw Object.assign(new Error("sensitive platform detail"), { code: "EACCES" });
      },
    };

    const error = await captureFailure(() =>
      readMarkdownSource(["source.md"], { cwd: "/workspace", fileSystem }),
    );

    expectCode(error, errorCodes.fileUnreadable, "Markdown file could not be read.");
    expect(formatError(error)).toBe(`${canonicalPath}: Markdown file could not be read.`);
    expect(formatError(error)).not.toContain("sensitive");
  });

  const permissionsAreEnforced =
    process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
  test.skipIf(!permissionsAreEnforced)(
    "rejects a real file without read permission (skipped where permissions are unreliable)",
    async () => {
      await withTemporaryDirectory(async (directory) => {
        const path = join(directory, "unreadable.md");
        await writeFile(path, "# secret\n");
        await chmod(path, 0o000);
        try {
          const error = await captureFailure(() => readMarkdownSource([path]));
          expectCode(error, errorCodes.fileUnreadable, "Markdown file could not be read.");
        } finally {
          await chmod(path, 0o600);
        }
      });
    },
  );
});

describe("expected error and cleanup foundations", () => {
  test("copies only durable source values and formats line/column without a stack", () => {
    const source = { label: "notes.md", line: 7, column: 3, node: { private: true } };
    const error = new ExpectedError(errorCodes.invalidUtf8, "Invalid content.", source);
    source.label = "mutated.md";
    source.node.private = false;

    expect(error.source).toEqual({ label: "notes.md", line: 7, column: 3 });
    expect(error.source).not.toHaveProperty("node");
    expect(Object.isFrozen(error.source)).toBe(true);
    expect(formatError(error)).toBe("notes.md:7:3: Invalid content.");
    expect(formatError(error)).not.toContain("ExpectedError");
    expect(formatError(error)).not.toContain(" at ");
  });

  test.each([
    { value: new Error("renderer exploded"), message: "renderer exploded" },
    { value: "plain failure", message: "plain failure" },
    { value: { secret: true }, message: "Unexpected error." },
  ])("normalizes unknown failures without retaining the thrown value %#", ({ value, message }) => {
    const normalized = normalizeError(value);

    expect(normalized).toBeInstanceOf(ExpectedError);
    expect(normalized).toMatchObject({ code: errorCodes.unexpected, message, exitCode: 1 });
    expect(normalized).not.toHaveProperty("cause");
    expect(formatError(normalized)).toBe(message);
  });

  test("temporary-directory cleanup is idempotent and removes retained paths", async () => {
    const directory = await createTemporaryDirectory();
    const marker = join(directory.path, "nested", "marker.txt");
    await mkdir(dirname(marker), { recursive: true });
    await writeFile(marker, "temporary");

    await directory.cleanup();
    await directory.cleanup();

    await expect(access(directory.path)).rejects.toBeDefined();
  });

  test("withTemporaryDirectory cleans up when the callback throws", async () => {
    let retainedPath = "";
    await expect(
      withTemporaryDirectory(async (directory) => {
        retainedPath = directory;
        await writeFile(join(directory, "marker"), "temporary");
        throw new Error("test sentinel");
      }),
    ).rejects.toThrow("test sentinel");

    await expect(access(retainedPath)).rejects.toBeDefined();
  });
});
