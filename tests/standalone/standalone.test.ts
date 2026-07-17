import { expect, test } from "bun:test";
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

const projectRoot = join(import.meta.dir, "../..");
const buildScript = join(projectRoot, "scripts/build.ts");
const fixtureRoot = join(projectRoot, "tests/fixtures/documents");
const artifactName = process.platform === "win32" ? "mdrunner.exe" : "mdrunner";
const artifactPath = join(projectRoot, "dist", artifactName);
const encoder = new TextEncoder();

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function nativeArtifact(): Promise<{ path: string; owned: boolean }> {
  if (await exists(artifactPath)) return { path: artifactPath, owned: false };

  const build = Bun.spawn([process.execPath, buildScript], {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 280_000,
    killSignal: "SIGKILL",
  });
  const stdout = new Response(build.stdout).text();
  const stderr = new Response(build.stderr).text();
  const exitCode = await build.exited;
  if (exitCode !== 0) {
    throw new Error(`Standalone build failed (${exitCode}): ${await stderr}\n${await stdout}`);
  }
  expect(await stderr).toBe("");
  expect(await exists(artifactPath)).toBe(true);
  return { path: artifactPath, owned: true };
}

async function createOpenerShim(root: string): Promise<{
  directory: string;
  capture: string;
  cleanup(): Promise<void>;
}> {
  const directory = join(root, "opener");
  const capture = join(root, "opener-argv.json");
  await mkdir(directory);

  if (process.platform === "win32") {
    const source = join(root, "powershell-shim.ts");
    const executable = join(directory, "powershell.exe");
    await writeFile(
      source,
      `await Bun.write(process.env.MDRUNNER_OPEN_CAPTURE!, JSON.stringify(Bun.argv));\n`,
    );
    const target = process.arch === "arm64" ? "bun-windows-arm64" : "bun-windows-x64";
    const result = await Bun.build({
      entrypoints: [source],
      minify: true,
      compile: { target, outfile: executable, autoloadBunfig: false, autoloadDotenv: false },
    });
    if (!result.success) throw new Error("Could not compile the Windows opener shim");
  } else {
    const executable = join(directory, process.platform === "darwin" ? "open" : "xdg-open");
    await writeFile(
      executable,
      `#!${process.execPath}\nawait Bun.write(process.env.MDRUNNER_OPEN_CAPTURE!, JSON.stringify(Bun.argv.slice(2)));\n`,
    );
    await chmod(executable, 0o700);
  }

  return {
    directory,
    capture,
    cleanup: () => rm(directory, { force: true, recursive: true }),
  };
}

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runExecutable(options: {
  executable: string;
  cwd: string;
  temporaryDirectory: string;
  openerDirectory: string;
  capture: string;
  args?: readonly string[];
  stdin?: string;
}): Promise<RunResult> {
  const child = Bun.spawn([options.executable, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: {
      PATH: options.openerDirectory,
      HOME: join(options.temporaryDirectory, "home"),
      TMPDIR: options.temporaryDirectory,
      TMP: options.temporaryDirectory,
      TEMP: options.temporaryDirectory,
      MDRUNNER_OPEN_CAPTURE: options.capture,
    },
    stdin: options.stdin === undefined ? "ignore" : encoder.encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  return { exitCode: await child.exited, stdout: await stdout, stderr: await stderr };
}

function assertStaticDocument(html: string): void {
  expect(html).toStartWith("<!doctype html>");
  expect(html).toContain('<main class="markdown-body">');
  expect(html).toContain("<table>");
  expect(html).toContain('class="contains-task-list"');
  expect(html.match(/<figure class="mermaid-diagram"/g)).toHaveLength(6);
  expect(html.match(/<svg\b/g)).toHaveLength(6);
  expect(html).toContain('<div class="expressive-code">');
  expect(html).toContain('src="data:image/png;base64,');
  expect(html).toContain('src="data:image/svg+xml;base64,');
  expect(html).not.toContain("purpose: representative source contract");
  expect(html).not.toContain("author: Ada Lovelace");
  expect(html).not.toMatch(/<script\b|<link\b|@import\b|@font-face\b/iu);
  expect(html).not.toMatch(/(?:localhost|127\.0\.0\.1|Bun\.serve|mermaid\.initialize)/u);
  expect(html).not.toContain("assets/pixel.png");
  expect(html).not.toContain("assets/safe.svg");
}

async function assertCapturedOpener(capture: string, expectedUrl: string): Promise<void> {
  const captured = JSON.parse(await readFile(capture, "utf8")) as string[];
  if (process.platform !== "win32") {
    expect(captured).toEqual([expectedUrl]);
    return;
  }

  const firstArgument = captured.indexOf("-NoLogo");
  expect(firstArgument).toBeGreaterThanOrEqual(0);
  const argv = captured.slice(firstArgument);
  expect(argv.slice(0, 5)).toEqual([
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    expect.any(String),
  ]);
  const script = Buffer.from(argv[4]!, "base64").toString("utf16le");
  const encodedUrl = /FromBase64String\('([^']+)'\)/u.exec(script)?.[1];
  expect(encodedUrl).toBeDefined();
  expect(Buffer.from(encodedUrl!, "base64").toString("utf8")).toBe(expectedUrl);
}

async function removeOwnedArtifact(): Promise<void> {
  await rm(artifactPath, { force: true });
  const dist = join(projectRoot, "dist");
  if ((await exists(dist)) && (await readdir(dist)).length === 0)
    await rm(dist, { recursive: true });
}

test("native standalone renders file and stdin outside the repository without node_modules", async () => {
  const artifact = await nativeArtifact();
  const projectNodeModules = join(projectRoot, "node_modules");
  const hiddenNodeModules = join(projectRoot, `.node_modules-standalone-${process.pid}`);
  let nodeModulesHidden = false;

  try {
    await withTemporaryDirectory(async (root) => {
      const isolated = join(root, "isolated runtime");
      const documents = join(isolated, "documents");
      const temporaryDirectory = join(root, "tmp");
      await mkdir(documents, { recursive: true });
      await mkdir(temporaryDirectory);
      await mkdir(join(temporaryDirectory, "home"));
      const executable = join(isolated, artifactName);
      await copyFile(artifact.path, executable);
      if (process.platform !== "win32") await chmod(executable, 0o700);
      await copyFile(join(fixtureRoot, "complete.md"), join(documents, "complete.md"));
      await cp(join(fixtureRoot, "assets"), join(documents, "assets"), { recursive: true });
      const markdown = await readFile(join(documents, "complete.md"), "utf8");
      const opener = await createOpenerShim(root);

      expect(await exists(join(isolated, "node_modules"))).toBe(false);
      expect(await exists(hiddenNodeModules)).toBe(false);
      await rename(projectNodeModules, hiddenNodeModules);
      nodeModulesHidden = true;
      try {
        for (const input of [{ args: ["complete.md"] as const }, { stdin: markdown }]) {
          await rm(opener.capture, { force: true });
          const result = await runExecutable({
            executable,
            cwd: documents,
            temporaryDirectory,
            openerDirectory: opener.directory,
            capture: opener.capture,
            ...input,
          });
          expect(result).toMatchObject({ exitCode: 0, stderr: "" });
          expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(1);
          const outputPath = result.stdout.trim();
          assertStaticDocument(await readFile(outputPath, "utf8"));
          await assertCapturedOpener(opener.capture, pathToFileURL(outputPath).href);
        }
      } finally {
        await rename(hiddenNodeModules, projectNodeModules);
        nodeModulesHidden = false;
        await opener.cleanup();
      }
    });
  } finally {
    if (nodeModulesHidden) await rename(hiddenNodeModules, projectNodeModules);
    if (artifact.owned) await removeOwnedArtifact();
    await rm(join(projectRoot, "scripts/.build-bootstrap.ts"), { force: true });
  }

  expect(await exists(hiddenNodeModules)).toBe(false);
  expect(await exists(join(projectRoot, "scripts/.build-bootstrap.ts"))).toBe(false);
}, 300_000);
