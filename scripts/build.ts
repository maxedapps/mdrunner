import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SATTERI_VERSION = "0.9.5";

export type LinuxLibc = "gnu" | "musl";
export type SupportedBuildTarget =
  | "bun-darwin-arm64"
  | "bun-darwin-x64"
  | "bun-linux-arm64"
  | "bun-linux-arm64-musl"
  | "bun-linux-x64"
  | "bun-linux-x64-musl"
  | "bun-windows-arm64"
  | "bun-windows-x64";

export interface BuildTargetConfig {
  readonly bunTarget: SupportedBuildTarget;
  readonly platform: "darwin" | "linux" | "win32";
  readonly arch: "arm64" | "x64";
  readonly libc?: LinuxLibc;
  readonly packageName: `@bruits/satteri-${string}`;
  readonly addonFile: `satteri_napi.${string}.node`;
  readonly outputFile: "mdrunner" | "mdrunner.exe";
}

export const BUILD_TARGETS = Object.freeze({
  "bun-darwin-arm64": {
    bunTarget: "bun-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    packageName: "@bruits/satteri-darwin-arm64",
    addonFile: "satteri_napi.darwin-arm64.node",
    outputFile: "mdrunner",
  },
  "bun-darwin-x64": {
    bunTarget: "bun-darwin-x64",
    platform: "darwin",
    arch: "x64",
    packageName: "@bruits/satteri-darwin-x64",
    addonFile: "satteri_napi.darwin-x64.node",
    outputFile: "mdrunner",
  },
  "bun-linux-arm64": {
    bunTarget: "bun-linux-arm64",
    platform: "linux",
    arch: "arm64",
    libc: "gnu",
    packageName: "@bruits/satteri-linux-arm64-gnu",
    addonFile: "satteri_napi.linux-arm64-gnu.node",
    outputFile: "mdrunner",
  },
  "bun-linux-arm64-musl": {
    bunTarget: "bun-linux-arm64-musl",
    platform: "linux",
    arch: "arm64",
    libc: "musl",
    packageName: "@bruits/satteri-linux-arm64-musl",
    addonFile: "satteri_napi.linux-arm64-musl.node",
    outputFile: "mdrunner",
  },
  "bun-linux-x64": {
    bunTarget: "bun-linux-x64",
    platform: "linux",
    arch: "x64",
    libc: "gnu",
    packageName: "@bruits/satteri-linux-x64-gnu",
    addonFile: "satteri_napi.linux-x64-gnu.node",
    outputFile: "mdrunner",
  },
  "bun-linux-x64-musl": {
    bunTarget: "bun-linux-x64-musl",
    platform: "linux",
    arch: "x64",
    libc: "musl",
    packageName: "@bruits/satteri-linux-x64-musl",
    addonFile: "satteri_napi.linux-x64-musl.node",
    outputFile: "mdrunner",
  },
  "bun-windows-arm64": {
    bunTarget: "bun-windows-arm64",
    platform: "win32",
    arch: "arm64",
    packageName: "@bruits/satteri-win32-arm64-msvc",
    addonFile: "satteri_napi.win32-arm64-msvc.node",
    outputFile: "mdrunner.exe",
  },
  "bun-windows-x64": {
    bunTarget: "bun-windows-x64",
    platform: "win32",
    arch: "x64",
    packageName: "@bruits/satteri-win32-x64-msvc",
    addonFile: "satteri_napi.win32-x64-msvc.node",
    outputFile: "mdrunner.exe",
  },
} as const satisfies Record<SupportedBuildTarget, BuildTargetConfig>);

export class BuildError extends Error {
  constructor(message: string) {
    super(`build: ${message}`);
    this.name = "BuildError";
  }
}

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** Classify Linux libc from Node/Bun's report and, when needed, `ldd --version`. */
export function detectLinuxLibc(report: unknown, lddOutput = ""): LinuxLibc | undefined {
  const header = objectValue(report, "header");
  const glibcVersion = objectValue(header, "glibcVersionRuntime");
  const sharedObjects = objectValue(report, "sharedObjects");
  const sharedObjectText = Array.isArray(sharedObjects) ? sharedObjects.join("\n") : "";
  const evidence = `${sharedObjectText}\n${lddOutput}`;
  const hasGnu =
    (typeof glibcVersion === "string" && glibcVersion.length > 0) ||
    /\b(?:glibc|gnu libc)\b/i.test(evidence);
  const hasMusl = /(?:\bmusl\b|(?:^|[/\s])(?:ld|libc)[.-]musl[-_.])/im.test(evidence);

  if (hasGnu === hasMusl) return undefined;
  return hasMusl ? "musl" : "gnu";
}

