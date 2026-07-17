export const errorCodes = {
  invalidArguments: "SOURCE_INVALID_ARGUMENTS",
  sourceRequired: "SOURCE_REQUIRED",
  invalidExtension: "SOURCE_INVALID_EXTENSION",
  fileNotFound: "SOURCE_FILE_NOT_FOUND",
  notRegularFile: "SOURCE_NOT_REGULAR_FILE",
  fileUnreadable: "SOURCE_FILE_UNREADABLE",
  stdinUnreadable: "SOURCE_STDIN_UNREADABLE",
  invalidUtf8: "SOURCE_INVALID_UTF8",
  emptyStdin: "SOURCE_EMPTY_STDIN",
  outputWriteFailed: "OUTPUT_WRITE_FAILED",
  unsafeLinkUrl: "RENDER_UNSAFE_LINK_URL",
  unsafeImageUrl: "RENDER_UNSAFE_IMAGE_URL",
  browserUnsupportedPlatform: "BROWSER_UNSUPPORTED_PLATFORM",
  browserLaunchFailed: "BROWSER_LAUNCH_FAILED",
  browserNonZeroExit: "BROWSER_NON_ZERO_EXIT",
  unexpected: "UNEXPECTED_ERROR",
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes];

/** Durable source context safe to retain after parser or filesystem objects are gone. */
export interface ErrorSource {
  readonly label: string;
  readonly line?: number;
  readonly column?: number;
}

function copySource(source: ErrorSource | undefined): ErrorSource | undefined {
  if (source === undefined) return undefined;

  const copied: { label: string; line?: number; column?: number } = {
    label: String(source.label),
  };
  if (source.line !== undefined) copied.line = source.line;
  if (source.column !== undefined) copied.column = source.column;
  return Object.freeze(copied);
}

/** An anticipated CLI failure whose display form never includes a stack trace. */
export class ExpectedError extends Error {
  readonly code: ErrorCode;
  readonly exitCode = 1 as const;
  readonly source: ErrorSource | undefined;

  constructor(code: ErrorCode, message: string, source?: ErrorSource) {
    super(message);
    this.name = "ExpectedError";
    this.code = code;
    this.source = copySource(source);
  }
}

export function normalizeError(error: unknown): ExpectedError {
  if (error instanceof ExpectedError) return error;

  if (error instanceof Error && error.message.trim() !== "") {
    return new ExpectedError(errorCodes.unexpected, error.message);
  }
  if (typeof error === "string" && error.trim() !== "") {
    return new ExpectedError(errorCodes.unexpected, error);
  }
  return new ExpectedError(errorCodes.unexpected, "Unexpected error.");
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
