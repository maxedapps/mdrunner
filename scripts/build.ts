import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type LinuxLibc = "gnu" | "musl";

const TARGETS = {
  "bun-darwin-arm64": ["@bruits/satteri-darwin-arm64", "satteri_napi.darwin-arm64.node"],
  "bun-darwin-x64": ["@bruits/satteri-darwin-x64", "satteri_napi.darwin-x64.node"],
  "bun-linux-arm64": ["@bruits/satteri-linux-arm64-gnu", "satteri_napi.linux-arm64-gnu.node"],
  "bun-linux-arm64-musl": [
    "@bruits/satteri-linux-arm64-musl",
    "satteri_napi.linux-arm64-musl.node",
  ],
  "bun-linux-x64": ["@bruits/satteri-linux-x64-gnu", "satteri_napi.linux-x64-gnu.node"],
  "bun-linux-x64-musl": ["@bruits/satteri-linux-x64-musl", "satteri_napi.linux-x64-musl.node"],
  "bun-windows-arm64": ["@bruits/satteri-win32-arm64-msvc", "satteri_napi.win32-arm64-msvc.node"],
  "bun-windows-x64": ["@bruits/satteri-win32-x64-msvc", "satteri_napi.win32-x64-msvc.node"],
} as const;

export type SupportedBuildTarget = keyof typeof TARGETS;

export class BuildError extends Error {
  constructor(message: string) {
    super(`build: ${message}`);
    this.name = "BuildError";
  }
}

export function targetConfig(target: SupportedBuildTarget) {
  const [packageName, addonFile] = TARGETS[target];
  return {
    bunTarget: target,
    packageName,
    addonFile,
    outputFile: target.startsWith("bun-windows-") ? "mdrunner.exe" : "mdrunner",
  } as const;
}

/** Keep explicitly targeted artifacts side by side in `dist`. */
export function targetArtifactFile(target: SupportedBuildTarget): string {
  const name = target.replace(/^bun-/, "mdrunner-");
  return target.startsWith("bun-windows-") ? `${name}.exe` : name;
}

export const supportedBuildTargets = Object.freeze(Object.keys(TARGETS) as SupportedBuildTarget[]);

function objectValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** Classify Linux libc only from unambiguous runtime or ldd evidence. */
export function detectLinuxLibc(report: unknown, lddOutput = ""): LinuxLibc | undefined {
  const header = objectValue(report, "header");
  const glibcVersion = objectValue(header, "glibcVersionRuntime");
  const sharedObjects = objectValue(report, "sharedObjects");
  const evidence = `${Array.isArray(sharedObjects) ? sharedObjects.join("\n") : ""}\n${lddOutput}`;
  const hasGnu =
    (typeof glibcVersion === "string" && glibcVersion.length > 0) ||
    /\b(?:glibc|gnu libc)\b/i.test(evidence);
  const hasMusl = /(?:\bmusl\b|(?:^|[/\s])(?:ld|libc)[.-]musl[-_.])/im.test(evidence);
  return hasGnu === hasMusl ? undefined : hasMusl ? "musl" : "gnu";
}

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

export function parseBuildArguments(args: readonly string[]): SupportedBuildTarget | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 1) throw new BuildError("expected zero or one target argument");
  const requested = args[0];
  if (requested === undefined || !Object.hasOwn(TARGETS, requested)) {
    throw new BuildError(`unsupported target ${JSON.stringify(requested ?? "")}`);
  }
  return requested as SupportedBuildTarget;
}

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
      let lddOutput = "";
      try {
        const probe = Bun.spawnSync(["ldd", "--version"], {
          stderr: "pipe",
          stdout: "pipe",
          timeout: 5_000,
        });
        lddOutput = `${probe.stdout.toString()}\n${probe.stderr.toString()}`;
      } catch {
        // The detector below turns missing or ambiguous evidence into a stable failure.
      }
      linuxLibc = detectLinuxLibc(report, lddOutput);
    }
  }
  return detectHostTarget({
    platform: process.platform,
    arch: process.arch,
    ...(linuxLibc === undefined ? {} : { linuxLibc }),
  });
}

export async function resolveAddon(
  projectRoot: string,
  target: SupportedBuildTarget,
): Promise<string> {
  const { packageName, addonFile } = targetConfig(target);
  const addonPath = join(projectRoot, "node_modules", ...packageName.split("/"), addonFile);
  try {
    if (!(await stat(addonPath)).isFile()) throw new Error("not a file");
  } catch {
    throw new BuildError(`native addon missing for ${target}: ${packageName}/${addonFile}`);
  }
  return addonPath;
}

