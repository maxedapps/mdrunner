import { describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BuildError,
  createBootstrapSource,
  detectHostTarget,
  detectLinuxLibc,
  parseBuildArguments,
  publishArtifact,
  resolveAddon,
  runOwnedBuild,
  supportedBuildTargets,
  targetArtifactFile,
  targetConfig,
  type PublishOperations,
  type SupportedBuildTarget,
} from "../../scripts/build.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

const EXPECTED_TARGETS = {
  "bun-darwin-arm64":
    "@bruits/satteri-darwin-arm64|satteri_napi.darwin-arm64.node|mdrunner|mdrunner-darwin-arm64",
  "bun-darwin-x64":
    "@bruits/satteri-darwin-x64|satteri_napi.darwin-x64.node|mdrunner|mdrunner-darwin-x64",
  "bun-linux-arm64":
    "@bruits/satteri-linux-arm64-gnu|satteri_napi.linux-arm64-gnu.node|mdrunner|mdrunner-linux-arm64",
  "bun-linux-arm64-musl":
    "@bruits/satteri-linux-arm64-musl|satteri_napi.linux-arm64-musl.node|mdrunner|mdrunner-linux-arm64-musl",
  "bun-linux-x64":
    "@bruits/satteri-linux-x64-gnu|satteri_napi.linux-x64-gnu.node|mdrunner|mdrunner-linux-x64",
  "bun-linux-x64-musl":
    "@bruits/satteri-linux-x64-musl|satteri_napi.linux-x64-musl.node|mdrunner|mdrunner-linux-x64-musl",
  "bun-windows-arm64":
    "@bruits/satteri-win32-arm64-msvc|satteri_napi.win32-arm64-msvc.node|mdrunner.exe|mdrunner-windows-arm64.exe",
  "bun-windows-x64":
    "@bruits/satteri-win32-x64-msvc|satteri_napi.win32-x64-msvc.node|mdrunner.exe|mdrunner-windows-x64.exe",
} as const satisfies Record<SupportedBuildTarget, string>;

