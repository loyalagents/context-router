/** Application contracts: no provider, HTTP or process-control types. */
export interface AiExecutionOptions {
  signal?: AbortSignal;
  /** Absolute performance.now() deadline in this process, never a wall-clock timestamp. */
  deadline?: number;
}

export interface AiCapabilities {
  readonly text: boolean;
  readonly structured: boolean;
  readonly fileMimeTypes: readonly string[];
  readonly strictExecutionControls: boolean;
  /** Configured labels; not artifact or runtime-identity attestation. */
  readonly runtime?: string;
  readonly model?: string;
}

export interface AiStatus {
  readonly state: "available" | "unavailable" | "busy" | "unsupported";
  readonly configured: boolean;
}

export interface AiCapabilityProvider {
  readonly capabilities: AiCapabilities;
  getStatus(options?: AiExecutionOptions): Promise<AiStatus>;
}

export const HOSTED_AI_CAPABILITIES: AiCapabilities = Object.freeze({
  text: true,
  structured: true,
  strictExecutionControls: false,
  fileMimeTypes: Object.freeze([
    "text/plain",
    "text/markdown",
    "application/pdf",
    "image/png",
    "image/jpeg",
  ]),
});
export const LOCAL_AI_CAPABILITIES: AiCapabilities = Object.freeze({
  text: true,
  structured: true,
  strictExecutionControls: true,
  fileMimeTypes: Object.freeze([
    "text/plain",
    "text/markdown",
    "application/json",
    "application/x-yaml",
    "application/yaml",
    "text/yaml",
    "application/pdf",
  ]),
});
export const UNAVAILABLE_AI_CAPABILITIES: AiCapabilities = Object.freeze({
  text: false,
  structured: false,
  strictExecutionControls: false,
  fileMimeTypes: Object.freeze([]),
});

const messages = Object.freeze({
  unavailable: "Local model is unavailable",
  unsupported: "AI capability unsupported",
  busy: "Local model busy",
  input_limit: "Local model input limit",
  context_limit: "Local model context limit",
  cancelled: "Local model cancelled",
  deadline: "Local model deadline",
  invalid_response: "Local model invalid response",
  unsafe_configuration: "Local model configuration unavailable",
});
export type AiErrorKind = keyof typeof messages;
export class AiError extends Error {
  readonly kind: AiErrorKind;
  constructor(kind: AiErrorKind) {
    super(messages[kind]);
    this.name = "AiError";
    this.kind = kind;
  }
}

export function rejectUnsupportedControls(options?: AiExecutionOptions): void {
  if (options?.signal !== undefined || options?.deadline !== undefined)
    throw new AiError("unsupported");
}

/** One budget per workflow, passed unchanged through all awaited model/consumer stages. */
export function createAiWorkflow(
  capabilities: AiCapabilities,
  requested: AiExecutionOptions = {},
) {
  if (!capabilities.strictExecutionControls) {
    rejectUnsupportedControls(requested);
    return {
      options: Object.freeze({}) as Readonly<AiExecutionOptions>,
      check: () => {},
    };
  }
  if (requested.deadline !== undefined && !Number.isFinite(requested.deadline))
    throw new AiError("deadline");
  const options: Readonly<AiExecutionOptions> = Object.freeze({
    ...(requested.signal ? { signal: requested.signal } : {}),
    deadline: Math.min(
      requested.deadline ?? Infinity,
      performance.now() + 180000,
    ),
  });
  const check = () => {
    if (options.signal?.aborted) throw new AiError("cancelled");
    if (performance.now() >= options.deadline) throw new AiError("deadline");
  };
  check();
  return { options, check };
}