export interface PublishOperations {
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const publishOperations: PublishOperations = {
  rename,
  remove: (path) => rm(path, { force: true }),
};

/** Publish one complete artifact, restoring the prior Windows artifact on failure. */
export async function publishArtifact(
  stagingPath: string,
  outputPath: string,
  backupPath: string,
  platform: NodeJS.Platform = process.platform,
  operations: PublishOperations = publishOperations,
): Promise<void> {
  if (platform !== "win32") {
    await operations.rename(stagingPath, outputPath);
    return;
  }

  try {
    await operations.rename(stagingPath, outputPath);
    return;
  } catch (error) {
    try {
      await stat(outputPath);
    } catch {
      throw error;
    }
  }

  await operations.rename(outputPath, backupPath);
  try {
    await operations.rename(stagingPath, outputPath);
  } catch (error) {
    try {
      await operations.rename(backupPath, outputPath);
    } catch {
      throw new BuildError(`could not replace output; prior artifact retained at ${backupPath}`);
    }
    throw error;
  }
  await operations.remove(backupPath);
}

interface BuildPaths {
  readonly bootstrapPath: string;
  readonly bootstrapSource: string;
  readonly stagingPath: string;
  readonly outputPath: string;
  readonly backupPath: string;
  readonly alternateOutputPath: string;
}

/** Own bootstrap/staging paths around one compile callback and publish operation. */
export async function runOwnedBuild(
  paths: BuildPaths,
  compile: () => Promise<void>,
): Promise<void> {
  let ownsBootstrap = false;
  let failed = false;
  let primaryError: unknown;
  try {
    try {
      await writeFile(paths.bootstrapPath, paths.bootstrapSource, { encoding: "utf8", flag: "wx" });
      ownsBootstrap = true;
    } catch {
      throw new BuildError(`could not create temporary bootstrap: ${paths.bootstrapPath}`);
    }

    await compile();
    if (!(await stat(paths.stagingPath)).isFile()) {
      throw new BuildError("Bun compilation did not produce an executable");
    }
    await publishArtifact(paths.stagingPath, paths.outputPath, paths.backupPath);
    await rm(paths.alternateOutputPath, { force: true });
  } catch (error) {
    failed = true;
    primaryError = error;
  }

  const cleanup = await Promise.allSettled([
    ...(ownsBootstrap ? [rm(paths.bootstrapPath, { force: true })] : []),
    rm(paths.stagingPath, { force: true }),
  ]);
  if (failed) throw primaryError;
  if (cleanup.some((result) => result.status === "rejected")) {
    throw new BuildError("could not clean temporary build files");
  }
}

async function compileStandalone(
  bootstrapPath: string,
  stagingPath: string,
  target: SupportedBuildTarget,
): Promise<void> {
  let result: Awaited<ReturnType<typeof Bun.build>>;
  try {
    result = await Bun.build({
      entrypoints: [bootstrapPath],
      minify: true,
      sourcemap: "none",
      bytecode: false,
      compile: {
        target,
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

async function buildTarget(
  projectRoot: string,
  target: SupportedBuildTarget,
  outputFile: string,
  addonPath?: string,
): Promise<string> {
  const config = targetConfig(target);
  const resolvedAddonPath = addonPath ?? (await resolveAddon(projectRoot, target));
  const distPath = join(projectRoot, "dist");
  const id = `${process.pid}-${crypto.randomUUID()}`;
  const bootstrapPath = join(projectRoot, "scripts/.build-bootstrap.ts");
  const extension = outputFile.endsWith(".exe") ? ".exe" : "";
  const stagingPath = join(distPath, `.mdrunner-${id}${extension}`);
  const outputPath = join(distPath, outputFile);
  const backupPath = join(distPath, `.mdrunner-backup-${id}${extension}`);
  const alternateOutputPath = join(
    distPath,
    outputFile.endsWith(".exe") ? outputFile.slice(0, -4) : `${outputFile}.exe`,
  );
  await mkdir(distPath, { recursive: true });
  console.log(`Building ${target} with ${config.packageName}/${config.addonFile}`);

  await runOwnedBuild(
    {
      bootstrapPath,
      bootstrapSource: createBootstrapSource(resolvedAddonPath, join(projectRoot, "src/cli.ts")),
      stagingPath,
      outputPath,
      backupPath,
      alternateOutputPath,
    },
    () => compileStandalone(bootstrapPath, stagingPath, target),
  );
  console.log(`Built ${outputPath}`);
  return outputPath;
}

export async function buildStandalone(args: readonly string[]): Promise<string> {
  const projectRoot = dirname(import.meta.dir);
  const explicitTarget = parseBuildArguments(args);
  const target = explicitTarget ?? (await nativeHostTarget());
  const outputFile =
    explicitTarget === undefined ? targetConfig(target).outputFile : targetArtifactFile(target);
  return buildTarget(projectRoot, target, outputFile);
}

export async function buildAllStandalone(): Promise<readonly string[]> {
  const projectRoot = dirname(import.meta.dir);
  const addons = new Map<SupportedBuildTarget, string>();
  for (const target of supportedBuildTargets) {
    addons.set(target, await resolveAddon(projectRoot, target));
  }

  const outputs: string[] = [];
  for (const target of supportedBuildTargets) {
    outputs.push(
      await buildTarget(projectRoot, target, targetArtifactFile(target), addons.get(target)!),
    );
  }
  return outputs;
}

if (import.meta.main) {
  try {
    const args = Bun.argv.slice(2);
    if (args.length === 1 && args[0] === "--all") await buildAllStandalone();
    else await buildStandalone(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "build: unknown failure");
    process.exitCode = 1;
  }
}
