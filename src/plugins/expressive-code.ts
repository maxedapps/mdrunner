import expressiveCode, {
  createRenderer,
  type SatteriExpressiveCodeOptions,
  type SatteriExpressiveCodeRenderer,
} from "satteri-expressive-code";
import { defineHastPlugin, type HastPluginInput } from "satteri";

import { ExpectedError, errorCodes } from "../errors.ts";
import type { MarkdownSource } from "../source.ts";

const QUIET_LOGGER = Object.freeze({
  label: "mdrunner-code",
  debug(_message: string) {},
  info(_message: string) {},
  warn(_message: string) {},
  error(_message: string) {},
});

type RendererFactory = (
  options?: SatteriExpressiveCodeOptions,
) => Promise<SatteriExpressiveCodeRenderer>;

type PositionedNode = { readonly position?: unknown };

function sourceLocation(source: MarkdownSource, node: PositionedNode) {
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

function highlightingFailure(source: MarkdownSource, node: PositionedNode, error: unknown): never {
  if (error instanceof ExpectedError) throw error;
  const detail = error instanceof Error && error.message.trim() !== "" ? ` ${error.message}` : "";
  throw new ExpectedError(
    errorCodes.codeHighlightFailed,
    `Code highlighting failed.${detail}`,
    sourceLocation(source, node),
  );
}

/**
 * Highlight every remaining code fence with static Expressive Code output.
 * Mermaid must run before this plugin so its fences are no longer ordinary code.
 */
export function staticExpressiveCodePlugin(
  source: MarkdownSource,
  rendererFactory: RendererFactory = createRenderer,
): HastPluginInput {
  const upstream = expressiveCode({
    themes: ["github-light", "github-dark"],
    logger: QUIET_LOGGER,
    customCreateRenderer: async (options) => {
      const renderer = await rendererFactory(options);
      return { ...renderer, jsModules: [] };
    },
  });

  return () => {
    const definition = upstream();
    const element = definition.element;
    if (element === undefined || Array.isArray(element)) {
      throw new ExpectedError(
        errorCodes.codeHighlightFailed,
        "Code highlighting plugin initialization failed.",
        { label: source.label },
      );
    }

    return defineHastPlugin({
      ...definition,
      element: {
        filter: [...element.filter],
        async visit(node, context) {
          try {
            return await element.visit(node, context);
          } catch (error) {
            highlightingFailure(source, node, error);
          }
        },
      },
    });
  };
}
