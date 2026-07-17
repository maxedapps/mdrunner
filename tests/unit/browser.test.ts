import { describe, expect, test } from "bun:test";

import { browserCommand, openBrowser, type BrowserSpawn } from "../../src/browser.ts";
import { ExpectedError } from "../../src/errors.ts";

const adversarialUrl = "file:///tmp/Space and 'quote\" & 100%/世界 café.html";

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
    const script = Buffer.from(command[5]!, "base64").toString("utf16le");
    const encodedUrl = Buffer.from(adversarialUrl, "utf8").toString("base64");
    expect(script).toBe(
      `$u=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedUrl}'));Start-Process -FilePath $u`,
    );
    expect(
      Buffer.from(/FromBase64String\('([^']+)'\)/.exec(script)![1]!, "base64").toString(),
    ).toBe(adversarialUrl);
    expect(script).not.toContain(adversarialUrl);
  });

  test("rejects an unknown platform before spawning", async () => {
    let spawnCalls = 0;
    const spawn: BrowserSpawn = () => {
      spawnCalls += 1;
      return { exited: Promise.resolve(0) };
    };
    await expect(openBrowser(adversarialUrl, { platform: "aix", spawn })).rejects.toEqual(
      expect.objectContaining({
        message: "Opening a browser is not supported on platform aix.",
      }),
    );
    expect(spawnCalls).toBe(0);
  });
});

describe("browser launcher", () => {
  test("passes selected argv and awaits successful exit", async () => {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const calls: string[][] = [];
    const opening = openBrowser(adversarialUrl, {
      platform: "linux",
      spawn(command) {
        calls.push([...command]);
        return { exited };
      },
    });
    let settled = false;
    void opening.then(() => {
      settled = true;
    });
    await Bun.sleep(0);
    expect(calls).toEqual([["xdg-open", adversarialUrl]]);
    expect(settled).toBe(false);
    resolveExit(0);
    await opening;
  });

  test.each([
    [
      "synchronous spawn",
      () => {
        throw new Error("ENOENT");
      },
    ],
    ["rejected completion", () => ({ exited: Promise.reject(new Error("wait failed")) })],
  ])("maps %s failure to one expected message", async (_name, spawn) => {
    await expect(
      openBrowser(adversarialUrl, { platform: "linux", spawn: spawn as BrowserSpawn }),
    ).rejects.toEqual(
      expect.objectContaining({ message: "Could not start the default browser opener." }),
    );
  });

  test.each([1, 7, -1])("maps non-zero status %i", async (exitCode) => {
    const failure = openBrowser(adversarialUrl, {
      platform: "linux",
      spawn: () => ({ exited: Promise.resolve(exitCode) }),
    });
    await expect(failure).rejects.toBeInstanceOf(ExpectedError);
    await expect(failure).rejects.toEqual(
      expect.objectContaining({
        message: `Default browser opener exited with status ${exitCode}.`,
      }),
    );
  });
});
