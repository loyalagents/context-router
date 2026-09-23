import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import {
  LOCAL_APPLICATION_CONFIGURATION,
  LocalConfigurationModule,
  LocalConfigurationService,
} from "./local-configuration.module";

describe("LocalConfigurationModule", () => {
  const poisonedEnvironment = {
    NODE_ENV: "development-canary",
    ENABLE_DEMO_RESET: "true",
    GRAPHQL_PLAYGROUND: "true",
    GRAPHQL_DEBUG: "true",
    DOC_UPLOAD_MAX_BYTES: "1",
    DOC_UPLOAD_MAX_SUGGESTIONS: "1",
    FORM_FILL_MAX_BYTES: "1",
    FORM_FILL_CONFIDENCE_THRESHOLD: "1",
    "app.isDevelopment": "environment-canary",
    "mcp.tools.preferences.maxSearchResults": "1",
  } as const;

  const originalEnvironment = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [key, value] of Object.entries(poisonedEnvironment)) {
      originalEnvironment.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns only fixed local application values and never ambient values", () => {
    const service = new LocalConfigurationService(
      LOCAL_APPLICATION_CONFIGURATION,
    );

    expect(service.get("app.nodeEnv")).toBe("production");
    expect(service.get("app.isDevelopment")).toBe(false);
    expect(service.get("app.isProduction")).toBe(true);
    expect(service.get("app.enableDemoReset")).toBe(false);
    expect(service.get("graphql.playground")).toBe(false);
    expect(service.get("graphql.debug")).toBe(false);
    expect(service.get("graphql.introspection")).toBe(false);
    expect(service.get("documentUpload.maxFileSizeBytes")).toBe(10_485_760);
    expect(service.get("documentUpload.maxSuggestions")).toBe(25);
    expect(service.get("documentUpload.allowedMimeTypes")).toEqual([
      "text/plain",
      "text/markdown",
      "application/json",
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/yaml",
      "text/yaml",
      "application/x-yaml",
    ]);
    expect(service.get("formFill.maxFileSizeBytes")).toBe(10_485_760);
    expect(service.get("formFill.confidenceThreshold")).toBe(0.75);
    expect(service.get("formFill.allowedMimeTypes")).toEqual([
      "application/pdf",
    ]);
    expect(service.get("mcp.tools.preferences.maxSearchResults")).toBe(100);
    expect(service.get("NODE_ENV")).toBeUndefined();
    expect(service.get("missing", "fallback")).toBe("fallback");
  });

  it("provides the local service under the shared ConfigService token", () => {
    const module = LocalConfigurationModule.register();
    const providers = module.providers ?? [];

    expect(module.global).toBe(true);
    expect(providers).toContainEqual({
      provide: ConfigService,
      useExisting: LocalConfigurationService,
    });
    expect(module.exports).toContain(ConfigService);
  });

  it("resolves the custom service under the shared token in Nest composition", async () => {
    const module = await Test.createTestingModule({
      imports: [LocalConfigurationModule.register()],
    }).compile();

    try {
      const configService = module.get(ConfigService);
      expect(configService).toBeInstanceOf(LocalConfigurationService);
      expect(configService.get("app.isDevelopment")).toBe(false);
    } finally {
      await module.close();
    }
  });

  it("fails closed for absent required values without exposing ambient data", () => {
    const service = new LocalConfigurationService(
      LOCAL_APPLICATION_CONFIGURATION,
    );

    expect(() => service.getOrThrow("missing")).toThrow(
      "Local application configuration is incomplete",
    );
    expect(() => service.getOrThrow("missing")).not.toThrow(
      "development-canary",
    );
  });
});