/** Pure host-to-release-target mapping; Linux callers must provide proven libc. */
export function detectHostTarget(host: {
  readonly platform: string;
  readonly arch: string;
  readonly linuxLibc?: LinuxLibc;
}): SupportedBuildTarget {
  const arch = host.arch === "aarch64" ? "arm64" : host.arch;
  if (arch !== "arm64" && arch !== "x64") {
    throw new BuildError(`unsupported host architecture "${host.arch}"`);
  }

  if (host.platform === "darwin") return `bun-darwin-${arch}`;
  if (host.platform === "win32") return `bun-windows-${arch}`;
  if (host.platform === "linux") {
    if (host.linuxLibc === "gnu") return `bun-linux-${arch}`;
    if (host.linuxLibc === "musl") return `bun-linux-${arch}-musl`;
    throw new BuildError("could not determine Linux libc (glibc or musl)");
  }

  throw new BuildError(`unsupported host platform "${host.platform}"`);
}

/** Parse one exact developer-only Bun target; `undefined` requests the native default. */
export function parseBuildArguments(args: readonly string[]): SupportedBuildTarget | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 1) throw new BuildError("expected zero or one target argument");

  const requested = args[0];
  if (requested === undefined || !Object.hasOwn(BUILD_TARGETS, requested)) {
    throw new BuildError(`unsupported target ${JSON.stringify(requested ?? "")}`);
  }
  return requested as SupportedBuildTarget;
}

/** Emit static addon discovery before the first possible Sätteri/CLI evaluation. */
export function createBootstrapSource(addonPath: string, cliPath: string): string {
  return `import addonPath from ${JSON.stringify(addonPath)} with { type: "file" };
process.env.NAPI_RS_NATIVE_LIBRARY_PATH = addonPath;
await import(${JSON.stringify(cliPath)});
`;
}

async function nativeHostTarget(): Promise<SupportedBuildTarget> {
  let linuxLibc: LinuxLibc | undefined;
  if (process.platform === "linux") {
    let report: unknown;
    try {
      report = process.report?.getReport();
    } catch {
      report = undefined;
    }
    linuxLibc = detectLinuxLibc(report);
    if (linuxLibc === undefined) {
      let output = "";
      try {
        const probe = Bun.spawnSync(["ldd", "--version"], { stderr: "pipe", stdout: "pipe" });
        output = `${probe.stdout.toString()}\n${probe.stderr.toString()}`;
      } catch {
        // The pure detector below turns missing or ambiguous evidence into a stable failure.
      }
      linuxLibc = detectLinuxLibc(report, output);
    }
  }
  return detectHostTarget({
    platform: process.platform,
    arch: process.arch,
    ...(linuxLibc === undefined ? {} : { linuxLibc }),
  });
}

interface SatteriPackageMetadata {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly main?: unknown;
  readonly files?: unknown;
}

export async function resolveSatteriAddon(
  target: BuildTargetConfig,
  projectRoot: string,
): Promise<string> {
  const packageJsonPath = join(
    projectRoot,
    "node_modules",
    ...target.packageName.split("/"),
    "package.json",
  );
  let metadata: SatteriPackageMetadata;
  try {
    metadata = JSON.parse(await readFile(packageJsonPath, "utf8")) as SatteriPackageMetadata;
  } catch (error) {
    if (objectValue(error, "code") === "ENOENT") {
      throw new BuildError(
        `native package ${target.packageName}@${SATTERI_VERSION} is not installed for ${target.bunTarget}`,
      );
    }
    throw new BuildError(`could not read native package metadata for ${target.packageName}`);
  }

  if (
    metadata.name !== target.packageName ||
    metadata.version !== SATTERI_VERSION ||
    metadata.main !== target.addonFile ||
    !Array.isArray(metadata.files) ||
    !metadata.files.includes(target.addonFile)
  ) {
    throw new BuildError(`native package metadata mismatch for ${target.packageName}`);
  }

  const addonPath = join(dirname(packageJsonPath), target.addonFile);
  try {
    if (!(await stat(addonPath)).isFile()) throw new Error("not a file");
  } catch {
    throw new BuildError(`native addon missing: ${target.packageName}/${target.addonFile}`);
  }
  return addonPath;
}

