import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseMermaid, renderMermaidSVG, type RenderOptions } from "beautiful-mermaid";
import { defineHastPlugin, type HastPluginInput } from "satteri";
import type { Element, ElementContent } from "hast";

import { ExpectedError } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";
import { sourceLocation, type PositionedNode } from "./source-location.ts";

const MERMAID_CLASS = "language-mermaid";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAFE_FRAGMENT = /^#[A-Za-z_][A-Za-z\d_.:-]*$/;
const GOOGLE_FONT_IMPORT =
  /^\s*@import\s+url\(["']https:\/\/fonts\.googleapis\.com\/css2\?family=[^"'\r\n)]+["']\);\s*$/gim;

const RENDER_OPTIONS: Readonly<RenderOptions> = Object.freeze({
  bg: "var(--mdr-background)",
  fg: "var(--mdr-foreground)",
  line: "var(--mdr-border)",
  accent: "var(--mdr-accent)",
  muted: "var(--mdr-muted)",
  surface: "var(--mdr-surface)",
  border: "var(--mdr-border)",
  font: "system-ui",
  transparent: true,
  interactive: false,
});

type DiagramFamily = "flowchart" | "state" | "sequence" | "class" | "ER" | "XY";
type MermaidRenderer = (source: string, options?: RenderOptions) => string;
type OrderedXmlNode = Record<string, unknown>;

function invalid(source: MarkdownSource, node: PositionedNode, message: string): never {
  throw new ExpectedError(message, sourceLocation(source, node));
}

function unsafe(source: MarkdownSource, node: PositionedNode, message: string): never {
  throw new ExpectedError(message, sourceLocation(source, node));
}

function meaningfulLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("%%"));
}

function finiteList(value: string): boolean {
  const values = value.split(",").map((item) => item.trim());
  return values.length > 0 && values.every((item) => item !== "" && Number.isFinite(Number(item)));
}

const FLOW_ARROW = /(?:-->|---|-\.->|-\.-|==>|===)/;
const SEQUENCE_MESSAGE = /^\S+?\s*(?:->>|-->>|-\)|--\)|-x|--x|->|-->)\s*[+-]?\S+?\s*:\s*.+$/;
const CLASS_RELATION =
  /^\S+\s+(?:"[^"]*"\s+)?(?:<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?|--)\s+(?:"[^"]*"\s+)?\S+(?:\s*:\s*.+)?$/;
const ER_RELATION = /^\S+\s+[|o}{]+(?:--|\.\.)[|o}{]+\s+\S+\s*:\s*.+$/;

function gateFlowOrState(text: string, lines: readonly string[]): boolean {
  // Pin the common silent-parser case where an arrow has no target. Beyond
  // this, delegate grammar recognition to beautiful-mermaid.
  if (
    lines
      .slice(1)
      .some((line) => FLOW_ARROW.test(line) && /(?:-->|---|-\.->|-\.-|==>|===)\s*$/.test(line))
  ) {
    return false;
  }
  try {
    const graph = parseMermaid(text);
    return graph.nodes.size > 0 || graph.edges.length > 0 || graph.subgraphs.length > 0;
  } catch {
    return false;
  }
}

function gateSequence(lines: readonly string[]): boolean {
  const body = lines.slice(1);
  const malformedMessage = body.some(
    (line) => /(?:->>|-->>|-\)|--\)|-x|--x|->|-->)/.test(line) && !SEQUENCE_MESSAGE.test(line),
  );
  if (malformedMessage) return false;
  return body.some(
    (line) =>
      /^(?:participant|actor)\s+\S+(?:\s+as\s+.+)?$/i.test(line) ||
      /^Note\s+(?:left of|right of|over)\s+[^:]+:\s*.+$/i.test(line) ||
      SEQUENCE_MESSAGE.test(line),
  );
}

