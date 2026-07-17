import { describe, expect, test } from "bun:test";

import { ExpectedError, errorCodes, normalizeError } from "../../src/errors.ts";
import { runMdrunner, USAGE_TEXT, type MdrunnerDependencies } from "../../src/main.ts";
import type { MarkdownSource } from "../../src/source.ts";

const source: MarkdownSource = {
  kind: "file",
  markdown: "# Orchestrated\n",
  canonicalPath: "/workspace/Orchestrated.md",
  assetBase: "/workspace",
  label: "/workspace/Orchestrated.md",
};

interface DependencyObservations {
  readonly effects: string[];
  readonly readArguments: (readonly string[])[];
  readonly renderedSources: MarkdownSource[];
  readonly writes: { source: MarkdownSource; html: string }[];
  readonly printed: string[];
  readonly opened: string[];
}

function dependencies(overrides: Partial<MdrunnerDependencies> = {}): {
  deps: MdrunnerDependencies;
  observations: DependencyObservations;
} {
  const observations: DependencyObservations = {
    effects: [],
    readArguments: [],
    renderedSources: [],
    writes: [],
    printed: [],
    opened: [],
  };
  const deps: MdrunnerDependencies = {
    async readSource(args) {
      observations.effects.push("read");
      observations.readArguments.push(args);
      return { kind: "render", source };
    },
    async render(value) {
      observations.effects.push("render");
      observations.renderedSources.push(value);
      return "<!doctype html><p>complete</p>";
    },
    async writeOutput(value, html) {
      observations.effects.push("write");
      observations.writes.push({ source: value, html });
      return "/tmp/mdrunner/complete.html";
    },
    printOutput(value) {
      observations.effects.push("print");
      observations.printed.push(value);
    },
    async openBrowser(value) {
      observations.effects.push("open");
      observations.opened.push(value);
    },
    ...overrides,
  };
  return { deps, observations };
}

function throwValue(value: unknown): never {
  throw value;
}

describe("runMdrunner help", () => {
  test.each(["-h", "--help"])(
    "prints one shared usage text for %s and does nothing else",
    async (flag) => {
      const { deps, observations } = dependencies({
        async readSource(args) {
          observations.effects.push("read");
          observations.readArguments.push(args);
          return { kind: "help" };
        },
      });

      const result = await runMdrunner([flag], deps);

      expect(result).toEqual({ exitCode: 0 });
      expect(observations.readArguments).toEqual([[flag]]);
      expect(observations.effects).toEqual(["read", "print"]);
      expect(observations.printed).toEqual([USAGE_TEXT]);
      expect(observations.renderedSources).toEqual([]);
      expect(observations.writes).toEqual([]);
      expect(observations.opened).toEqual([]);
    },
  );

  test("returns a help-print failure without starting render side effects", async () => {
    const failure = new Error("stdout unavailable");
    const { deps, observations } = dependencies({
      async readSource() {
        observations.effects.push("read");
        return { kind: "help" };
      },
      printOutput(value) {
        observations.effects.push("print");
        observations.printed.push(value);
        throw failure;
      },
    });

    const result = await runMdrunner(["--help"], deps);

    expect(result).toEqual({ exitCode: 1, error: failure });
    expect(observations.effects).toEqual(["read", "print"]);
    expect(observations.printed).toEqual([USAGE_TEXT]);
    expect(observations.writes).toEqual([]);
    expect(observations.opened).toEqual([]);
  });
});

describe("runMdrunner success", () => {
  test("runs select, render, atomic-write boundary, print, then open with exact values", async () => {
    const { deps, observations } = dependencies();
    const args = ["Orchestrated.md"] as const;

    const result = await runMdrunner(args, deps);

    expect(result).toEqual({ exitCode: 0 });
    expect(observations.effects).toEqual(["read", "render", "write", "print", "open"]);
    expect(observations.readArguments).toEqual([args]);
    expect(observations.renderedSources).toEqual([source]);
    expect(observations.writes).toEqual([{ source, html: "<!doctype html><p>complete</p>" }]);
    expect(observations.printed).toEqual(["/tmp/mdrunner/complete.html"]);
    expect(observations.opened).toEqual(["file:///tmp/mdrunner/complete.html"]);
  });

  test("awaits every asynchronous effect before starting its successor", async () => {
    const effects: string[] = [];
    const pause = async (name: string): Promise<void> => {
      effects.push(`${name}:start`);
      await Bun.sleep(0);
      effects.push(`${name}:end`);
    };
    const deps: MdrunnerDependencies = {
      async readSource() {
        await pause("read");
        return { kind: "render", source };
      },
      async render() {
        await pause("render");
        return "html";
      },
      async writeOutput() {
        await pause("write");
        return "/tmp/awaited.html";
      },
      printOutput() {
        effects.push("print");
      },
      async openBrowser() {
        await pause("open");
      },
    };

    await expect(runMdrunner([], deps)).resolves.toEqual({ exitCode: 0 });
    expect(effects).toEqual([
      "read:start",
      "read:end",
      "render:start",
      "render:end",
      "write:start",
      "write:end",
      "print",
      "open:start",
      "open:end",
    ]);
  });

  test("converts special and Unicode output paths to an escaped file URL", async () => {
    const outputPath = "/tmp/space # % ?/世界 café.html";
    const { deps, observations } = dependencies({
      async writeOutput() {
        observations.effects.push("write");
        return outputPath;
      },
    });

    await expect(runMdrunner([], deps)).resolves.toEqual({ exitCode: 0 });
    expect(observations.printed).toEqual([outputPath]);
    expect(observations.opened).toEqual([
      "file:///tmp/space%20%23%20%25%20%3F/%E4%B8%96%E7%95%8C%20caf%C3%A9.html",
    ]);
  });
});

