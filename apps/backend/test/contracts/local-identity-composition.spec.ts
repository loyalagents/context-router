import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(__dirname, "..", "..", "src");

function read(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), "utf8");
}

describe("local identity application composition contract", () => {
  it("uses an explicit local root with shared application features and no hosted or MCP transport root", () => {
    const source = read("composition/local-application.module.ts");

    for (const required of [
      "LocalIdentityInfrastructureModule",
      "LocalModelAdapterModule",
      "LocalAuthModule",
      "LocalConfigurationModule",
      "ApplicationFeaturesModule",
      "McpAccessLogModule",
      "createGraphqlApiModule",
    ]) {
      expect(source).toContain(required);
    }
    for (const forbidden of [
      "AppModule",
      "from '../modules/auth/auth.module'",
      "McpModule",
      "HostedModelAdapterModule",
      "JwtStrategy",
      "VertexAiService",
      "VertexAiStructuredService",
      "ConfigModule",
      "auth0",
      "jwks",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("keeps one exact shared feature list for hosted and local composition", () => {
    const features = read("composition/application-features.module.ts");
    const hosted = read("app.module.ts");
    const local = read("composition/local-application.module.ts");

    for (const moduleName of [
      "UserModule",
      "HealthModule",
      "PreferencesModule",
      "PermissionGrantModule",
      "VertexAiModule",
      "WorkflowsModule",
      "ResetModule",
    ]) {
      expect(features).toContain(moduleName);
      expect(hosted).not.toContain(`import { ${moduleName} }`);
      expect(local).not.toContain(`import { ${moduleName} }`);
    }
    expect(hosted).toContain("ApplicationFeaturesModule");
    expect(local).toContain("ApplicationFeaturesModule");
  });

  it("binds local database and model implementations only at local composition boundaries", () => {
    const infrastructure = read(
      "composition/local-identity-infrastructure.module.ts",
    );
    const model = read("composition/local-model-adapter.module.ts");

    expect(infrastructure).toContain("SqliteStorageModule.register");
    expect(infrastructure).not.toContain("Postgres");
    expect(
      read(
        "composition/postgres-reference-local-identity-infrastructure.module.ts",
      ),
    ).toContain("PostgresStorageModule.registerLocal");
    expect(infrastructure).toContain("LocalIdentityFileStore");
    expect(infrastructure).not.toContain("LocalIdentityRepository");
    expect(infrastructure).not.toContain("LocalIdentityStateService");
    expect(infrastructure).not.toContain("LOCAL_IDENTITY_CONFIGURATION");
    expect(infrastructure).not.toContain("useValue: configuration");
    expect(model).toContain("LocalUnavailableModelService");
    expect(model).toContain("AI_TEXT_GENERATOR_PORT");
    expect(model).toContain("AI_STRUCTURED_OUTPUT_PORT");
    expect(model).not.toContain("@google-cloud/vertexai");
  });

  it("keeps shared permission-grant policy outside the MCP transport edge", () => {
    const service = read(
      "modules/permission-grant/permission-grant.service.ts",
    );
    const input = read(
      "modules/permission-grant/dto/set-permission-grant.input.ts",
    );
    const constants = read(
      "modules/permission-grant/permission-grant.constants.ts",
    );

    expect(constants).toContain("MANAGED_MCP_CLIENT_KEYS");
    expect(service).toContain("./permission-grant.constants");
    expect(input).toContain("../permission-grant.constants");
    expect(service).not.toContain("/mcp/");
    expect(input).not.toContain("/mcp/");
  });

  it("injects upload configuration without ambient reads in shared features", () => {
    for (const relativePath of [
      "modules/preferences/document-analysis/document-analysis.controller.ts",
      "modules/preferences/document-analysis/preference-extraction.service.ts",
      "modules/preferences/form-fill/form-fill.controller.ts",
      "modules/preferences/form-fill/form-fill.service.ts",
    ]) {
      const source = read(relativePath);
      expect(source).toContain("ConfigService");
      expect(source).not.toContain("process.env");
      expect(source).not.toContain("getDocumentUploadConfig");
      expect(source).not.toContain("getFormFillConfig");
    }

    for (const relativePath of [
      "modules/preferences/document-analysis/document-analysis.module.ts",
      "modules/preferences/form-fill/form-fill.module.ts",
    ]) {
      const source = read(relativePath);
      expect(source).toContain("MulterModule.registerAsync");
      expect(source).toContain("ConfigService");
    }
  });

  it("keeps preview lifecycle verified, non-listening, and secret-silent", () => {
    const source = read("bootstrap/local-identity-preview.ts");

    for (const required of [
      "verifyReadyState",
      "initializationPromise",
      ".init()",
      "logger: false",
      "SIGINT",
      "SIGTERM",
      "context-router.local-identity.preview.ready",
      "Local identity preview shutdown failed",
      "setInterval(",
      "clearInterval(",
    ]) {
      expect(source).toContain(required);
    }
    for (const forbidden of [
      ".listen(",
      "AppModule",
      "McpModule",
      "HostedModelAdapterModule",
      "AUTH0_",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
