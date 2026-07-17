export interface HeadingSlugger {
  reserve(id: string): void;
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
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();

  return {
    reserve(id) {
      used.add(id);
    },
    slug(value) {
      const base = slugifyHeading(value);
      let suffix = nextSuffix.get(base) ?? 1;
      let candidate = suffix === 1 ? base : `${base}-${suffix}`;
      while (used.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
      }
      used.add(candidate);
      nextSuffix.set(base, suffix + 1);
      return candidate;
    },
  };
}
