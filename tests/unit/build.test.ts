import { describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BUILD_TARGETS,
  BuildError,
  buildStandalone,
  createBootstrapSource,
  detectHostTarget,
  detectLinuxLibc,
  parseBuildArguments,
  resolveSatteriAddon,
  type BuildDependencies,
  type SupportedBuildTarget,
} from "../../scripts/build.ts";
import { withTemporaryDirectory } from "../helpers/temp-dir.ts";

const EXPECTED_TARGETS = {
  "bun-darwin-arm64": [
    "@bruits/satteri-darwin-arm64",
    "satteri_napi.darwin-arm64.node",
    "mdrunner",
  ],
  "bun-darwin-x64": ["@bruits/satteri-darwin-x64", "satteri_napi.darwin-x64.node", "mdrunner"],
  "bun-linux-arm64": [
    "@bruits/satteri-linux-arm64-gnu",
    "satteri_napi.linux-arm64-gnu.node",
    "mdrunner",
  ],
  "bun-linux-arm64-musl": [
    "@bruits/satteri-linux-arm64-musl",
    "satteri_napi.linux-arm64-musl.node",
    "mdrunner",
  ],
  "bun-linux-x64": ["@bruits/satteri-linux-x64-gnu", "satteri_napi.linux-x64-gnu.node", "mdrunner"],
  "bun-linux-x64-musl": [
    "@bruits/satteri-linux-x64-musl",
    "satteri_napi.linux-x64-musl.node",
    "mdrunner",
  ],
  "bun-windows-arm64": [
    "@bruits/satteri-win32-arm64-msvc",
    "satteri_napi.win32-arm64-msvc.node",
    "mdrunner.exe",
  ],
  "bun-windows-x64": [
    "@bruits/satteri-win32-x64-msvc",
    "satteri_napi.win32-x64-msvc.node",
    "mdrunner.exe",
  ],
} as const satisfies Record<SupportedBuildTarget, readonly [string, string, string]>;

describe("standalone target selection", () => {
  test("maps every supported Bun target to the exact Sätteri package, addon, and extension", () => {
    expect(Object.keys(BUILD_TARGETS).sort()).toEqual(Object.keys(EXPECTED_TARGETS).sort());
    for (const name of Object.keys(EXPECTED_TARGETS) as SupportedBuildTarget[]) {
      const expected = EXPECTED_TARGETS[name];
      const target = BUILD_TARGETS[name];
      expect([target.packageName, target.addonFile, target.outputFile]).toEqual([...expected]);
      expect(target.bunTarget).toBe(name);
    }
  });

  test("maps supported native hosts and keeps the Linux libc boundary explicit", () => {
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
      "build: could not determine Linux libc (glibc or musl)",
    );
    expect(() => detectHostTarget({ platform: "freebsd", arch: "x64" })).toThrow(
      'build: unsupported host platform "freebsd"',
    );
    expect(() => detectHostTarget({ platform: "darwin", arch: "ia32" })).toThrow(
      'build: unsupported host architecture "ia32"',
    );
  });

  test("classifies libc only from unambiguous evidence", () => {
    expect(detectLinuxLibc({ header: { glibcVersionRuntime: "2.39" } })).toBe("gnu");
    expect(detectLinuxLibc({ sharedObjects: ["/lib/ld-musl-aarch64.so.1"] })).toBe("musl");
    expect(detectLinuxLibc(undefined, "musl libc (x86_64)\nVersion 1.2.5")).toBe("musl");
    expect(detectLinuxLibc(undefined, "ldd (GNU libc) 2.39")).toBe("gnu");
    expect(
      detectLinuxLibc({ header: { glibcVersionRuntime: "2.39" } }, "musl libc (x86_64)"),
    ).toBeUndefined();
    expect(detectLinuxLibc(undefined, "unknown ldd")).toBeUndefined();
  });

  test("requests native default but rejects malformed, unsupported, and extra arguments", () => {
    expect(parseBuildArguments([])).toBeUndefined();
    expect(parseBuildArguments(["bun-linux-x64-musl"])).toBe("bun-linux-x64-musl");
    expect(() => parseBuildArguments(["linux-x64"])).toThrow(
      'build: unsupported target "linux-x64"',
    );
    expect(() => parseBuildArguments([" bun-linux-x64"])).toThrow(
      'build: unsupported target " bun-linux-x64"',
    );
    expect(() => parseBuildArguments([""])).toThrow('build: unsupported target ""');
    for (const inheritedName of ["constructor", "toString", "__proto__"]) {
      expect(() => parseBuildArguments([inheritedName])).toThrow(
        `build: unsupported target ${JSON.stringify(inheritedName)}`,
      );
    }
    expect(() => parseBuildArguments(["bun-darwin-arm64", "extra"])).toThrow(
      "build: expected zero or one target argument",
    );
  });
});

