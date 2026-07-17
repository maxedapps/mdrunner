export interface HeadingSlugger {
  slug(value: string): string;
}

const WORD = /[\p{Letter}\p{Number}][\p{Letter}\p{Number}\p{Mark}]*/gu;

/** Create a stable, Unicode-preserving base slug for heading text. */
export function slugifyHeading(value: string): string {
  const words = value.normalize("NFKC").toLowerCase().match(WORD);
  return words === null || words.length === 0 ? "section" : words.join("-");
}

/** Create document-local slug state. Duplicate suffixes begin at `-2`. */
export function createHeadingSlugger(): HeadingSlugger {
  const counts = new Map<string, number>();

  return {
    slug(value) {
      const base = slugifyHeading(value);
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      return count === 1 ? base : `${base}-${count}`;
    },
  };
}