export interface BuildDependencies {
  readonly projectRoot: string;
  readonly nativeTarget: () => Promise<SupportedBuildTarget>;
  readonly resolveAddon: (target: BuildTargetConfig, projectRoot: string) => Promise<string>;
  readonly compile: (
    bootstrapPath: string,
    stagingPath: string,
    target: BuildTargetConfig,
  ) => Promise<void>;
  readonly log: (message: string) => void;
  readonly uniqueId: () => string;
}

async function compileStandalone(
  bootstrapPath: string,
  stagingPath: string,
  target: BuildTargetConfig,
): Promise<void> {
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [bootstrapPath],
      minify: true,
      compile: {
        target: target.bunTarget,
        outfile: stagingPath,
        autoloadBunfig: false,
        autoloadDotenv: false,
      },
    });
  } catch {
    throw new BuildError("Bun compilation failed");
  }
  if (!result.success) {
    const details = result.logs
      .map((log) => log.message)
      .filter(Boolean)
      .join("; ");
    throw new BuildError(
      details === "" ? "Bun compilation failed" : `Bun compilation failed: ${details}`,
    );
  }
}

const DEFAULT_DEPENDENCIES: BuildDependencies = {
  projectRoot: dirname(import.meta.dir),
  nativeTarget: nativeHostTarget,
  resolveAddon: resolveSatteriAddon,
  compile: compileStandalone,
  log: (message) => console.log(message),
  uniqueId: () => `${process.pid}-${crypto.randomUUID()}`,
};

async function replaceArtifact(
  stagingPath: string,
  outputPath: string,
  backupPath: string,
): Promise<void> {
  try {
    await rename(stagingPath, outputPath);
    return;
  } catch (error) {
    try {
      await stat(outputPath);
    } catch {
      throw error;
    }
  }

  await rename(outputPath, backupPath);
  try {
    await rename(stagingPath, outputPath);
  } catch (error) {
    try {
      await rename(backupPath, outputPath);
    } catch {
      throw new BuildError(`could not replace output; prior artifact retained at ${backupPath}`);
    }
    throw error;
  }
  await rm(backupPath, { force: true });
}

/** Build one selected standalone artifact while retaining any prior valid artifact on failure. */
export async function buildStandalone(
  args: readonly string[],
  dependencies: BuildDependencies = DEFAULT_DEPENDENCIES,
): Promise<string> {
  const explicitTarget = parseBuildArguments(args);
  const selectedName = explicitTarget ?? (await dependencies.nativeTarget());
  const target = BUILD_TARGETS[selectedName];
  const addonPath = await dependencies.resolveAddon(target, dependencies.projectRoot);
  const distPath = join(dependencies.projectRoot, "dist");
  const cliPath = join(dependencies.projectRoot, "src", "cli.ts");
  const id = dependencies.uniqueId();
  // Bun embeds the entrypoint name in the executable, so keep this path fixed
  // to make repeated builds from identical sources byte-reproducible.
  const bootstrapPath = join(dependencies.projectRoot, "scripts/.build-bootstrap.ts");
  const stagingPath = join(
    distPath,
    `.mdrunner-${id}${target.outputFile.endsWith(".exe") ? ".exe" : ""}`,
  );
  const backupPath = join(
    distPath,
    `.mdrunner-backup-${id}${target.outputFile.endsWith(".exe") ? ".exe" : ""}`,
  );
  const outputPath = join(distPath, target.outputFile);
  const alternateOutputPath = join(
    distPath,
    target.outputFile === "mdrunner" ? "mdrunner.exe" : "mdrunner",
  );

  await mkdir(distPath, { recursive: true });
  dependencies.log(`Building ${target.bunTarget} with ${target.packageName}/${target.addonFile}`);

  let ownsBootstrap = false;
  try {
    try {
      await writeFile(bootstrapPath, createBootstrapSource(addonPath, cliPath), {
        encoding: "utf8",
        flag: "wx",
      });
      ownsBootstrap = true;
    } catch {
      throw new BuildError(`could not create temporary bootstrap: ${bootstrapPath}`);
    }
    await dependencies.compile(bootstrapPath, stagingPath, target);
    if (!(await stat(stagingPath)).isFile()) {
      throw new BuildError("Bun compilation did not produce an executable");
    }
    await replaceArtifact(stagingPath, outputPath, backupPath);
    await rm(alternateOutputPath, { force: true });
    dependencies.log(`Built ${outputPath}`);
    return outputPath;
  } finally {
    await Promise.all([
      ...(ownsBootstrap ? [rm(bootstrapPath, { force: true })] : []),
      rm(stagingPath, { force: true }),
    ]);
  }
}

if (import.meta.main) {
  try {
    await buildStandalone(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "build: unknown failure");
    process.exitCode = 1;
  }
}