function gateClass(lines: readonly string[]): boolean {
  const body = lines.slice(1);
  const malformedRelation = body.some((line) =>
    /(?:<\|--|<\|\.\.|\*--|o--|-->|--\*|--o|--\|>|\.\.>|\.\.\|>|<--|<\.\.?|--)\s*$/.test(line),
  );
  if (malformedRelation) return false;
  return body.some(
    (line) =>
      /^class\s+\S+(?:\s*~\w+~)?(?:\s*\{|\s*$)/.test(line) ||
      /^\S+\s*:\s*.+$/.test(line) ||
      CLASS_RELATION.test(line),
  );
}

function gateEr(lines: readonly string[]): boolean {
  const body = lines.slice(1);
  if (body.some((line) => /[|o}{]+(?:--|\.\.)[|o}{]+\s*$/.test(line))) return false;
  return body.some((line) => /^\S+\s*\{$/.test(line) || ER_RELATION.test(line));
}

function gateXy(lines: readonly string[]): boolean {
  let hasSeries = false;
  for (const line of lines.slice(1)) {
    if (!/^(?:bar|line)\b/.test(line)) continue;
    const series = /^(?:bar|line)\s+\[([^\]]+)\]$/.exec(line);
    if (series?.[1] === undefined || !finiteList(series[1])) return false;
    hasSeries = true;
  }
  return hasSeries;
}

function diagramFamily(text: string, source: MarkdownSource, node: PositionedNode): DiagramFamily {
  const lines = meaningfulLines(text);
  const header = lines[0] ?? "";
  let family: DiagramFamily;
  let meaningful: boolean;

  if (/^(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL)$/i.test(header)) {
    family = "flowchart";
    meaningful = gateFlowOrState(text, lines);
  } else if (/^stateDiagram(?:-v2)?$/i.test(header)) {
    family = "state";
    meaningful = gateFlowOrState(text, lines);
  } else if (/^sequenceDiagram$/i.test(header)) {
    family = "sequence";
    meaningful = gateSequence(lines);
  } else if (/^classDiagram$/i.test(header)) {
    family = "class";
    meaningful = gateClass(lines);
  } else if (/^erDiagram$/i.test(header)) {
    family = "ER";
    meaningful = gateEr(lines);
  } else if (/^xychart(?:-beta)?(?:\s+horizontal)?$/i.test(header)) {
    family = "XY";
    meaningful = gateXy(lines);
  } else {
    invalid(source, node, "Unsupported or invalid Mermaid diagram header.");
  }

  if (!meaningful) invalid(source, node, `Invalid or empty Mermaid ${family} diagram.`);
  return family;
}

function elementNames(node: OrderedXmlNode): string[] {
  return Object.keys(node).filter((key) => key !== ":@" && key !== "#text" && !key.startsWith("?"));
}

function checkCssValue(value: string): string | undefined {
  if (/@import\b/i.test(value)) return "CSS imports are not allowed";
  if (/expression\s*\(/i.test(value)) return "CSS expressions are not allowed";
  if (value.includes("\\") && value.includes("(")) return "CSS escapes are not allowed";
  for (const match of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!SAFE_FRAGMENT.test(match[2]!.trim())) return "external CSS URLs are not allowed";
  }
  return undefined;
}

function inspectXmlNode(node: OrderedXmlNode): string | undefined {
  for (const name of elementNames(node)) {
    const localName = name.toLowerCase().split(":").at(-1)!;
    if (localName === "script" || localName === "foreignobject") {
      return `active <${name}> elements are not allowed`;
    }
  }

  const attributes = node[":@"];
  if (typeof attributes === "object" && attributes !== null) {
    for (const [rawName, rawValue] of Object.entries(attributes)) {
      const name = rawName.replace(/^@_/, "").toLowerCase();
      const localName = name.split(":").at(-1)!;
      if (localName.startsWith("on")) return `event attribute ${name} is not allowed`;
      if (localName === "href" || localName === "src") {
        if (typeof rawValue !== "string" || !SAFE_FRAGMENT.test(rawValue.trim())) {
          return `external ${name} references are not allowed`;
        }
      }
      if (typeof rawValue === "string") {
        const cssFailure = checkCssValue(rawValue);
        if (cssFailure !== undefined) return cssFailure;
      }
    }
  }

  const text = node["#text"];
  if (typeof text === "string") {
    const cssFailure = checkCssValue(text);
    if (cssFailure !== undefined) return cssFailure;
  }

  for (const name of elementNames(node)) {
    const children = node[name];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      if (typeof child !== "object" || child === null) continue;
      const failure = inspectXmlNode(child as OrderedXmlNode);
      if (failure !== undefined) return failure;
    }
  }
  return undefined;
}

