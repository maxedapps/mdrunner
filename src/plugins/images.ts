import { defineHastPlugin, type HastPluginInput } from "satteri";

import { embedLocalImageAsset, type ImageAssetContext } from "../assets.ts";
import { ExpectedError } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";
import { sourceLocation, type PositionedNode } from "./source-location.ts";

const SCHEME = /^([a-z][a-z\d+.-]*):/iu;

function sourceContext(source: MarkdownSource, node: PositionedNode): ImageAssetContext {
  return { assetBase: source.assetBase, ...sourceLocation(source, node) };
}

function unsafeImage(source: MarkdownSource, node: PositionedNode, reason: string): never {
  throw new ExpectedError(`Unsafe image URL: ${reason}.`, sourceLocation(source, node));
}

function stripControls(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code > 0x9f || (code > 0x1f && code < 0x7f)) result += character;
  }
  return result;
}

function decodeForPolicy(value: string, source: MarkdownSource, node: PositionedNode): string {
  let decoded = value;
  try {
    for (let index = 0; index < 4; index++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    unsafeImage(source, node, "invalid percent encoding");
  }
  return stripControls(decoded.trim());
}

function isAllowedRemote(value: string, source: MarkdownSource, node: PositionedNode): boolean {
  const rawScheme = SCHEME.exec(value)?.[1]?.toLowerCase();
  const policyValue = decodeForPolicy(value, source, node);
  const decodedScheme = SCHEME.exec(policyValue)?.[1]?.toLowerCase();

  if (policyValue.startsWith("//")) {
    unsafeImage(source, node, "protocol-relative URLs are not allowed");
  }
  if (decodedScheme !== undefined && rawScheme === undefined) {
    unsafeImage(source, node, "encoded schemes are not allowed");
  }
  if (rawScheme === undefined) return false;
  if (rawScheme !== "http" && rawScheme !== "https") {
    unsafeImage(source, node, "scheme is not allowed");
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol.toLowerCase() !== `${rawScheme}:` || parsed.hostname === "") {
      unsafeImage(source, node, "remote URL is invalid");
    }
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    unsafeImage(source, node, "remote URL is invalid");
  }
  return true;
}

/** Preserve HTTP(S) images and embed validated, contained local image assets. */
export function imageEmbeddingPlugin(source: MarkdownSource): HastPluginInput {
  return () =>
    defineHastPlugin({
      name: "mdrunner-local-image-embedding",
      element: {
        filter: ["img"],
        async visit(node, context) {
          const src = node.properties.src;
          if (typeof src !== "string") unsafeImage(source, node, "src is missing or invalid");

          const value = stripControls(src.trim());
          if (value === "" || value.startsWith("/") || value.startsWith("\\")) {
            unsafeImage(source, node, "absolute or empty local paths are not allowed");
          }
          if (isAllowedRemote(value, source, node)) return;

          const embedded = await embedLocalImageAsset(value, sourceContext(source, node));
          context.setProperty(node, "src", embedded.dataUri);
        },
      },
    });
}
