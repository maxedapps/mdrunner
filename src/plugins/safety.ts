import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defineHastPlugin, type HastPluginInput } from "satteri";

import { ExpectedError } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";
import { sourceLocation, type PositionedNode } from "./source-location.ts";

const SCHEME = /^([a-z][a-z\d+.-]*):/i;
const ALLOWED_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

function unsafeUrl(source: MarkdownSource, node: PositionedNode, reason: string): never {
  throw new ExpectedError(`Unsafe link URL: ${reason}.`, sourceLocation(source, node));
}

function stripControls(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code > 0x9f || (code > 0x1f && code < 0x7f)) result += character;
  }
  return result;
}

function decodedForPolicy(value: string, source: MarkdownSource, node: PositionedNode): string {
  let decoded = value;
  try {
    for (let index = 0; index < 4; index++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    unsafeUrl(source, node, "invalid percent encoding");
  }
  return stripControls(decoded.trim());
}

function containedFileUrl(
  value: string,
  policyValue: string,
  source: MarkdownSource,
  node: PositionedNode,
): string {
  if (
    value === "" ||
    policyValue.startsWith("/") ||
    policyValue.startsWith("\\") ||
    policyValue.includes("\\")
  ) {
    unsafeUrl(source, node, "absolute or ambiguous local paths are not allowed");
  }

  const base = resolve(source.assetBase);
  try {
    const baseUrl = pathToFileURL(`${base}${sep}`);
    const url = new URL(value, baseUrl);
    for (const target of [fileURLToPath(url), fileURLToPath(new URL(policyValue, baseUrl))]) {
      const pathFromBase = relative(base, target);
      if (
        pathFromBase === ".." ||
        pathFromBase.startsWith(`..${sep}`) ||
        isAbsolute(pathFromBase)
      ) {
        unsafeUrl(source, node, "local path escapes the source directory");
      }
    }
    return url.href;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    unsafeUrl(source, node, "local path is invalid");
  }
}

function safeLinkUrl(rawValue: string, source: MarkdownSource, node: PositionedNode): string {
  const value = stripControls(rawValue.trim());
  const decoded = decodedForPolicy(value, source, node);
  if (value.startsWith("#")) return value;
  if (decoded.startsWith("//")) unsafeUrl(source, node, "protocol-relative URLs are not allowed");

  const rawScheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  const decodedScheme = SCHEME.exec(decoded)?.[1]?.toLowerCase();
  if (decodedScheme !== undefined && rawScheme === undefined) {
    unsafeUrl(source, node, "encoded schemes are not allowed");
  }
  if (rawScheme === undefined) return containedFileUrl(value, decoded, source, node);
  if (!ALLOWED_LINK_SCHEMES.has(rawScheme)) unsafeUrl(source, node, "scheme is not allowed");

  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== `${rawScheme}:`) {
      unsafeUrl(source, node, "ambiguous scheme");
    }
    return parsed.href;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    unsafeUrl(source, node, "URL is invalid");
  }
}

/** Escape authored HTML and validate authored anchors before trusted plugins run. */
export function authoredContentSafetyPlugin(source: MarkdownSource): HastPluginInput {
  return () =>
    defineHastPlugin({
      name: "mdrunner-authored-content-safety",
      raw(node, context) {
        context.replaceNode(node, { type: "text", value: node.value });
      },
      element: {
        filter: ["a"],
        visit(node, context) {
          const href = node.properties.href;
          if (typeof href !== "string") unsafeUrl(source, node, "href is missing or invalid");
          context.setProperty(node, "href", safeLinkUrl(href, source, node));
        },
      },
    });
}
