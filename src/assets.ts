import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

import { XMLParser, XMLValidator } from "fast-xml-parser";

import { ExpectedError, type ErrorSource } from "./errors.ts";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_FRAGMENT_ID = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const ACTIVE_ELEMENTS = new Set([
  "a",
  "audio",
  "discard",
  "embed",
  "foreignobject",
  "iframe",
  "image",
  "mpath",
  "object",
  "script",
  "set",
  "style",
  "use",
  "video",
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
});

interface OrderedXmlNode {
  readonly [name: string]: unknown;
  readonly ":@"?: Readonly<Record<string, unknown>>;
}

export interface ImageAssetContext extends ErrorSource {
  readonly assetBase: string;
}

export interface EmbeddedImageAsset {
  readonly mimeType: string;
  readonly dataUri: string;
  readonly canonicalPath: string;
}

function assetFailure(context: ImageAssetContext, message: string): never {
  throw new ExpectedError(message, context);
}

function hasNodeCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    codes.includes(String(error.code))
  );
}

function unsafeSvg(context: ImageAssetContext, message: string): never {
  throw new ExpectedError(message, context);
}

function isContained(base: string, target: string): boolean {
  const fromBase = relative(base, target);
  return (
    fromBase === "" ||
    (!isAbsolute(fromBase) && fromBase !== ".." && !fromBase.startsWith(`..${sep}`))
  );
}

function decodeLocalPath(value: string, context: ImageAssetContext): string {
  const pathPart = value.split(/[?#]/u, 1)[0] ?? "";
  if (pathPart === "" || pathPart.startsWith("/") || pathPart.startsWith("\\")) {
    assetFailure(context, "Image path must be a relative local path.");
  }
  if (pathPart.includes("\\")) {
    assetFailure(context, "Image path contains an ambiguous path separator.");
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    assetFailure(context, "Image path has invalid percent encoding.");
  }
  if (decoded === "" || decoded.includes("\0") || decoded.includes("\\") || isAbsolute(decoded)) {
    assetFailure(context, "Image path is invalid.");
  }
  return decoded;
}

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasTrustedSignature(bytes: Uint8Array, extension: string): boolean {
  switch (extension) {
    case ".png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case ".gif":
      return (
        new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF87a" ||
        new TextDecoder().decode(bytes.subarray(0, 6)) === "GIF89a"
      );
    case ".webp":
      return (
        new TextDecoder().decode(bytes.subarray(0, 4)) === "RIFF" &&
        new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP"
      );
    case ".svg":
      return true;
    default:
      return false;
  }
}

function checkCssValue(value: string, context: ImageAssetContext): void {
  if (
    /@import\b/iu.test(value) ||
    /expression\s*\(/iu.test(value) ||
    (value.includes("\\") && value.includes("("))
  ) {
    unsafeSvg(context, "SVG contains unsafe CSS.");
  }

  const urlStart = /url\s*\(/giu;
  while (urlStart.exec(value) !== null) {
    const close = value.indexOf(")", urlStart.lastIndex);
    if (close === -1) unsafeSvg(context, "SVG contains a malformed CSS URL.");
    const target = value.slice(urlStart.lastIndex, close).trim();
    if (!target.startsWith("#") || !SAFE_FRAGMENT_ID.test(target.slice(1))) {
      unsafeSvg(context, "SVG contains a non-fragment CSS URL.");
    }
    urlStart.lastIndex = close + 1;
  }
}

function nodeEntries(node: OrderedXmlNode): Array<readonly [string, unknown]> {
  return Object.entries(node).filter(([name]) => name !== ":@");
}

function inspectSvgNode(node: OrderedXmlNode, context: ImageAssetContext, isRoot = false): void {
  const attributes = node[":@"];
  if (attributes !== undefined) {
    for (const [rawName, rawValue] of Object.entries(attributes)) {
      const name = rawName.toLowerCase();
      if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "src") {
        unsafeSvg(context, `SVG contains unsafe attribute '${rawName}'.`);
      }
      if (
        rawName.includes(":") ||
        name.startsWith("xmlns:") ||
        (name === "xmlns" && (!isRoot || rawValue !== SVG_NAMESPACE))
      ) {
        unsafeSvg(context, `SVG contains ambiguous namespaced attribute '${rawName}'.`);
      }
      if (typeof rawValue !== "string") {
        unsafeSvg(context, `SVG attribute '${rawName}' does not have a string value.`);
      }
      checkCssValue(rawValue, context);
    }
  }

  for (const [rawName, rawChildren] of nodeEntries(node)) {
    if (rawName === "#text" || rawName === "#cdata") {
      const textNodes = Array.isArray(rawChildren) ? rawChildren : [];
      for (const textNode of textNodes) {
        if (typeof textNode !== "object" || textNode === null) continue;
        const value = (textNode as { readonly "#text"?: unknown })["#text"];
        if (typeof value === "string") checkCssValue(value, context);
      }
      continue;
    }
    if (rawName === "#comment") continue;
    if (rawName.startsWith("?")) unsafeSvg(context, "SVG contains a processing instruction.");
    if (rawName.includes(":")) unsafeSvg(context, "SVG contains an ambiguous namespaced element.");

    const name = rawName.toLowerCase();
    if (ACTIVE_ELEMENTS.has(name) || name.startsWith("animate")) {
      unsafeSvg(context, `SVG contains active element '${rawName}'.`);
    }
    if (!Array.isArray(rawChildren)) unsafeSvg(context, "SVG parse structure is ambiguous.");
    for (const child of rawChildren) {
      if (typeof child !== "object" || child === null || Array.isArray(child)) {
        unsafeSvg(context, "SVG parse structure is ambiguous.");
      }
      inspectSvgNode(child as OrderedXmlNode, context);
    }
  }
}

/** Validate authored SVG structurally while retaining its original bytes for image-mode embedding. */
export function validateAuthoredSvg(bytes: Uint8Array, context: ImageAssetContext): void {
  let svg: string;
  try {
    svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    unsafeSvg(context, "SVG is not valid UTF-8.");
  }

  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(svg) || /&[A-Za-z_:][A-Za-z0-9_.:-]*;/u.test(svg)) {
    unsafeSvg(context, "SVG declarations and entities are not allowed.");
  }

  const withoutBom = svg.startsWith("\uFEFF") ? svg.slice(1) : svg;
  const processingInstructions = [...withoutBom.matchAll(/<\?[\s\S]*?\?>/gu)];
  if (processingInstructions.length > 1) {
    unsafeSvg(context, "SVG contains a processing instruction.");
  }
  if (processingInstructions.length === 1) {
    const instruction = processingInstructions[0]!;
    if (instruction.index !== 0 || !/^<\?xml(?:\s[^?]*)?\?>$/u.test(instruction[0])) {
      unsafeSvg(context, "SVG contains a non-leading processing instruction.");
    }
  }

  const validation = XMLValidator.validate(svg, { allowBooleanAttributes: false });
  if (validation !== true) unsafeSvg(context, "SVG is malformed XML.");

  let parsed: unknown;
  try {
    parsed = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "",
      allowBooleanAttributes: false,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: false,
      processEntities: false,
      ignoreDeclaration: false,
      ignorePiTags: false,
      commentPropName: "#comment",
      cdataPropName: "#cdata",
      removeNSPrefix: false,
    }).parse(svg);
  } catch {
    unsafeSvg(context, "SVG could not be parsed safely.");
  }
  if (!Array.isArray(parsed)) unsafeSvg(context, "SVG parse structure is ambiguous.");

  const roots: OrderedXmlNode[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      unsafeSvg(context, "SVG parse structure is ambiguous.");
    }
    const record = item as OrderedXmlNode;
    for (const [name] of nodeEntries(record)) {
      if (name === "?xml" || name === "#comment" || name === "#text") continue;
      if (name === "#cdata" || name.startsWith("?")) {
        unsafeSvg(context, "SVG contains content outside its root element.");
      }
      roots.push(record);
    }
  }
  if (roots.length !== 1 || !Object.hasOwn(roots[0]!, "svg")) {
    unsafeSvg(context, "SVG must contain exactly one unprefixed svg root.");
  }

  const root = roots[0]!;
  const attributes = root[":@"] ?? {};
  if (attributes.xmlns !== SVG_NAMESPACE) {
    unsafeSvg(context, "SVG root must declare the SVG namespace unambiguously.");
  }
  if (Object.keys(attributes).some((name) => name.startsWith("xmlns:"))) {
    unsafeSvg(context, "SVG contains an ambiguous namespace declaration.");
  }
  inspectSvgNode(root, context, true);
}

