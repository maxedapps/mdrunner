import type { ErrorSource } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";

export type PositionedNode = { readonly position?: unknown };

export function sourceLocation(source: MarkdownSource, node: PositionedNode): ErrorSource {
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
