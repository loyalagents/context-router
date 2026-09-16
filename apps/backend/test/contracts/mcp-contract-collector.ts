import { ConfigService } from "@nestjs/config";
import { HttpException } from "@nestjs/common";
import mcpConfig from "../../src/config/mcp.config";
import { McpService } from "../../src/mcp/mcp.service";
import { McpAuthorizationService } from "../../src/mcp/auth/mcp-authorization.service";
import { McpClientRegistry } from "../../src/mcp/auth/mcp-client-registry.service";
import { McpAuthGuard } from "../../src/mcp/auth/mcp-auth.guard";
import { OAuthMetadataController } from "../../src/mcp/auth/oauth-metadata.controller";
import { DcrShimController } from "../../src/mcp/auth/dcr-shim.controller";
import { DcrRateLimitGuard } from "../../src/mcp/auth/dcr-rate-limit.guard";
import { PreferenceListTool } from "../../src/mcp/tools/preference-list.tool";
import { PreferenceSearchTool } from "../../src/mcp/tools/preference-search.tool";
import { PreferenceMutateTool } from "../../src/mcp/tools/preference-mutate.tool";
import { SmartSearchTool } from "../../src/mcp/tools/smart-search.tool";
import { SchemaConsolidationTool } from "../../src/mcp/tools/schema-consolidation.tool";
import { PermissionGrantListTool } from "../../src/mcp/tools/permission-grant-list.tool";
import { SchemaResource } from "../../src/mcp/resources/schema.resource";
import { McpCapability } from "../../src/mcp/types/mcp-authorization.types";
import { McpToolInterface } from "../../src/mcp/tools/base/mcp-tool.interface";

const TEST_ENV = {
  MCP_SERVER_URL: "http://127.0.0.1:3001",
  AUTH0_AUDIENCE: "https://baseline.invalid/api",
  AUTH0_DOMAIN: "baseline.invalid",
  AUTH0_MCP_CLAUDE_CLIENT_ID: "<claude-client-id>",
  AUTH0_MCP_CODEX_CLIENT_ID: "<codex-client-id>",
  AUTH0_MCP_FALLBACK_CLIENT_ID: "<fallback-client-id>",
};

function makeConfigService(values: Record<string, unknown>) {
  return {
    get: (key: string, defaultValue?: unknown) => values[key] ?? defaultValue,
  } as ConfigService;
}

function challengeResponse() {
  const output: {
    status?: number;
    headers: Record<string, string>;
    body?: unknown;
  } = {
    headers: {},
  };
  const response = {
    setHeader: (name: string, value: string) => {
      output.headers[name] = value;
      return response;
    },
    status: (status: number) => {
      output.status = status;
      return response;
    },
    json: (body: unknown) => {
      output.body = body;
      return response;
    },
  };
  return { output, response };
}

function normalizeDcrError(error: unknown) {
  if (!(error instanceof HttpException)) throw error;
  return { status: error.getStatus(), body: error.getResponse() };
}