function makeResponsive(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (_match, rawAttributes: string) => {
    const attributes = rawAttributes.replace(/\s(?:width|height)="[^"]*"/gi, "");
    return `<svg${attributes} width="100%" height="auto" aria-hidden="true" focusable="false">`;
  });
}

/** Strip upstream font imports, then fail closed on generated SVG invariants. */
export function validateGeneratedMermaidSvg(
  generated: string,
  source: MarkdownSource,
  node: PositionedNode = {},
): string {
  const svg = makeResponsive(generated.replace(GOOGLE_FONT_IMPORT, ""));
  if (XMLValidator.validate(svg) !== true)
    unsafe(source, node, "Generated Mermaid SVG is malformed.");
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(svg)) {
    unsafe(source, node, "Generated Mermaid SVG contains forbidden declarations.");
  }

  let document: unknown;
  try {
    document = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: false,
      processEntities: false,
    }).parse(svg);
  } catch {
    unsafe(source, node, "Generated Mermaid SVG could not be inspected.");
  }

  if (!Array.isArray(document)) unsafe(source, node, "Generated Mermaid output has no SVG root.");
  const roots = (document as unknown[]).filter(
    (entry): entry is OrderedXmlNode =>
      typeof entry === "object" &&
      entry !== null &&
      elementNames(entry as OrderedXmlNode).length > 0,
  );
  if (roots.length !== 1 || elementNames(roots[0]!).length !== 1 || !("svg" in roots[0]!)) {
    unsafe(source, node, "Generated Mermaid output must contain exactly one SVG root.");
  }
  const rootAttributes = roots[0]![":@"];
  if (
    typeof rootAttributes !== "object" ||
    rootAttributes === null ||
    (rootAttributes as Record<string, unknown>)["@_xmlns"] !== SVG_NAMESPACE
  ) {
    unsafe(source, node, "Generated Mermaid root must use the SVG namespace.");
  }
  const failure = inspectXmlNode(roots[0]!);
  if (failure !== undefined) unsafe(source, node, `Generated Mermaid SVG is unsafe: ${failure}.`);
  return svg;
}

function mermaidCode(pre: Element): Element | undefined {
  if (pre.children.length !== 1) return undefined;
  const code = pre.children[0];
  if (code?.type !== "element" || code.tagName !== "code") return undefined;
  const classes = code.properties.className;
  if (!Array.isArray(classes) || !classes.includes(MERMAID_CLASS)) return undefined;
  return code;
}

/** Replace supported Mermaid fences with validated, static, responsive SVG figures. */
export function mermaidDiagramPlugin(
  source: MarkdownSource,
  renderer: MermaidRenderer = renderMermaidSVG,
): HastPluginInput {
  return () =>
    defineHastPlugin({
      name: "mdr-mermaid",
      element: {
        filter: ["pre"],
        visit(node, context) {
          const code = mermaidCode(node);
          if (code === undefined) return;
          const diagramSource = context.textContent(code);
          const family = diagramFamily(diagramSource, source, node);

          let generated: string;
          try {
            generated = renderer(diagramSource, RENDER_OPTIONS);
          } catch (error) {
            if (error instanceof ExpectedError) throw error;
            invalid(source, node, `Invalid Mermaid ${family} diagram.`);
          }

          const svg = validateGeneratedMermaidSvg(generated, source, node);
          const figure: Element = {
            type: "element",
            tagName: "figure",
            properties: {
              className: ["mermaid-diagram"],
              role: "img",
              ariaLabel: `Mermaid ${family} diagram`,
            },
            children: [{ type: "raw", value: svg } as ElementContent],
          };
          context.replaceNode(node, figure);
        },
      },
    });
}
