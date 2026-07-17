export interface ErrorSource {
  readonly label: string;
  readonly line?: number;
  readonly column?: number;
}

function copySource(source: ErrorSource | undefined): ErrorSource | undefined {
  if (source === undefined) return undefined;
  return Object.freeze({
    label: String(source.label),
    ...(source.line === undefined ? {} : { line: source.line }),
    ...(source.column === undefined ? {} : { column: source.column }),
  });
}

/** An anticipated CLI failure whose display form never includes a stack trace. */
export class ExpectedError extends Error {
  readonly source: ErrorSource | undefined;

  constructor(message: string, source?: ErrorSource) {
    super(message);
    this.name = "ExpectedError";
    this.source = copySource(source);
  }
}

export function normalizeError(error: unknown): ExpectedError {
  if (error instanceof ExpectedError) return error;
  if (error instanceof Error && error.message.trim() !== "")
    return new ExpectedError(error.message);
  if (typeof error === "string" && error.trim() !== "") return new ExpectedError(error);
  return new ExpectedError("Unexpected error.");
}

export function formatError(error: unknown): string {
  const normalized = normalizeError(error);
  const { source } = normalized;
  if (source === undefined) return normalized.message;

  let location = source.label;
  if (source.line !== undefined) location += `:${source.line}`;
  if (source.column !== undefined) location += `:${source.column}`;
  return `${location}: ${normalized.message}`;
}