describe("bootstrap and build lifecycle", () => {
  test("escapes special paths and embeds the addon before the awaited literal CLI import", () => {
    const addon = '/tmp/native path/quote" slash\\ newline\n/satteri.node';
    const cli = '/tmp/source path/quote" slash\\ newline\n/cli.ts';
    const source = createBootstrapSource(addon, cli);
    const importLine = `import addonPath from ${JSON.stringify(addon)} with { type: "file" };`;
    const envLine = "process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;";
    const cliLine = `await import(${JSON.stringify(cli)});`;

    expect(source).toContain(importLine);
    expect(source).toContain(envLine);
    expect(source).toContain(cliLine);
    expect(source.indexOf(importLine)).toBeLessThan(source.indexOf(envLine));
    expect(source.indexOf(envLine)).toBeLessThan(source.indexOf(cliLine));
    expect(source.match(/with \{ type: "file" \}/g)).toHaveLength(1);
  });

  test("keeps explicit developer target selection independent of host detection", async () => {
    await withTemporaryDirectory(async (projectRoot) => {
      await mkdir(join(projectRoot, "scripts"));
      await mkdir(join(projectRoot, "src"));
      const dependencies: BuildDependencies = {
        ...fakeDependencies(projectRoot, [], async (_bootstrap, staging, target) => {
          expect(target.bunTarget).toBe("bun-windows-x64");
          await writeFile(staging, "cross-target binary");
        }),
        nativeTarget: async () => {
          throw new Error("host detection must not run");
        },
      };

      const output = await buildStandalone(["bun-windows-x64"], dependencies);

      expect(output).toBe(join(projectRoot, "dist", "mdrunner.exe"));
      expect((await stat(output)).isFile()).toBe(true);
      expect(await temporaryBuildFiles(projectRoot)).toEqual([]);
    });
  });

  test("stages a complete executable, replaces prior output, and removes temporary source", async () => {
    await withTemporaryDirectory(async (projectRoot) => {
      await mkdir(join(projectRoot, "scripts"));
      await mkdir(join(projectRoot, "src"));
      await mkdir(join(projectRoot, "dist"));
      await writeFile(join(projectRoot, "dist", "mdrunner"), "old binary");
      await writeFile(join(projectRoot, "dist", "mdrunner.exe"), "old other target");
      const logs: string[] = [];
      const dependencies = fakeDependencies(projectRoot, logs, async (bootstrap, staging) => {
        const generated = await readFile(bootstrap, "utf8");
        expect(generated).toContain('with { type: "file" }');
        await writeFile(staging, "complete binary");
      });

      const output = await buildStandalone([], dependencies);

      expect(output).toBe(join(projectRoot, "dist", "mdrunner"));
      expect(await readFile(output, "utf8")).toBe("complete binary");
      expect(await Bun.file(join(projectRoot, "dist", "mdrunner.exe")).exists()).toBe(false);
      expect(await temporaryBuildFiles(projectRoot)).toEqual([]);
      expect(logs).toEqual([
        "Building bun-darwin-arm64 with @bruits/satteri-darwin-arm64/satteri_napi.darwin-arm64.node",
        `Built ${output}`,
      ]);
    });
  });

  test("removes partial staging and bootstrap while retaining the last valid artifact on failure", async () => {
    await withTemporaryDirectory(async (projectRoot) => {
      await mkdir(join(projectRoot, "scripts"));
      await mkdir(join(projectRoot, "src"));
      await mkdir(join(projectRoot, "dist"));
      const output = join(projectRoot, "dist", "mdrunner");
      await writeFile(output, "last valid binary");
      const dependencies = fakeDependencies(projectRoot, [], async (_bootstrap, staging) => {
        await writeFile(staging, "partial binary");
        throw new BuildError("compiler probe failed");
      });

      await expect(buildStandalone([], dependencies)).rejects.toThrow(
        "build: compiler probe failed",
      );
      expect(await readFile(output, "utf8")).toBe("last valid binary");
      expect(await temporaryBuildFiles(projectRoot)).toEqual([]);
    });
  });

  test("does not overwrite or remove a bootstrap owned by another build", async () => {
    await withTemporaryDirectory(async (projectRoot) => {
      await mkdir(join(projectRoot, "scripts"));
      const bootstrap = join(projectRoot, "scripts", ".build-bootstrap.ts");
      await writeFile(bootstrap, "other build");
      const dependencies = fakeDependencies(projectRoot, [], async () => {
        throw new Error("compile must not run");
      });

      await expect(buildStandalone([], dependencies)).rejects.toThrow(
        `build: could not create temporary bootstrap: ${bootstrap}`,
      );
      expect(await readFile(bootstrap, "utf8")).toBe("other build");
    });
  });

  test("fails closed on absent target package before creating build material", async () => {
    await withTemporaryDirectory(async (projectRoot) => {
      await expect(
        resolveSatteriAddon(BUILD_TARGETS["bun-windows-x64"], projectRoot),
      ).rejects.toThrow(
        "build: native package @bruits/satteri-win32-x64-msvc@0.9.5 is not installed for bun-windows-x64",
      );
      expect(await Bun.file(join(projectRoot, "dist")).exists()).toBe(false);
    });
  });
});

function fakeDependencies(
  projectRoot: string,
  logs: string[],
  compile: BuildDependencies["compile"],
): BuildDependencies {
  return {
    projectRoot,
    nativeTarget: async () => "bun-darwin-arm64",
    resolveAddon: async () => '/tmp/addon path/quote"/satteri_napi.darwin-arm64.node',
    compile,
    log: (message) => logs.push(message),
    uniqueId: () => "test-id",
  };
}

async function temporaryBuildFiles(projectRoot: string): Promise<string[]> {
  const scriptFiles = await readdir(join(projectRoot, "scripts"));
  const distFiles = await readdir(join(projectRoot, "dist"));
  return [...scriptFiles, ...distFiles].filter(
    (name) => name === ".build-bootstrap.ts" || name.startsWith(".mdrunner-"),
  );
}
