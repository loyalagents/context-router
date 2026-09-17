const GENERIC_STARTUP_FAILURE = "Application failed to start";

const SAFE_STARTUP_MESSAGES = new Set([
  "Invalid PORT: expected an integer between 0 and 65535",
  "CORS_ORIGIN must contain at least one origin",
  "MCP_HTTP_ALLOWED_ORIGINS must contain at least one origin",
  "Backend package root must be absolute",
  "Unable to read backend environment configuration",
  "Unable to parse backend environment configuration",
  "Custom runtime environment requires a custom application factory",
  "Unable to determine backend readiness address",
  "Backend shutdown deadline exceeded",
  "Backend startup interrupted by shutdown signal",
]);

const SAFE_LISTENER_ERROR_CODES = new Set([
  "EACCES",
  "EADDRINUSE",
  "EADDRNOTAVAIL",
  "EPERM",
]);

type ErrorRecord = {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
  message?: unknown;
  syscall?: unknown;
};

function collectSafeDiagnostics(
  error: unknown,
  diagnostics: string[],
  visited: Set<object>,
): void {
  if (typeof error !== "object" || error === null || visited.has(error)) {
    return;
  }
  visited.add(error);

  const record = error as ErrorRecord;
  const message = record.message;
  const code = record.code;
  const syscall = record.syscall;
  const errors = record.errors;
  const cause = record.cause;

  if (typeof message === "string" && SAFE_STARTUP_MESSAGES.has(message)) {
    diagnostics.push(message);
  }

  if (
    typeof code === "string" &&
    syscall === "listen" &&
    SAFE_LISTENER_ERROR_CODES.has(code)
  ) {
    diagnostics.push(`Backend listener failed (${code})`);
  }

  if (Array.isArray(errors)) {
    for (const nestedError of errors) {
      collectSafeDiagnostics(nestedError, diagnostics, visited);
    }
  }
  collectSafeDiagnostics(cause, diagnostics, visited);
}

export function formatHostedStartupFailure(error: unknown): string {
  const diagnostics: string[] = [];
  try {
    collectSafeDiagnostics(error, diagnostics, new Set());
  } catch {
    return GENERIC_STARTUP_FAILURE;
  }
  const uniqueDiagnostics = [...new Set(diagnostics)];

  return uniqueDiagnostics.length > 0
    ? `${GENERIC_STARTUP_FAILURE}: ${uniqueDiagnostics.join("; ")}`
    : GENERIC_STARTUP_FAILURE;
}
