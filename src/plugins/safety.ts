import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ExpectedError, errorCodes } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";
import { defineHastPlugin, type HastPluginInput } from "satteri";

const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const ALLOWED_IMAGE_SCHEMES = new Set(["http", "https"]);

function sourceLocation(source: MarkdownSource, node: { readonly position?: unknown }) {
  const position = node.position as
    | { readonly start?: { readonly line?: number; readonly column?: number } }
    | undefined;
  const line = position?.start?.line;
  const column = position?.start?.column;
  return {
    label: source.label,
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  };
}

function unsafeUrl(
  source: MarkdownSource,
  node: { readonly position?: unknown },
  kind: "link" | "image",
  reason: string,
): never {
  const code = kind === "link" ? errorCodes.unsafeLinkUrl : errorCodes.unsafeImageUrl;
  throw new ExpectedError(code, `Unsafe ${kind} URL: ${reason}.`, sourceLocation(source, node));
}

function stripControls(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code > 0x9f || (code > 0x1f && code < 0x7f)) result += character;
  }
  return result;
}

function normalizeUrl(value: string): string {
  return stripControls(value.trim());
}

function decodedForPolicy(
  value: string,
  source: MarkdownSource,
  node: { readonly position?: unknown },
  kind: "link" | "image",
): string {
  let decoded = value;
  try {
    for (let index = 0; index < 4; index++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    unsafeUrl(source, node, kind, "invalid percent encoding");
  }
  return stripControls(decoded.trim());
}

function parseAllowedRemote(
  value: string,
  scheme: string,
  source: MarkdownSource,
  node: { readonly position?: unknown },
  kind: "link" | "image",
): string {
  const allowed = kind === "link" ? ALLOWED_LINK_SCHEMES : ALLOWED_IMAGE_SCHEMES;
  if (!allowed.has(scheme)) unsafeUrl(source, node, kind, "scheme is not allowed");

  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== `${scheme}:`) {
      unsafeUrl(source, node, kind, "ambiguous scheme");
    }
    return parsed.href;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    unsafeUrl(source, node, kind, "URL is invalid");
  }
}

function containedFileUrl(
  value: string,
  policyValue: string,
  source: MarkdownSource,
  node: { readonly position?: unknown },
  kind: "link" | "image",
): string {
  if (
    value === "" ||
    policyValue.startsWith("/") ||
    policyValue.startsWith("\\") ||
    policyValue.includes("\\")
  ) {
    unsafeUrl(source, node, kind, "absolute or ambiguous local paths are not allowed");
  }

  const base = resolve(source.assetBase);
  let url: URL;
  let targets: string[];
  try {
    const baseUrl = pathToFileURL(`${base}${sep}`);
    url = new URL(value, baseUrl);
    targets = [fileURLToPath(url), fileURLToPath(new URL(policyValue, baseUrl))];
  } catch {
    unsafeUrl(source, node, kind, "local path is invalid");
  }

  for (const target of targets) {
    const pathFromBase = relative(base, target);
    if (pathFromBase === ".." || pathFromBase.startsWith(`..${sep}`) || isAbsolute(pathFromBase)) {
      unsafeUrl(source, node, kind, "local path escapes the source directory");
    }
  }
  return url.href;
}

function safeLinkUrl(
  rawValue: string,
  source: MarkdownSource,
  node: { readonly position?: unknown },
): string {
  const value = normalizeUrl(rawValue);
  const decoded = decodedForPolicy(value, source, node, "link");

  if (value.startsWith("#")) return value;
  if (decoded.startsWith("//"))
    unsafeUrl(source, node, "link", "protocol-relative URLs are not allowed");

  const rawScheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  const decodedScheme = SCHEME.exec(decoded)?.[1]?.toLowerCase();
  if (decodedScheme !== undefined && rawScheme === undefined) {
    unsafeUrl(source, node, "link", "encoded schemes are not allowed");
  }
  if (rawScheme !== undefined) {
    return parseAllowedRemote(value, rawScheme, source, node, "link");
  }
  return containedFileUrl(value, decoded, source, node, "link");
}

function safeImageUrl(
  rawValue: string,
  source: MarkdownSource,
  node: { readonly position?: unknown },
): string {
  const value = normalizeUrl(rawValue);
  const decoded = decodedForPolicy(value, source, node, "image");

  if (decoded.startsWith("//")) {
    unsafeUrl(source, node, "image", "protocol-relative URLs are not allowed");
  }
  const rawScheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  const decodedScheme = SCHEME.exec(decoded)?.[1]?.toLowerCase();
  if (decodedScheme !== undefined && rawScheme === undefined) {
    unsafeUrl(source, node, "image", "encoded schemes are not allowed");
  }
  if (rawScheme !== undefined) {
    return parseAllowedRemote(value, rawScheme, source, node, "image");
  }

  // T2.2 consumes this candidate and replaces it with validated embedded bytes.
  containedFileUrl(value, decoded, source, node, "image");
  return value;
}

/**
 * Run before every plugin that inserts trusted output. The factory gives each
 * document an isolated plugin instance and captures only durable source data.
 */
export function authoredContentSafetyPlugin(source: MarkdownSource): HastPluginInput {
  return () =>
    defineHastPlugin({
      name: "mdrunner-authored-content-safety",
      raw(node, context) {
        context.replaceNode(node, { type: "text", value: node.value });
      },
      element: [
        {
          filter: ["a"],
          visit(node, context) {
            const href = node.properties.href;
            if (typeof href !== "string") {
              unsafeUrl(source, node, "link", "href is missing or invalid");
            }
            context.setProperty(node, "href", safeLinkUrl(href, source, node));
          },
        },
        {
          filter: ["img"],
          visit(node, context) {
            const src = node.properties.src;
            if (typeof src !== "string") {
              unsafeUrl(source, node, "image", "src is missing or invalid");
            }
            context.setProperty(node, "src", safeImageUrl(src, source, node));
          },
        },
      ],
    });
}
