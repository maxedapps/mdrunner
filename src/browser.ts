import { ExpectedError, errorCodes } from "./errors.ts";

export interface SpawnedBrowserCommand {
  readonly exited: Promise<number>;
}

export type BrowserSpawn = (command: readonly string[]) => SpawnedBrowserCommand;

export interface OpenBrowserOptions {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: BrowserSpawn;
}

function encodePowerShellCommand(fileUrl: string): string {
  const encodedUrl = Buffer.from(fileUrl, "utf8").toString("base64");
  const script = `$u=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedUrl}'));Start-Process -FilePath $u`;
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Build an argv-only opener command. Authored path text is never parsed as shell source. */
export function browserCommand(
  fileUrl: string,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  switch (platform) {
    case "darwin":
      return ["open", fileUrl];
    case "linux":
      return ["xdg-open", fileUrl];
    case "win32":
      return [
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        encodePowerShellCommand(fileUrl),
      ];
    default:
      throw new ExpectedError(
        errorCodes.browserUnsupportedPlatform,
        `Opening a browser is not supported on platform ${platform}.`,
      );
  }
}

const defaultSpawn: BrowserSpawn = (command) =>
  Bun.spawn({
    cmd: [...command],
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

/** Launch and await the platform opener. This boundary intentionally prints nothing. */
export async function openBrowser(
  fileUrl: string,
  options: OpenBrowserOptions = {},
): Promise<void> {
  const command = browserCommand(fileUrl, options.platform);
  let spawned: SpawnedBrowserCommand;
  try {
    spawned = (options.spawn ?? defaultSpawn)(command);
  } catch {
    throw new ExpectedError(
      errorCodes.browserLaunchFailed,
      "Could not start the default browser opener.",
    );
  }

  let exitCode: number;
  try {
    exitCode = await spawned.exited;
  } catch {
    throw new ExpectedError(
      errorCodes.browserLaunchFailed,
      "Could not start the default browser opener.",
    );
  }
  if (exitCode !== 0) {
    throw new ExpectedError(
      errorCodes.browserNonZeroExit,
      `Default browser opener exited with status ${exitCode}.`,
    );
  }
}