async function fixturePaths(root: string) {
  const scripts = join(root, "scripts");
  const dist = join(root, "dist");
  await mkdir(scripts);
  await mkdir(dist);
  return {
    scripts,
    dist,
    paths: {
      bootstrapPath: join(scripts, ".build-bootstrap.ts"),
      bootstrapSource: createBootstrapSource("/addon.node", "/cli.ts"),
      stagingPath: join(dist, ".mdrunner-staging"),
      outputPath: join(dist, "mdrunner"),
      backupPath: join(dist, ".mdrunner-backup"),
      alternateOutputPath: join(dist, "mdrunner.exe"),
    },
  };
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

describe("standalone target selection", () => {
  test("maps exactly eight targets to matching addons and distinct artifact names", () => {
    expect(supportedBuildTargets).toEqual(Object.keys(EXPECTED_TARGETS) as SupportedBuildTarget[]);
    for (const target of supportedBuildTargets) {
      const config = targetConfig(target);
      expect(
        [config.packageName, config.addonFile, config.outputFile, targetArtifactFile(target)].join(
          "|",
        ),
      ).toBe(EXPECTED_TARGETS[target]);
      expect(config.bunTarget).toBe(target);
      expect(parseBuildArguments([target])).toBe(target);
    }
  });

  test("maps hosts and classifies only unambiguous Linux libc evidence", () => {
    expect(detectHostTarget({ platform: "darwin", arch: "arm64" })).toBe("bun-darwin-arm64");
    expect(detectHostTarget({ platform: "darwin", arch: "x64" })).toBe("bun-darwin-x64");
    expect(detectHostTarget({ platform: "win32", arch: "arm64" })).toBe("bun-windows-arm64");
    expect(detectHostTarget({ platform: "linux", arch: "x64", linuxLibc: "gnu" })).toBe(
      "bun-linux-x64",
    );
    expect(detectHostTarget({ platform: "linux", arch: "aarch64", linuxLibc: "musl" })).toBe(
      "bun-linux-arm64-musl",
    );
    expect(() => detectHostTarget({ platform: "linux", arch: "x64" })).toThrow(
      "determine Linux libc",
    );
    expect(() => detectHostTarget({ platform: "freebsd", arch: "x64" })).toThrow("host platform");
    expect(() => detectHostTarget({ platform: "darwin", arch: "ia32" })).toThrow("architecture");
    expect(detectLinuxLibc({ header: { glibcVersionRuntime: "2.39" } })).toBe("gnu");
    expect(detectLinuxLibc({ sharedObjects: ["/lib/ld-musl-aarch64.so.1"] })).toBe("musl");
    expect(detectLinuxLibc(undefined, "musl libc (x86_64)")).toBe("musl");
    expect(detectLinuxLibc(undefined, "ldd (GNU libc) 2.39")).toBe("gnu");
    expect(
      detectLinuxLibc({ header: { glibcVersionRuntime: "2.39" } }, "musl libc"),
    ).toBeUndefined();
    expect(detectLinuxLibc(undefined, "unknown ldd")).toBeUndefined();
  });

  test("accepts zero or one exact own target key", () => {
    expect(parseBuildArguments([])).toBeUndefined();
    for (const invalid of [
      "linux-x64",
      " bun-linux-x64",
      "",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      expect(() => parseBuildArguments([invalid])).toThrow(
        `unsupported target ${JSON.stringify(invalid)}`,
      );
    }
    expect(() => parseBuildArguments(["bun-darwin-arm64", "extra"])).toThrow("zero or one");
  });
});

describe("bootstrap and owned build lifecycle", () => {
  test("embeds the addon before the awaited literal CLI import", () => {
    const addon = '/tmp/native path/quote" slash\\ newline\n/satteri.node';
    const cli = '/tmp/source path/quote" slash\\ newline\n/cli.ts';
    const source = createBootstrapSource(addon, cli);
    const importLine = `import addonPath from ${JSON.stringify(addon)} with { type: "file" };`;
    const envLine = "process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;";
    const cliLine = `await import(${JSON.stringify(cli)});`;
    expect(source.indexOf(importLine)).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(importLine)).toBeLessThan(source.indexOf(envLine));
    expect(source.indexOf(envLine)).toBeLessThan(source.indexOf(cliLine));
    expect(source.match(/with \{ type: "file" \}/g)).toHaveLength(1);
  });

  test("publishes a complete artifact and removes owned or opposite-target files", async () => {
    await withTemporaryDirectory(async (root) => {
      const { scripts, dist, paths } = await fixturePaths(root);
      await writeFile(paths.outputPath, "old complete");
      await writeFile(paths.alternateOutputPath, "other target");
      await runOwnedBuild(paths, async () => {
        expect(await readFile(paths.bootstrapPath, "utf8")).toBe(paths.bootstrapSource);
        await writeFile(paths.stagingPath, "new complete");
      });
      expect(await readFile(paths.outputPath, "utf8")).toBe("new complete");
      expect(await readdir(scripts)).toEqual([]);
      expect(await readdir(dist)).toEqual(["mdrunner"]);
    });
  });

  test("cleans partial staging while retaining a prior artifact after compiler failure", async () => {
    await withTemporaryDirectory(async (root) => {
      const { scripts, dist, paths } = await fixturePaths(root);
      await writeFile(paths.outputPath, "last valid");
      await expect(
        runOwnedBuild(paths, async () => {
          await writeFile(paths.stagingPath, "partial");
          throw new BuildError("compiler probe failed");
        }),
      ).rejects.toThrow("build: compiler probe failed");
      expect(await readFile(paths.outputPath, "utf8")).toBe("last valid");
      expect(await readdir(scripts)).toEqual([]);
      expect(await readdir(dist)).toEqual(["mdrunner"]);
    });
  });

  test("does not overwrite or remove another build's fixed bootstrap", async () => {
    await withTemporaryDirectory(async (root) => {
      const { paths } = await fixturePaths(root);
      await writeFile(paths.bootstrapPath, "other build");
      let compiled = false;
      await expect(
        runOwnedBuild(paths, async () => {
          compiled = true;
        }),
      ).rejects.toThrow("could not create temporary bootstrap");
      expect(compiled).toBe(false);
      expect(await readFile(paths.bootstrapPath, "utf8")).toBe("other build");
    });
  });

  test("fails before creating build material when the selected addon is absent", async () => {
    await withTemporaryDirectory(async (root) => {
      await expect(resolveAddon(root, "bun-windows-x64")).rejects.toThrow(
        "native addon missing for bun-windows-x64",
      );
      expect(await Bun.file(join(root, "dist")).exists()).toBe(false);
    });
  });
});

test("Windows publication restores the prior artifact when installation fails", async () => {
  await withTemporaryDirectory(async (root) => {
    const staging = join(root, "staging.exe");
    const output = join(root, "mdrunner.exe");
    const backup = join(root, "backup.exe");
    await writeFile(staging, "new complete");
    await writeFile(output, "previous valid");
    let installs = 0;
    const operations: PublishOperations = {
      async rename(from, to) {
        if (from === staging && to === output) {
          installs += 1;
          throw codedError(installs === 1 ? "EEXIST" : "EACCES");
        }
        await rename(from, to);
      },
      remove: (path) => rm(path, { force: true }),
    };
    await expect(publishArtifact(staging, output, backup, "win32", operations)).rejects.toThrow(
      "EACCES",
    );
    expect(await readFile(output, "utf8")).toBe("previous valid");
    expect(await readFile(staging, "utf8")).toBe("new complete");
    expect((await readdir(root)).sort()).toEqual(["mdrunner.exe", "staging.exe"].sort());
  });
});
