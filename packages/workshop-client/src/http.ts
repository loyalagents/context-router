import {
  WorkshopClientConfig,
  WorkshopClientError,
  type WorkshopFetch,
} from "./types";

export interface ResolvedWorkshopClientConfig {
  apiKey: string;
  fetch: WorkshopFetch;
  graphqlUrl: string;
  uploadUrl: string;
}

interface GraphqlRequestInput {
  operation: string;
  query: string;
  variables?: Record<string, unknown>;
  userId?: string;
}

interface UploadRequestInput {
  operation: string;
  userId: string;
  body: FormData;
}

export function resolveClientConfig(
  config: WorkshopClientConfig,
): ResolvedWorkshopClientConfig {
  const apiKey = requireNonEmpty(config.apiKey, "apiKey", "createWorkshopClient");
  const baseUrl = requireNonEmpty(
    config.baseUrl,
    "baseUrl",
    "createWorkshopClient",
  );
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (!fetchImpl) {
    throw new WorkshopClientError({
      kind: "config",
      message:
        "No fetch implementation is available. Pass config.fetch when running outside modern browsers or Node 18+.",
      operation: "createWorkshopClient",
    });
  }

  return {
    apiKey,
    fetch: fetchImpl,
    graphqlUrl: config.graphqlUrl
      ? normalizeAbsoluteUrl(config.graphqlUrl, "graphqlUrl", "createWorkshopClient")
      : deriveGraphqlUrl(baseUrl),
    uploadUrl: config.uploadUrl
      ? normalizeAbsoluteUrl(config.uploadUrl, "uploadUrl", "createWorkshopClient")
      : deriveUploadUrl(baseUrl),
  };
}

export async function executeGraphql<TData>(
  config: ResolvedWorkshopClientConfig,
  input: GraphqlRequestInput,
): Promise<TData> {
  const headers = new Headers({ "content-type": "application/json" });
  if (input.userId) {
    headers.set("authorization", `Bearer ${config.apiKey}`);
    headers.set("x-user-id", input.userId);
  }

  let response: Response;
  try {
    response = await config.fetch(config.graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: input.query,
        variables: input.variables ?? {},
      }),
    });
  } catch (error) {
    throw wrapNetworkError(input.operation, error);
  }

  const raw = await parseResponseBody(response);
  if (!response.ok) {
    throw new WorkshopClientError({
      kind: "http",
      message: `HTTP ${response.status} from GraphQL endpoint`,
      operation: input.operation,
      statusCode: response.status,
      raw,
    });
  }

  if (!isObject(raw)) {
    throw new WorkshopClientError({
      kind: "http",
      message: "GraphQL endpoint returned a non-JSON response body",
      operation: input.operation,
      statusCode: response.status,
      raw,
    });
  }

  const errors = Array.isArray(raw.errors) ? raw.errors : undefined;
  if (errors && errors.length > 0) {
    throw new WorkshopClientError({
      kind: "graphql",
      message: errors
        .map((entry) =>
          isObject(entry) && typeof entry.message === "string"
            ? entry.message
            : "GraphQL request failed",
        )
        .join("; "),
      operation: input.operation,
      statusCode: response.status,
      raw,
    });
  }

  return raw.data as TData;
}

export async function executeUpload<TData>(
  config: ResolvedWorkshopClientConfig,
  input: UploadRequestInput,
): Promise<TData> {
  const headers = new Headers({
    authorization: `Bearer ${config.apiKey}`,
    "x-user-id": input.userId,
  });

  let response: Response;
  try {
    response = await config.fetch(config.uploadUrl, {
      method: "POST",
      headers,
      body: input.body,
    });
  } catch (error) {
    throw wrapNetworkError(input.operation, error);
  }

  const raw = await parseResponseBody(response);
  if (!response.ok) {
    throw new WorkshopClientError({
      kind: "http",
      message: `HTTP ${response.status} from upload endpoint`,
      operation: input.operation,
      statusCode: response.status,
      raw,
    });
  }

  if (!isObject(raw)) {
    throw new WorkshopClientError({
      kind: "http",
      message: "Upload endpoint returned a non-JSON response body",
      operation: input.operation,
      statusCode: response.status,
      raw,
    });
  }

  return raw as TData;
}

function normalizeAbsoluteUrl(
  value: string,
  fieldName: string,
  operation: string,
): string {
  try {
    return new URL(value).toString();
  } catch (error) {
    throw new WorkshopClientError({
      kind: "config",
      message: `${fieldName} must be an absolute URL`,
      operation,
      raw: error,
    });
  }
}

function deriveGraphqlUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const trimmedPath = trimTrailingSlash(url.pathname);
  if (trimmedPath === "/graphql" || trimmedPath.endsWith("/graphql")) {
    url.pathname = trimmedPath;
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  const prefix = normalizePrefix(trimmedPath);
  url.pathname = `${prefix}/graphql`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function deriveUploadUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const prefix =
    trimTrailingSlash(url.pathname) === "/graphql"
      ? ""
      : trimTrailingSlash(url.pathname).endsWith("/graphql")
        ? trimTrailingSlash(url.pathname).slice(0, -"/graphql".length)
        : normalizePrefix(url.pathname);

  url.pathname = `${prefix}/api/preferences/analysis`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function normalizePrefix(pathname: string): string {
  const trimmed = trimTrailingSlash(pathname);
  if (trimmed === "" || trimmed === "/") {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return "/";
  }
  return value.replace(/\/+$/, "");
}

function requireNonEmpty(
  value: string,
  fieldName: string,
  operation: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WorkshopClientError({
      kind: "config",
      message: `${fieldName} is required`,
      operation,
    });
  }
  return value.trim();
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return undefined;
    }
  }

  const text = await response.text();
  return text === "" ? undefined : text;
}

function wrapNetworkError(
  operation: string,
  error: unknown,
): WorkshopClientError {
  if (error instanceof WorkshopClientError) {
    return error;
  }
  return new WorkshopClientError({
    kind: "network",
    message: error instanceof Error ? error.message : "Network request failed",
    operation,
    raw: error,
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
