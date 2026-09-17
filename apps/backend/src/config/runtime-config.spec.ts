import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  DEFAULT_CORS_ORIGINS,
  loadRuntimeConfiguration,
  resolveRuntimeConfiguration,
} from "./runtime-config";
import { appConfigLoader } from "./app.config";
import { createMcpConfiguration } from "./mcp.config";

describe("runtime configuration", () => {
  it("preserves development-only behavior when NODE_ENV is absent", () => {
    const runtime = resolveRuntimeConfiguration({});

    expect(appConfigLoader(runtime, {})()).toMatchObject({
      nodeEnv: "development",
      isDevelopment: false,
      isProduction: false,
      enableDemoReset: false,
    });
    expect(appConfigLoader(runtime, { NODE_ENV: "development" })()).toMatchObject(
      {
        nodeEnv: "development",
        isDevelopment: true,
        isProduction: false,
      },
    );
  });

  describe("PORT", () => {
    it.each([
      [undefined, 3000],
      ["", 3000],
      ["0", 0],
      ["1", 1],
      ["3000", 3000],
      ["65535", 65535],
    ])("normalizes %p to %p", (PORT, expected) => {
      expect(resolveRuntimeConfiguration({ PORT }).port).toBe(expected);
    });

    it.each([
      "-1",
      "65536",
      "1.5",
      "1e3",
      "0x10",
      "+3000",
      " 3000 ",
      "3000junk",
      "NaN",
      "Infinity",
    ])("rejects invalid value %p without echoing it", (PORT) => {
      expect(() => resolveRuntimeConfiguration({ PORT })).toThrow("PORT");
      try {
        resolveRuntimeConfiguration({ PORT });
      } catch (error) {
        expect(String(error)).not.toContain(PORT);
      }
    });
  });

  it("normalizes the optional host and CORS origins without broadening policy", () => {
    const defaults = resolveRuntimeConfiguration({});
    expect(defaults).toEqual({
      port: 3000,
      host: undefined,
      corsOrigins: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3002",
      ],
    });
    expect(DEFAULT_CORS_ORIGINS).toEqual(defaults.corsOrigins);
    expect(
      resolveRuntimeConfiguration({
        APP_HOST: "127.0.0.1",
        CORS_ORIGIN:
          " https://one.example,https://two.example, https://one.example ,,",
      }),
    ).toEqual({
      port: 3000,
      host: "127.0.0.1",
      corsOrigins: ["https://one.example", "https://two.example"],
    });
    expect(
      resolveRuntimeConfiguration({ APP_HOST: "", CORS_ORIGIN: "" }),
    ).toEqual({
      port: 3000,
      host: undefined,
      corsOrigins: DEFAULT_CORS_ORIGINS,
    });
    expect(() => resolveRuntimeConfiguration({ CORS_ORIGIN: " , , " })).toThrow(
      "CORS_ORIGIN",
    );
  });

  it("rejects a relative package root instead of resolving it through caller cwd", () => {
    expect(() =>
      loadRuntimeConfiguration({
        packageRoot: "apps/backend",
        environment: {},
      }),
    ).toThrow("absolute");
  });

  it("loads only package-root env files with process > .env.local > .env precedence", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "runtime-config-root-"));
    const hostileCwd = mkdtempSync(join(tmpdir(), "runtime-config-cwd-"));
    const originalCwd = process.cwd();
    const environment: NodeJS.ProcessEnv = {
      PORT: "4300",
      PROCESS_ONLY: "process",
    };

    writeFileSync(
      join(packageRoot, ".env"),
      [
        "PORT=4100",
        "CORS_ORIGIN=https://base.example",
        "BASE_ONLY=base",
        "COLON_ONLY: base-colon",
        "SHARED_VALUE=base",
      ].join("\n"),
    );
    writeFileSync(
      join(packageRoot, ".env.local"),
      [
        "PORT=4200",
        "APP_HOST=127.0.0.1",
        "CORS_ORIGIN=https://local.example",
        "LOCAL_ONLY=local",
        "SHARED_VALUE=local",
      ].join("\n"),
    );
    writeFileSync(
      join(hostileCwd, ".env"),
      "PORT=9999\nCALLER_CWD_CANARY=must-not-load\n",
    );
    writeFileSync(
      join(hostileCwd, ".env.local"),
      "CORS_ORIGIN=https://poison.example\n",
    );

    try {
      process.chdir(hostileCwd);
      expect(loadRuntimeConfiguration({ packageRoot, environment })).toEqual({
        port: 4300,
        host: "127.0.0.1",
        corsOrigins: ["https://local.example"],
      });
      expect(environment).toMatchObject({
        PORT: "4300",
        PROCESS_ONLY: "process",
        BASE_ONLY: "base",
        COLON_ONLY: "base-colon",
        LOCAL_ONLY: "local",
        SHARED_VALUE: "local",
      });
      expect(environment.CALLER_CWD_CANARY).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      rmSync(packageRoot, { recursive: true, force: true });
      rmSync(hostileCwd, { recursive: true, force: true });
    }
  });

  it("allows missing package-root env files without mutating global process env", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "runtime-config-empty-"));
    const environment: NodeJS.ProcessEnv = {};
    const originalPort = process.env.PORT;

    try {
      expect(loadRuntimeConfiguration({ packageRoot, environment }).port).toBe(
        3000,
      );
      expect(process.env.PORT).toBe(originalPort);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });

  it("shares normalized CORS origins with MCP unless an explicit override wins", () => {
    const runtime = resolveRuntimeConfiguration({
      CORS_ORIGIN: " https://one.example,https://two.example ",
    });
    const inherited = createMcpConfiguration({}, runtime.corsOrigins);
    const overridden = createMcpConfiguration(
      {
        MCP_HTTP_ALLOWED_ORIGINS:
          " https://mcp.example,https://mcp.example,https://other.example ",
      },
      runtime.corsOrigins,
    );

    expect(inherited.httpTransport.allowedOrigins).toBe(runtime.corsOrigins);
    expect(inherited.httpTransport.allowedOrigins).not.toContain("*");
    expect(overridden.httpTransport.allowedOrigins).toEqual([
      "https://mcp.example",
      "https://other.example",
    ]);
  });
});