export function collectMcpContractBaseline() {
  const originalEnv = process.env;
  const contractEnvironment: NodeJS.ProcessEnv = {
    ...originalEnv,
    ...TEST_ENV,
  };
  delete contractEnvironment.MCP_OAUTH_REGISTER_RATE_LIMIT;
  process.env = contractEnvironment;
  try {
    const config = mcpConfig();
    const values: Record<string, unknown> = {
      "mcp.server": config.server,
      "mcp.tools.preferences.enabled": true,
      "mcp.resources.schema.enabled": true,
      "mcp.clients": config.clients,
      "mcp.oauth.resource": config.oauth.resource,
      "mcp.oauth.serverUrl": config.oauth.serverUrl,
      "mcp.oauth.auth0.authorizationEndpoint":
        config.oauth.auth0.authorizationEndpoint,
      "mcp.oauth.auth0.tokenEndpoint": config.oauth.auth0.tokenEndpoint,
      "mcp.oauth.auth0.jwksUri": config.oauth.auth0.jwksUri,
      "mcp.oauth.scopes": config.oauth.scopes,
      "auth.auth0.domain": TEST_ENV.AUTH0_DOMAIN,
      "auth.auth0.issuer": `https://${TEST_ENV.AUTH0_DOMAIN}/`,
      "auth.auth0.audience": TEST_ENV.AUTH0_AUDIENCE,
    };
    const configService = makeConfigService(values);
    const authorization = new McpAuthorizationService(undefined as never);
    const tools: McpToolInterface[] = [
      new PreferenceListTool(undefined as never, authorization),
      new PreferenceSearchTool(
        undefined as never,
        configService,
        undefined as never,
        authorization,
      ),
      new SmartSearchTool(undefined as never, configService, authorization),
      new SchemaConsolidationTool(undefined as never, authorization),
      new PermissionGrantListTool(undefined as never),
      new PreferenceMutateTool(
        undefined as never,
        undefined as never,
        undefined as never,
        authorization,
      ),
    ];
    const resources = [new SchemaResource()];
    const service = new McpService(
      configService,
      tools,
      resources,
      authorization,
      undefined as never,
    );
    service.onModuleInit();
    const server = service.createServer({
      user: { userId: "<user-id>", email: "<email>" },
      client: {
        key: "claude",
        policy: config.clients[0],
      },
    }) as unknown as {
      _serverInfo: unknown;
      _instructions: string;
      _capabilities: unknown;
    };

    const visibility = Object.fromEntries(
      [
        ["claude", undefined],
        ["codex", undefined],
        ["fallback", undefined],
        ["unknown", undefined],
        ["claude-read-scope", ["preferences:read"]],
      ].map(([profile, grants]) => {
        const clientKey = String(profile).replace("-read-scope", "");
        const policy = config.clients.find((item) => item.key === clientKey)!;
        const resolved = { key: policy.key, policy };
        return [
          profile,
          {
            tools: tools
              .filter((tool) =>
                authorization.canAccessAny(
                  resolved,
                  tool.requiredAccess,
                  grants as McpCapability[] | undefined,
                ),
              )
              .map((tool) => tool.descriptor.name),
            resources: resources
              .filter((resource) =>
                authorization.canAccess(
                  resolved,
                  resource.requiredAccess,
                  grants as McpCapability[] | undefined,
                ),
              )
              .map((resource) => resource.descriptor.uri),
          },
        ];
      }),
    );

    const oauth = new OAuthMetadataController(configService);
    const registry = new McpClientRegistry(configService);
    registry.onModuleInit();
    const dcr = new DcrShimController(registry);
    const request = { headers: {}, ip: "127.0.0.1", socket: {} } as never;
    const dcrCases: Record<string, unknown> = {};
    for (const [name, redirectUris] of [
      ["claude", ["http://localhost:8081/callback"]],
      ["codex", ["http://127.0.0.1:8082/callback"]],
      ["fallback", ["https://chatgpt.com/connector_platform_oauth_redirect"]],
    ] as const) {
      dcrCases[name] = dcr.registerClient(
        { redirect_uris: redirectUris },
        request,
      );
    }
    for (const [name, redirectUris] of [
      ["empty", []],
      ["invalid", ["https://attacker.invalid/callback"]],
      [
        "mixed",
        ["http://localhost:8081/callback", "http://127.0.0.1:8082/callback"],
      ],
    ] as const) {
      try {
        dcr.registerClient({ redirect_uris: redirectUris }, request);
      } catch (error) {
        dcrCases[name] = normalizeDcrError(error);
      }
    }
    const missingClientDcr = new DcrShimController({
      resolveForDcr: () => ({
        status: "ok",
        client: { key: "claude", oauth: { redirectUris: [] } },
      }),
    } as unknown as McpClientRegistry);
    try {
      missingClientDcr.registerClient(
        { redirect_uris: ["http://localhost:8081/callback"] },
        request,
      );
    } catch (error) {
      dcrCases.missingConfiguredClientId = normalizeDcrError(error);
    }

    const originalDateNow = Date.now;
    const rateLimitGuard = new DcrRateLimitGuard(
      makeConfigService({
        "mcp.oauth.rateLimit.windowMs": config.oauth.rateLimit.windowMs,
        "mcp.oauth.rateLimit.maxRequests": config.oauth.rateLimit.maxRequests,
      }),
    );
    const rateLimitContext = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { "x-forwarded-for": "192.0.2.10" },
          ip: "127.0.0.1",
          socket: {},
        }),
      }),
    } as never;
    try {
      Date.now = () => 1_000;
      for (
        let attempt = 0;
        attempt <= config.oauth.rateLimit.maxRequests;
        attempt += 1
      ) {
        rateLimitGuard.canActivate(rateLimitContext);
      }
    } catch (error) {
      dcrCases.rateLimit = normalizeDcrError(error);
    } finally {
      Date.now = originalDateNow;
      rateLimitGuard.onModuleDestroy();
    }

    const guard = new McpAuthGuard(configService, undefined as never);
    const missing = challengeResponse();
    (guard as never as { sendAuthChallenge: Function }).sendAuthChallenge(
      missing.response,
      401,
      "missing_token",
    );
    const invalid = challengeResponse();
    (guard as never as { sendAuthChallenge: Function }).sendAuthChallenge(
      invalid.response,
      401,
      "invalid_token",
      "<verification-error>",
    );
    const insufficient = challengeResponse();
    guard.sendInsufficientScopeChallenge(
      insufficient.response as never,
      "preferences:write",
    );

    return {
      runtimeEvidence: [
        {
          surface: "backend-mcp-e2e",
          path: "apps/backend/test/e2e/mcp.e2e-spec.ts",
          cases: [
            "should exactly match full-scope runtime tool and resource descriptors to the fixture",
            "should allow SUGGEST_PREFERENCE for codex and preserve the text-only result envelope",
          ],
        },
        {
          surface: "backend-mcp-permission-grants-e2e",
          path: "apps/backend/test/e2e/permission-grants.e2e-spec.ts",
          cases: [
            "scopes listPermissionGrants to the calling client key and preserves matching structured/text envelopes",
          ],
        },
      ],
      server: {
        identity: server._serverInfo,
        instructions: server._instructions,
        capabilities: server._capabilities,
        transport: {
          path: "/mcp",
          post: { auth: "required", responseMode: "json", stateless: true },
          get: {
            status: 405,
            allow: "POST",
            body: { error: "Method Not Allowed" },
          },
          disabledPost: {
            status: 503,
            body: { error: "MCP HTTP transport is disabled" },
          },
        },
      },
      tools: tools.map((tool) => ({
        descriptor: tool.descriptor,
        requiredAccess: tool.requiredAccess,
        requiresAuth: tool.requiresAuth,
        accessLogPolicy: tool.accessLogPolicy ?? null,
        resultEnvelope:
          tool.descriptor.name === "mutatePreferences"
            ? "text-only"
            : "structuredContent-and-matching-json-text",
      })),
      resources: resources.map((resource) => ({
        descriptor: resource.descriptor,
        requiredAccess: resource.requiredAccess,
        readEnvelope: {
          contents: [
            {
              uri: resource.descriptor.uri,
              mimeType: resource.descriptor.mimeType,
              text: "<schema-sdl>",
            },
          ],
        },
      })),
      visibility,
      oauth: {
        protectedResourcePaths: [
          "/.well-known/oauth-protected-resource",
          "/.well-known/oauth-protected-resource/mcp",
        ],
        authorizationServerPaths: [
          "/.well-known/oauth-authorization-server",
          "/.well-known/oauth-authorization-server/mcp",
        ],
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
        protectedResource: oauth.getProtectedResourceMetadata(),
        authorizationServer: oauth.getAuthorizationServerMetadata(),
      },
      dcr: {
        path: "/oauth/register",
        rateLimit: config.oauth.rateLimit,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-store",
        },
        cases: dcrCases,
      },
      challenges: {
        missingToken: missing.output,
        invalidToken: invalid.output,
        insufficientWriteScope: insufficient.output,
      },
      clients: config.clients.map((client) => ({
        ...client,
        oauth: client.oauth
          ? {
              clientId: client.oauth.clientId,
              redirectUris: client.oauth.redirectUris,
            }
          : undefined,
      })),
      configurationShapedNonCapabilities: [
        "MCP_HTTP_PATH",
        "MCP_HTTP_REQUIRE_AUTH=false",
        "MCP_STDIO_ENABLED=true",
      ],
    };
  } finally {
    process.env = originalEnv;
  }
}
