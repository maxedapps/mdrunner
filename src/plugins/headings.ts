import { createHeadingSlugger } from "../slug.ts";
import { defineHastPlugin, type HastPluginInput } from "satteri";

declare module "satteri" {
  interface DataMap {
    /** Plain text from the first authored level-one heading. */
    title?: string;
  }
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * Reserve existing generated IDs in one pass, then add collision-free IDs and
 * title metadata to authored headings in a second pass.
 */
export function headingMetadataPlugins(): readonly [HastPluginInput, HastPluginInput] {
  const slugger = createHeadingSlugger();

  const reserveExistingIds = defineHastPlugin({
    name: "mdrunner-heading-id-reservations",
    element: {
      // Sätteri treats an empty element filter as all HAST elements.
      filter: [],
      visit(node) {
        const id = node.properties?.id;
        if (typeof id === "string" && id !== "") slugger.reserve(id);
      },
    },
  });

  let hasTitle = false;
  const addHeadingMetadata = defineHastPlugin({
    name: "mdrunner-heading-metadata",
    element: {
      filter: HEADING_TAGS,
      visit(node, context) {
        // Generated headings such as Sätteri's footnote label have no source position.
        if (node.position === undefined) return;

        const text = context.textContent(node).trim();
        context.setProperty(node, "id", slugger.slug(text));
        if (!hasTitle && node.tagName === "h1" && text !== "") {
          hasTitle = true;
          context.data.title = text;
        }
      },
    },
  });

  return [reserveExistingIds, addHeadingMetadata];
}