/** Resolve, contain, open, verify, and encode one local image candidate. */
export async function embedLocalImageAsset(
  sourceUrl: string,
  context: ImageAssetContext,
): Promise<EmbeddedImageAsset> {
  const decodedPath = decodeLocalPath(sourceUrl, context);

  let canonicalBase: string;
  try {
    canonicalBase = await realpath(resolve(context.assetBase));
  } catch {
    assetFailure(context, "Image asset base could not be resolved.");
  }

  const lexicalTarget = resolve(canonicalBase, decodedPath);
  if (!isContained(canonicalBase, lexicalTarget)) {
    assetFailure(context, "Image path escapes the source directory.");
  }

  let canonicalTarget: string;
  try {
    canonicalTarget = await realpath(lexicalTarget);
  } catch (error) {
    if (hasNodeCode(error, "ENOENT", "ENOTDIR")) {
      assetFailure(context, "Image asset was not found.");
    }
    assetFailure(context, "Image asset could not be read or resolved.");
  }
  if (!isContained(canonicalBase, canonicalTarget)) {
    assetFailure(context, "Image asset resolves outside the source directory.");
  }

  const extension = extname(canonicalTarget).toLowerCase();
  const mimeType = MIME_BY_EXTENSION[extension];
  if (mimeType === undefined) assetFailure(context, "Image type is not supported.");

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let bytes: Uint8Array;
  try {
    handle = await open(canonicalTarget, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) assetFailure(context, "Image asset is not a regular file.");
    bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat();
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      bytes.byteLength !== after.size
    ) {
      assetFailure(context, "Image asset changed while it was being read.");
    }
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    assetFailure(context, "Image asset could not be read.");
  } finally {
    await handle?.close().catch(() => undefined);
  }

  if (!hasTrustedSignature(bytes, extension)) {
    assetFailure(context, "Image contents do not match the supported image type.");
  }
  if (extension === ".svg") validateAuthoredSvg(bytes, context);

  return Object.freeze({
    mimeType,
    canonicalPath: canonicalTarget,
    dataUri: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`,
  });
}
