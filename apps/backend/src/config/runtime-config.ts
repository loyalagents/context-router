import { registerAs } from "@nestjs/config";
import { parse } from "dotenv";
import { readFileSync } from "fs";
import { isAbsolute, join } from "path";

export interface RuntimeEnvironment extends NodeJS.ProcessEnv {
  PORT?: string;
  APP_HOST?: string;
  CORS_ORIGIN?: string;
}

export interface RuntimeConfiguration {
  port: number;
  host?: string;
  corsOrigins: string[];
}

export interface LoadRuntimeConfigurationOptions {
  packageRoot: string;
  environment?: RuntimeEnvironment;
}

export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
];

function parsePort(value: string | undefined): number {
  if (value === undefined || value === "") return 3000;
  if (!/^\d+$/.test(value)) {
    throw new Error("Invalid PORT: expected an integer between 0 and 65535");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("Invalid PORT: expected an integer between 0 and 65535");
  }
  return port;
}

export function normalizeOriginList(
  value: string | undefined,
  variableName: "CORS_ORIGIN" | "MCP_HTTP_ALLOWED_ORIGINS",
): string[] | undefined {
  if (value === undefined || value === "") return undefined;

  const origins = [
    ...new Set(value.split(",").map((origin) => origin.trim())),
  ].filter(Boolean);
  if (origins.length === 0) {
    throw new Error(`${variableName} must contain at least one origin`);
  }
  return origins;
}

export function resolveRuntimeConfiguration(
  environment: RuntimeEnvironment = process.env,
): RuntimeConfiguration {
  return {
    port: parsePort(environment.PORT),
    host: environment.APP_HOST || undefined,
    corsOrigins: normalizeOriginList(
      environment.CORS_ORIGIN,
      "CORS_ORIGIN",
    ) ?? [...DEFAULT_CORS_ORIGINS],
  };
}

export function loadRuntimeConfiguration({
  packageRoot,
  environment = process.env,
}: LoadRuntimeConfigurationOptions): RuntimeConfiguration {
  if (!isAbsolute(packageRoot)) {
    throw new Error("Backend package root must be absolute");
  }

  for (const filename of [".env.local", ".env"]) {
    let content: string;
    try {
      content = readFileSync(join(packageRoot, filename), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error("Unable to read backend environment configuration");
    }

    let parsed: NodeJS.Dict<string>;
    try {
      parsed = parse(content);
    } catch {
      throw new Error("Unable to parse backend environment configuration");
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined && environment[key] === undefined) {
        environment[key] = value;
      }
    }
  }

  return resolveRuntimeConfiguration(environment);
}

export function runtimeConfigLoader(configuration: RuntimeConfiguration) {
  return registerAs("runtime", () => configuration);
}
