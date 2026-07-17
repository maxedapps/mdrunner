import { describe, expect, test } from "bun:test";
import { chmod, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { markdownToHtml } from "satteri";

import { ExpectedError, formatError } from "../../src/errors.ts";
import { imageEmbeddingPlugin } from "../../src/plugins/images.ts";
import type { MarkdownSource } from "../../src/source.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

function source(markdown: string, base: string): MarkdownSource {
  return {
    kind: "file",
    markdown,
    canonicalPath: join(base, "document.md"),
    assetBase: base,
    label: join(base, "document.md"),
  };
}

async function failure(markdown: string, base: string): Promise<ExpectedError> {
  try {
    const input = source(markdown, base);
    await markdownToHtml(input.markdown, { hastPlugins: [imageEmbeddingPlugin(input)] });
  } catch (error) {
    expect(error).toBeInstanceOf(ExpectedError);
    return error as ExpectedError;
  }
  throw new Error("Expected image rendering to fail");
}

async function writePng(path: string): Promise<void> {
  await writeFile(path, Buffer.from("iVBORw0KGgoAAAANSUhEUg==", "base64"));
}

describe("local image path containment", () => {
  test("rejects missing files, directories, unsupported types, and mismatched contents", async () => {
    await withTemporaryDirectory(async (base) => {
      await mkdir(join(base, "directory.png"));
      await writeFile(join(base, "notes.txt"), "not an image");
      await writeFile(join(base, "fake.png"), "not a PNG");

      for (const [path, message] of [
        ["missing.png", "not found"],
        ["directory.png", "regular file"],
        ["notes.txt", "not supported"],
        ["fake.png", "do not match"],
      ] as const) {
        const error = await failure(`![asset](${path})\n`, base);
        expect(error.message).toContain(message);
        expect(error.source).toEqual({ label: join(base, "document.md"), line: 1, column: 1 });
      }
    });
  });

  test("rejects lexical traversal and symlink escapes while accepting an internal symlink", async () => {
    await withTemporaryDirectory(async (root) => {
      const base = join(root, "base");
      const outside = join(root, "outside.png");
      await mkdir(base);
      await writePng(outside);
      await writePng(join(base, "inside.png"));
      await symlink(outside, join(base, "escape.png"));
      await symlink(join(base, "inside.png"), join(base, "alias.png"));

      for (const path of ["../outside.png", "%2e%2e/outside.png", "escape.png"]) {
        const error = await failure(`![asset](${path})\n`, base);
        expect(error.message).toMatch(/escapes|outside/u);
      }

      const input = source("![asset](alias.png)\n", base);
      const result = await markdownToHtml(input.markdown, {
        hastPlugins: [imageEmbeddingPlugin(input)],
      });
      expect(result.html).toContain('src="data:image/png;base64,');
    });
  });

  test.each([
    ["data URL", "data:image/png;base64,AAAA"],
    ["file URL", "file:///etc/passwd"],
    ["protocol-relative URL", "//example.test/a.png"],
    ["absolute path", "/tmp/a.png"],
    ["backslash path", "..%5Csecret.png"],
    ["encoded scheme", "dat%61:image/png;base64,AAAA"],
    ["unknown scheme", "blob:https://example.test/id"],
    ["invalid encoding", "image%ZZ.png"],
  ])("defensively rejects %s", async (_label, url) => {
    await withTemporaryDirectory(async (base) => {
      const error = await failure(`![asset](${url})\n`, base);
      expect(error.message).toMatch(/Unsafe image URL|Image path/u);
      expect(error.source?.line).toBe(1);
    });
  });

  test("reports source label and line for an asset failure", async () => {
    await withTemporaryDirectory(async (base) => {
      const error = await failure("paragraph\n\n![missing](missing.png)\n", base);

      expect(error.source).toEqual({ label: join(base, "document.md"), line: 3, column: 1 });
      expect(formatError(error)).toStartWith(`${join(base, "document.md")}:3:1:`);
    });
  });

  const permissionsAreEnforced =
    process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
  test.skipIf(!permissionsAreEnforced)(
    "rejects an unreadable regular file when permissions are enforced",
    async () => {
      await withTemporaryDirectory(async (base) => {
        const path = join(base, "unreadable.png");
        await writePng(path);
        await chmod(path, 0o000);
        try {
          const error = await failure("![asset](unreadable.png)\n", base);
          expect(error.message).toContain("could not be read");
        } finally {
          await chmod(path, 0o600);
        }
      });
    },
  );
});
