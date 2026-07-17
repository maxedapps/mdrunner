import { createHeadingSlugger } from "../slug.ts";
import { defineHastPlugin, type HastPluginInput } from "satteri";

declare module "satteri" {
  interface DataMap {
    /** Plain text from the first authored level-one heading. */
    title?: string;
  }
}

const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/** Add IDs and title metadata to authored headings with document-local state. */
export function headingMetadataPlugin(): HastPluginInput {
  return () => {
    const slugger = createHeadingSlugger();
    let hasTitle = false;

    return defineHastPlugin({
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
  };
}
