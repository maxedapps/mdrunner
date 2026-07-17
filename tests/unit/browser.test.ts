import { describe, expect, test } from "bun:test";

import { browserCommand, openBrowser, type BrowserSpawn } from "../../src/browser.ts";
import { ExpectedError, errorCodes } from "../../src/errors.ts";

const adversarialUrl = "file:///tmp/Space and 'quote\" & 100%/世界 café.html";

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("browser command selection", () => {
  test("uses exact argv arrays on macOS and Linux without shell interpolation", () => {
    expect(browserCommand(adversarialUrl, "darwin")).toEqual(["open", adversarialUrl]);
    expect(browserCommand(adversarialUrl, "linux")).toEqual(["xdg-open", adversarialUrl]);
  });

  test("encodes an exact literal-safe PowerShell Start-Process command on Windows", () => {
    const command = browserCommand(adversarialUrl, "win32");

    expect(command.slice(0, 5)).toEqual([
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    expect(command).toHaveLength(6);
    const script = Buffer.from(command[5]!, "base64").toString("utf16le");
    const encodedUrl = Buffer.from(adversarialUrl, "utf8").toString("base64");
    expect(script).toBe(
      `$u=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedUrl}'));Start-Process -FilePath $u`,
    );
    const recoveredUrl = Buffer.from(
      /FromBase64String\('([^']+)'\)/.exec(script)?.[1] ?? "",
      "base64",
    ).toString("utf8");
    expect(recoveredUrl).toBe(adversarialUrl);
    expect(script).not.toContain(adversarialUrl);
  });

  test("rejects an unknown platform before spawning", async () => {
    let spawnCalls = 0;
    const spawn: BrowserSpawn = () => {
      spawnCalls += 1;
      return { exited: Promise.resolve(0) };
    };

    await expect(openBrowser(adversarialUrl, { platform: "aix", spawn })).rejects.toMatchObject({
      code: errorCodes.browserUnsupportedPlatform,
      message: "Opening a browser is not supported on platform aix.",
      exitCode: 1,
    });
    expect(spawnCalls).toBe(0);
  });
});

describe("browser launcher", () => {
  test("passes the selected argv to the injected spawn boundary and awaits exit", async () => {
    const exit = deferred<number>();
    const calls: string[][] = [];
    const spawn: BrowserSpawn = (command) => {
      calls.push([...command]);
      return { exited: exit.promise };
    };

    let settled = false;
    const opening = openBrowser(adversarialUrl, { platform: "linux", spawn }).then(() => {
      settled = true;
    });
    await Bun.sleep(0);

    expect(calls).toEqual([["xdg-open", adversarialUrl]]);
    expect(settled).toBe(false);
    exit.resolve(0);
    await opening;
    expect(settled).toBe(true);
  });

  test("maps synchronous spawn failures to one stable expected error", async () => {
    const spawn: BrowserSpawn = () => {
      throw new Error("ENOENT: platform detail");
    };

    const failure = openBrowser(adversarialUrl, { platform: "darwin", spawn });
    await expect(failure).rejects.toBeInstanceOf(ExpectedError);
    await expect(failure).rejects.toMatchObject({
      code: errorCodes.browserLaunchFailed,
      message: "Could not start the default browser opener.",
      exitCode: 1,
    });
  });

  test("maps rejected process completion to the same stable spawn error", async () => {
    const spawn: BrowserSpawn = () => ({
      exited: Promise.reject(new Error("wait failed with platform detail")),
    });

    await expect(openBrowser(adversarialUrl, { platform: "linux", spawn })).rejects.toMatchObject({
      code: errorCodes.browserLaunchFailed,
      message: "Could not start the default browser opener.",
    });
  });

  test.each([1, 7, -1])("maps non-zero status %i without printing", async (exitCode) => {
    const spawn: BrowserSpawn = () => ({ exited: Promise.resolve(exitCode) });

    await expect(openBrowser(adversarialUrl, { platform: "linux", spawn })).rejects.toMatchObject({
      code: errorCodes.browserNonZeroExit,
      message: `Default browser opener exited with status ${exitCode}.`,
      exitCode: 1,
    });
  });
});
