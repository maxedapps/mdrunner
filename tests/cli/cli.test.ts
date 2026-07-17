import { describe, expect, test } from "bun:test";
import { access, chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { USAGE_TEXT } from "../../src/main.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

const cliPath = join(import.meta.dir, "../../src/cli.ts");
const encoder = new TextEncoder();
const openerName =
  process.platform === "darwin"
    ? "open"
    : process.platform === "linux"
      ? "xdg-open"
      : "powershell.exe";

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMilliseconds: number;
}

async function makeOpenerShim(root: string): Promise<{
  readonly directory: string;
  readonly capture: string;
}> {
  const directory = join(root, "opener shim");
  const capture = join(root, "opened URL.txt");
  await mkdir(directory);
  const executable = join(directory, openerName);
  await writeFile(
    executable,
    '#!/bin/sh\nprintf "%s\\ncomplete\\n" "$1" > "$MDRUNNER_OPEN_CAPTURE"\nexit "${MDRUNNER_OPEN_EXIT:-0}"\n',
  );
  await chmod(executable, 0o700);
  return { directory, capture };
}

async function runCli(options: {
  readonly cwd: string;
  readonly args?: readonly string[];
  readonly stdin?: string;
  readonly shimDirectory?: string;
  readonly capture?: string;
  readonly openerExit?: number;
}): Promise<CliResult> {
  const started = performance.now();
  const path =
    options.shimDirectory === undefined
      ? process.env.PATH
      : `${options.shimDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  const child = Bun.spawn([process.execPath, cliPath, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: {
      ...process.env,
      PATH: path,
      ...(options.capture === undefined ? {} : { MDRUNNER_OPEN_CAPTURE: options.capture }),
      ...(options.openerExit === undefined
        ? {}
        : { MDRUNNER_OPEN_EXIT: String(options.openerExit) }),
    },
    stdin: options.stdin === undefined ? "ignore" : encoder.encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const exitCode = await child.exited;
  return {
    exitCode,
    stdout: await stdout,
    stderr: await stderr,
    elapsedMilliseconds: performance.now() - started,
  };
}

async function cleanupGeneratedOutput(stdout: string): Promise<void> {
  const outputPath = stdout.trim();
  if (outputPath !== "") await rm(dirname(outputPath), { force: true, recursive: true });
}

async function captureDoesNotExist(path: string): Promise<void> {
  await expect(access(path)).rejects.toBeDefined();
}

const supportsPosixShim = process.platform === "darwin" || process.platform === "linux";

describe("CLI subprocess contract", () => {
  test.skipIf(!supportsPosixShim)(
    "renders a relative symlink path containing spaces and Unicode and opens its exact file URL",
    async () => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        const realDirectory = join(root, "real documents");
        await mkdir(realDirectory);
        const sourcePath = join(realDirectory, "Résumé 世界.md");
        const aliasPath = join(root, "linked document.md");
        await writeFile(sourcePath, "# File success\n\nA complete document.\n");
        await symlink(sourcePath, aliasPath);

        const result = await runCli({
          cwd: root,
          args: ["linked document.md"],
          shimDirectory: directory,
          capture,
        });

        try {
          expect(result.exitCode).toBe(0);
          expect(result.stderr).toBe("");
          expect(result.stdout).toEndWith("Résumé 世界.html\n");
          const outputPath = result.stdout.trim();
          const html = await readFile(outputPath, "utf8");
          expect(html).toStartWith("<!doctype html>");
          expect(html).toContain("<title>File success</title>");
          expect(html).toContain('<main class="markdown-body">');
          expect(await readFile(capture, "utf8")).toBe(
            `${pathToFileURL(outputPath).href}\ncomplete\n`,
          );
          expect(result.elapsedMilliseconds).toBeLessThan(20_000);
        } finally {
          await cleanupGeneratedOutput(result.stdout);
        }
      });
    },
    25_000,
  );

  test.skipIf(!supportsPosixShim)(
    "renders piped stdin, prints one path, and exits",
    async () => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        const result = await runCli({
          cwd: root,
          stdin: "# Piped success\n\n- [x] static\n",
          shimDirectory: directory,
          capture,
        });

        try {
          expect(result.exitCode).toBe(0);
          expect(result.stderr).toBe("");
          expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1);
          const outputPath = result.stdout.trim();
          expect(outputPath).toEndWith("stdin.html");
          expect(await readFile(outputPath, "utf8")).toContain("<title>Piped success</title>");
          expect(await readFile(capture, "utf8")).toBe(
            `${pathToFileURL(outputPath).href}\ncomplete\n`,
          );
        } finally {
          await cleanupGeneratedOutput(result.stdout);
        }
      });
    },
    25_000,
  );

  test.each(["-h", "--help"])(
    "prints shared usage for %s without invoking an opener",
    async (flag) => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        const result = await runCli({
          cwd: root,
          args: [flag],
          shimDirectory: directory,
          capture,
        });

        expect(result).toMatchObject({ exitCode: 0, stdout: `${USAGE_TEXT}\n`, stderr: "" });
        await captureDoesNotExist(capture);
      });
    },
  );

  test.skipIf(!supportsPosixShim)(
    "gives a file argument precedence over redirected stdin",
    async () => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        await writeFile(join(root, "preferred.md"), "# Preferred file\n");
        const result = await runCli({
          cwd: root,
          args: ["preferred.md"],
          stdin: "```mermaid\nunsupported\n```\n",
          shimDirectory: directory,
          capture,
        });

        try {
          expect(result.exitCode).toBe(0);
          expect(await readFile(result.stdout.trim(), "utf8")).toContain(
            "<title>Preferred file</title>",
          );
          expect(await readFile(capture, "utf8")).toStartWith("file://");
        } finally {
          await cleanupGeneratedOutput(result.stdout);
        }
      });
    },
    25_000,
  );

  test.skipIf(!supportsPosixShim)(
    "reports render and input errors once and never opens a browser",
    async () => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        await writeFile(join(root, "broken.md"), "```mermaid\nmindmap\n root((x))\n```\n");

        const renderFailure = await runCli({
          cwd: root,
          args: ["broken.md"],
          shimDirectory: directory,
          capture,
        });
        expect(renderFailure.exitCode).toBe(1);
        expect(renderFailure.stdout).toBe("");
        expect(renderFailure.stderr).toContain(
          "broken.md:1:1: Unsupported or invalid Mermaid diagram header.\n",
        );
        expect(renderFailure.stderr.split("\n").filter(Boolean)).toHaveLength(1);
        await captureDoesNotExist(capture);

        const missingFailure = await runCli({
          cwd: root,
          args: ["missing.md"],
          shimDirectory: directory,
          capture,
        });
        expect(missingFailure.exitCode).toBe(1);
        expect(missingFailure.stdout).toBe("");
        expect(missingFailure.stderr).toEndWith("Markdown file was not found.\n");
        await captureDoesNotExist(capture);
      });
    },
    25_000,
  );

  test.skipIf(!supportsPosixShim)(
    "retains and prints completed output when the opener fails",
    async () => {
      await withTemporaryDirectory(async (root) => {
        const { directory, capture } = await makeOpenerShim(root);
        await writeFile(join(root, "open failure.md"), "# Retained output\n");
        const result = await runCli({
          cwd: root,
          args: ["open failure.md"],
          shimDirectory: directory,
          capture,
          openerExit: 17,
        });

        try {
          expect(result.exitCode).toBe(1);
          expect(result.stdout).toEndWith("open failure.html\n");
          expect(result.stderr).toBe("Default browser opener exited with status 17.\n");
          const outputPath = result.stdout.trim();
          expect(await readFile(outputPath, "utf8")).toContain("<title>Retained output</title>");
          expect(await readFile(capture, "utf8")).toBe(
            `${pathToFileURL(outputPath).href}\ncomplete\n`,
          );
        } finally {
          await cleanupGeneratedOutput(result.stdout);
        }
      });
    },
    25_000,
  );
});

test.skipIf(process.platform === "win32")(
  "no-argument interactive PTY fails immediately without an opener or lingering process",
  async () => {
    await withTemporaryDirectory(async (root) => {
      const { directory, capture } = await makeOpenerShim(root);
      let output = "";
      const decoder = new TextDecoder();
      const child = Bun.spawn([process.execPath, cliPath], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ""}`,
          MDRUNNER_OPEN_CAPTURE: capture,
        },
        terminal: {
          cols: 80,
          rows: 24,
          data(_terminal, bytes) {
            output += decoder.decode(bytes, { stream: true });
          },
        },
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const exitCode = await Promise.race([
          child.exited,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("CLI PTY did not exit within 5 seconds")),
              5_000,
            );
          }),
        ]);
        output += decoder.decode();
        const plainOutput = output
          .replaceAll("\r", "")
          .replaceAll("\u001B[31m", "")
          .replaceAll("\u001B[0m", "");
        expect(exitCode).toBe(1);
        expect(plainOutput).toContain("Provide one .md file or pipe Markdown through stdin.\n");
        await captureDoesNotExist(capture);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        child.terminal?.close();
        if (child.exitCode === null) child.kill("SIGKILL");
        await child.exited.catch(() => undefined);
      }
    });
  },
  10_000,
);