describe("runMdrunner failures", () => {
  const cases: {
    readonly boundary: "read" | "render" | "write" | "print" | "open";
    readonly expectedEffects: string[];
    readonly retainsOutput: boolean;
  }[] = [
    { boundary: "read", expectedEffects: ["read"], retainsOutput: false },
    { boundary: "render", expectedEffects: ["read", "render"], retainsOutput: false },
    { boundary: "write", expectedEffects: ["read", "render", "write"], retainsOutput: false },
    {
      boundary: "print",
      expectedEffects: ["read", "render", "write", "print"],
      retainsOutput: true,
    },
    {
      boundary: "open",
      expectedEffects: ["read", "render", "write", "print", "open"],
      retainsOutput: true,
    },
  ];

  test.each(cases)(
    "$boundary failure returns exit 1 and strictly short-circuits later effects",
    async ({ boundary, expectedEffects, retainsOutput }) => {
      const failure = new ExpectedError(errorCodes.unexpected, `${boundary} failed`);
      const { deps, observations } = dependencies({
        async readSource() {
          observations.effects.push("read");
          if (boundary === "read") return throwValue(failure);
          return { kind: "render", source };
        },
        async render() {
          observations.effects.push("render");
          if (boundary === "render") return throwValue(failure);
          return "html";
        },
        async writeOutput() {
          observations.effects.push("write");
          if (boundary === "write") return throwValue(failure);
          return "/tmp/retained.html";
        },
        printOutput(value) {
          observations.effects.push("print");
          observations.printed.push(value);
          if (boundary === "print") throwValue(failure);
        },
        async openBrowser(value) {
          observations.effects.push("open");
          observations.opened.push(value);
          if (boundary === "open") return throwValue(failure);
        },
      });

      const result = await runMdrunner([], deps);

      expect(result.exitCode).toBe(1);
      if (result.exitCode !== 1) throw new Error("Expected a failure result");
      expect(result.error).toBe(failure);
      expect(result.outputPath).toBe(retainsOutput ? "/tmp/retained.html" : undefined);
      expect(observations.effects).toEqual(expectedEffects);
      expect(observations.opened).toHaveLength(boundary === "open" ? 1 : 0);
    },
  );

  test("prints and retains the completed path before returning an opener failure", async () => {
    const openerFailure = new ExpectedError(
      errorCodes.browserLaunchFailed,
      "Could not start the default browser opener.",
    );
    const { deps, observations } = dependencies({
      async openBrowser(value) {
        observations.effects.push("open");
        observations.opened.push(value);
        throw openerFailure;
      },
    });

    const result = await runMdrunner(["source.md"], deps);

    expect(result).toEqual({
      exitCode: 1,
      error: openerFailure,
      outputPath: "/tmp/mdrunner/complete.html",
    });
    expect(observations.printed).toEqual(["/tmp/mdrunner/complete.html"]);
    expect(observations.effects).toEqual(["read", "render", "write", "print", "open"]);
  });

  test("preserves expected and unexpected thrown values for one later normalization boundary", async () => {
    const expected = new ExpectedError(errorCodes.outputWriteFailed, "Expected write failure.");
    const unexpected = new Error("Renderer implementation detail");
    const opaque = { privateImplementationValue: true };

    for (const failure of [expected, unexpected, opaque]) {
      const { deps } = dependencies({
        async render() {
          throw failure;
        },
      });
      const result = await runMdrunner([], deps);

      expect(result.exitCode).toBe(1);
      if (result.exitCode !== 1) throw new Error("Expected a failure result");
      expect(result.error).toBe(failure);
      const normalized = normalizeError(result.error);
      if (failure === expected) {
        expect(normalized).toBe(expected);
      } else {
        expect(normalized).not.toBe(failure);
        expect(normalized.code).toBe(errorCodes.unexpected);
      }
    }
  });
});
