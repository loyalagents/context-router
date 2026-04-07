import { INestApplication } from "@nestjs/common";
import { createHash } from "crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import request from "supertest";
import { createTestApp, createTestUser, TestUser } from "../setup/test-app";
import { getPrismaClient, seedPreferenceDefinitions } from "../setup/test-db";
import { ApiKeyMcpClientKey } from "../../src/infrastructure/prisma/generated-client";
import { McpService } from "../../src/mcp/mcp.service";
import { ResolvedMcpClient } from "../../src/mcp/types/mcp-authorization.types";

const TEST_CLAUDE_CLIENT: ResolvedMcpClient = {
  key: "claude",
  externalId: "test-claude-client",
  policy: {
    key: "claude",
    label: "Claude",
    capabilities: ["preferences:read", "preferences:write"],
    targetRules: [],
  },
};

function parseToolContent(result: {
  content: Array<{ type: string; text: string }>;
}) {
  const textContent = result.content.find((entry) => entry.type === "text");
  if (!textContent) {
    throw new Error("Expected text content in MCP tool response");
  }

  return JSON.parse(textContent.text);
}

describe("MCP Integration (e2e)", () => {
  let app: INestApplication;
  let realAuthApp: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  let registerMcpUser: (user: TestUser) => void;
  let mcpService: McpService;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
    registerMcpUser = testApp.registerMcpUser;
    mcpService = testApp.module.get<McpService>(McpService);

    const realAuthTestApp = await createTestApp({ mockAuthGuards: false });
    realAuthApp = realAuthTestApp.app;
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
    await realAuthApp.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/graphql").send({ query, variables });

  const mcpPost = (body: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set(headers)
      .send(body);

  const realMcpPost = (body: object, headers: Record<string, string> = {}) =>
    request(realAuthApp.getHttpServer())
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json, text/event-stream")
      .set(headers)
      .send(body);

  const realMcpHeaders = (apiKey: string, userId = testUser.userId) => ({
    Authorization: `Bearer ${apiKey}`,
    "x-user-id": userId,
  });

  const createApiKeyForUser = async (
    mcpClientKey: ApiKeyMcpClientKey,
    userId: string,
    plaintextKey: string,
  ) => {
    const prisma = getPrismaClient();
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        keyHash: createHash("sha256").update(plaintextKey).digest("hex"),
        groupName: `Test ${mcpClientKey} Group`,
        mcpClientKey,
      },
    });

    await prisma.apiKeyUser.create({
      data: {
        apiKeyId: apiKeyRecord.id,
        userId,
      },
    });

    return plaintextKey;
  };

  describe("MCP Service", () => {
    it("should be defined", () => {
      expect(mcpService).toBeDefined();
    });

    it("should create a distinct server per call", () => {
      const context = { user: testUser, client: TEST_CLAUDE_CLIENT };
      const serverA = mcpService.createServer(context);
      const serverB = mcpService.createServer(context);
      expect(serverA).not.toBe(serverB);
    });
  });

  describe("POST /mcp", () => {
    it("lists the supported MCP tools", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }).expect(200);

      const toolNames = response.body.result.tools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(toolNames).toEqual([
        "listPreferenceSlugs",
        "searchPreferences",
        "createPreferenceDefinition",
        "suggestPreference",
        "applyPreference",
        "deletePreference",
        "smartSearchPreferences",
        "consolidateSchema",
      ]);
    });

    it("lists user-owned slugs through listPreferenceSlugs", async () => {
      await getPrismaClient().preferenceDefinition.create({
        data: {
          namespace: `USER:${testUser.userId}`,
          ownerUserId: testUser.userId,
          slug: "test.favorite_editor",
          description: "Preferred code editor",
          valueType: "STRING",
          scope: "GLOBAL",
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "listPreferenceSlugs", arguments: { category: "test" } },
        id: 1,
      }).expect(200);

      const result = parseToolContent(response.body.result) as {
        success: boolean;
        preferences: Array<{ slug: string }>;
      };

      expect(result.success).toBe(true);
      expect(
        result.preferences.some((pref) => pref.slug === "test.favorite_editor"),
      ).toBe(true);
    });

    it("supports category as a deprecated alias on searchPreferences", async () => {
      const mutation = `
        mutation SetPreference($input: SetPreferenceInput!) {
          setPreference(input: $input) {
            id
          }
        }
      `;

      await graphqlRequest(mutation, {
        input: { slug: "travel.seat_preference", value: "aisle" },
      }).expect(200);

      await graphqlRequest(mutation, {
        input: { slug: "system.response_tone", value: "casual" },
      }).expect(200);

      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "searchPreferences", arguments: { category: "travel" } },
        id: 1,
      }).expect(200);

      const result = parseToolContent(response.body.result) as {
        success: boolean;
        active: { count: number; preferences: Array<{ slug: string }> };
      };

      expect(result.success).toBe(true);
      expect(result.active.count).toBe(1);
      expect(result.active.preferences[0].slug).toBe("travel.seat_preference");
    });

    it("can suggest and then delete a preference", async () => {
      const suggestResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "suggestPreference",
          arguments: { slug: "system.response_tone", value: '"professional"', confidence: 0.9 },
        },
        id: 1,
      }).expect(200);

      const suggestResult = parseToolContent(suggestResponse.body.result) as {
        success: boolean;
        preference: { id: string; slug: string; status: string };
      };

      expect(suggestResult.success).toBe(true);
      expect(suggestResult.preference.slug).toBe("system.response_tone");
      expect(suggestResult.preference.status).toBe("SUGGESTED");

      const searchResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "searchPreferences",
          arguments: { query: "system", includeSuggestions: true },
        },
        id: 2,
      }).expect(200);

      const searchResult = parseToolContent(searchResponse.body.result) as {
        success: boolean;
        suggested: { count: number; preferences: Array<{ id: string }> };
      };

      expect(searchResult.success).toBe(true);
      expect(searchResult.suggested.count).toBe(1);
      expect(searchResult.suggested.preferences[0].id).toBe(
        suggestResult.preference.id,
      );

      const deleteResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "deletePreference",
          arguments: { id: suggestResult.preference.id },
        },
        id: 3,
      }).expect(200);

      const deleteResult = parseToolContent(deleteResponse.body.result) as {
        success: boolean;
        deletedId: string;
      };

      expect(deleteResult).toEqual({
        success: true,
        deletedId: suggestResult.preference.id,
      });

      const afterDeleteResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "searchPreferences",
          arguments: { query: "system", includeSuggestions: true },
        },
        id: 4,
      }).expect(200);

      const afterDelete = parseToolContent(afterDeleteResponse.body.result) as {
        success: boolean;
        suggested: { count: number };
      };

      expect(afterDelete.success).toBe(true);
      expect(afterDelete.suggested.count).toBe(0);
    });

    it("can apply a preference directly as ACTIVE with AGENT provenance", async () => {
      const applyResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "applyPreference",
          arguments: {
            slug: "system.response_tone",
            value: '"professional"',
            confidence: 0.92,
            evidence:
              '{"reason":"Agent applied directly","snippets":["User prefers formal tone"]}',
          },
        },
        id: 1,
      }).expect(200);

      const applyResult = parseToolContent(applyResponse.body.result) as {
        success: boolean;
        preference: {
          id: string;
          slug: string;
          status: string;
          sourceType: string;
          confidence: number;
        };
      };

      expect(applyResult.success).toBe(true);
      expect(applyResult.preference.slug).toBe("system.response_tone");
      expect(applyResult.preference.status).toBe("ACTIVE");
      expect(applyResult.preference.sourceType).toBe("AGENT");
      expect(applyResult.preference.confidence).toBe(0.92);

      const searchResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "searchPreferences",
          arguments: { query: "system" },
        },
        id: 2,
      }).expect(200);

      const searchResult = parseToolContent(searchResponse.body.result) as {
        success: boolean;
        active: {
          count: number;
          preferences: Array<{ slug: string; sourceType: string }>;
        };
      };

      expect(searchResult.success).toBe(true);
      expect(searchResult.active.count).toBe(1);
      expect(searchResult.active.preferences[0]).toMatchObject({
        slug: "system.response_tone",
        sourceType: "AGENT",
      });
    });

    it("can apply a location-scoped preference directly", async () => {
      const location = await getPrismaClient().location.create({
        data: {
          userId: testUser.userId,
          type: "HOME",
          label: "Workshop Home",
          address: "123 Demo St",
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "applyPreference",
          arguments: {
            slug: "location.default_temperature",
            value: '"68"',
            locationId: location.locationId,
            confidence: 0.87,
          },
        },
        id: 1,
      }).expect(200);

      const result = parseToolContent(response.body.result) as {
        success: boolean;
        preference: { status: string; sourceType: string; locationId: string };
      };

      expect(result.success).toBe(true);
      expect(result.preference.status).toBe("ACTIVE");
      expect(result.preference.sourceType).toBe("AGENT");
      expect(result.preference.locationId).toBe(location.locationId);
    });

    it("blocks applyPreference when the user previously rejected the same preference for this scope", async () => {
      const definition = await getPrismaClient().preferenceDefinition.findFirst({
        where: { slug: "system.response_tone" },
      });

      expect(definition).toBeDefined();

      await getPrismaClient().preference.create({
        data: {
          userId: testUser.userId,
          definitionId: definition!.id,
          contextKey: "GLOBAL",
          value: "casual",
          status: "REJECTED",
          sourceType: "INFERRED",
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "applyPreference",
          arguments: {
            slug: "system.response_tone",
            value: '"professional"',
            confidence: 0.95,
          },
        },
        id: 1,
      }).expect(200);

      const result = parseToolContent(response.body.result) as {
        success: boolean;
        code: string;
        message: string;
      };

      expect(result.success).toBe(false);
      expect(result.code).toBe("PREFERENCE_REJECTED");
      expect(result.message).toContain("previously rejected preference");
    });

    it("clears a matching pending suggestion after direct apply", async () => {
      await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "suggestPreference",
          arguments: {
            slug: "system.response_length",
            value: '"brief"',
            confidence: 0.74,
          },
        },
        id: 1,
      }).expect(200);

      const applyResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "applyPreference",
          arguments: {
            slug: "system.response_length",
            value: '"detailed"',
            confidence: 0.89,
          },
        },
        id: 2,
      }).expect(200);

      const applyResult = parseToolContent(applyResponse.body.result) as {
        success: boolean;
        clearedSuggestion: boolean;
        preference: { status: string; sourceType: string; value: string };
      };

      expect(applyResult.success).toBe(true);
      expect(applyResult.clearedSuggestion).toBe(true);
      expect(applyResult.preference).toMatchObject({
        status: "ACTIVE",
        sourceType: "AGENT",
        value: "detailed",
      });

      const searchResponse = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "searchPreferences",
          arguments: { query: "system.response_length", includeSuggestions: true },
        },
        id: 3,
      }).expect(200);

      const searchResult = parseToolContent(searchResponse.body.result) as {
        success: boolean;
        active: { count: number; preferences: Array<{ sourceType: string }> };
        suggested: { count: number };
      };

      expect(searchResult.success).toBe(true);
      expect(searchResult.active.count).toBe(1);
      expect(searchResult.active.preferences[0].sourceType).toBe("AGENT");
      expect(searchResult.suggested.count).toBe(0);
    });

    it("can suggest a preference in a non-GLOBAL schemaNamespace", async () => {
      // Create a user with a custom schemaNamespace (simulating an education user)
      const nsUser = await getPrismaClient().user.create({
        data: {
          email: "ns-test@education.workshop.dev",
          firstName: "NS",
          lastName: "Test",
          schemaNamespace: "education_k16",
        },
      });
      setTestUser(nsUser);

      // Create a preference definition in that namespace
      await getPrismaClient().preferenceDefinition.create({
        data: {
          namespace: "education_k16",
          slug: "learning_preferences.group_vs_solo",
          description: "Group vs solo learning preference",
          valueType: "STRING",
          scope: "GLOBAL",
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "suggestPreference",
          arguments: {
            slug: "learning_preferences.group_vs_solo",
            value: '"paired"',
            confidence: 0.9,
          },
        },
        id: 1,
      }).expect(200);

      const result = parseToolContent(response.body.result) as {
        success: boolean;
        preference: { slug: string; status: string };
      };

      expect(result.success).toBe(true);
      expect(result.preference.slug).toBe("learning_preferences.group_vs_solo");
      expect(result.preference.status).toBe("SUGGESTED");
    });

    it("reads the schema resource", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "resources/read",
        params: { uri: "schema://graphql" },
        id: 1,
      }).expect(200);

      expect(response.body.result.contents[0].uri).toBe("schema://graphql");
      expect(response.body.result.contents[0].text).toContain("type Query");
      expect(response.body.result.contents[0].text).toContain("type Mutation");
    });
  });

  describe("Real API-key client policy enforcement", () => {
    beforeEach(async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);
    });

    it("allows CLAUDE keys to list and call write tools", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.CLAUDE,
        testUser.userId,
        "mcp-real-claude",
      );

      const listResponse = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 30,
          method: "tools/list",
          params: {},
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      const toolNames = listResponse.body.result.tools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(toolNames).toContain("suggestPreference");
      expect(toolNames).toContain("createPreferenceDefinition");
      expect(toolNames).toContain("applyPreference");

      const callResponse = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 31,
          method: "tools/call",
          params: {
            name: "suggestPreference",
            arguments: {
              slug: "food.dietary_restrictions",
              value: '["nuts"]',
              confidence: 0.9,
            },
          },
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(callResponse.body.result?.isError).not.toBe(true);
    });

    it("filters write tools out of tools/list for CODEX keys", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.CODEX,
        testUser.userId,
        "mcp-real-codex-list",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 32,
          method: "tools/list",
          params: {},
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      const toolNames = response.body.result.tools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(toolNames).toContain("searchPreferences");
      expect(toolNames).not.toContain("suggestPreference");
      expect(toolNames).not.toContain("createPreferenceDefinition");
      expect(toolNames).not.toContain("applyPreference");
    });

    it("denies write tool calls for CODEX keys", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.CODEX,
        testUser.userId,
        "mcp-real-codex-call",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 33,
          method: "tools/call",
          params: {
            name: "suggestPreference",
            arguments: {
              slug: "food.dietary_restrictions",
              value: '["shellfish"]',
              confidence: 0.8,
            },
          },
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.result?.isError).toBe(true);
    });

    it("allows CLAUDE to read schema://graphql", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.CLAUDE,
        testUser.userId,
        "mcp-real-claude-resource",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 34,
          method: "resources/read",
          params: { uri: "schema://graphql" },
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.result.contents[0].uri).toBe("schema://graphql");
      expect(response.body.result.contents[0].text).toContain("type Query");
    });

    it("allows CODEX to read schema://graphql", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.CODEX,
        testUser.userId,
        "mcp-real-codex-resource",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 35,
          method: "resources/read",
          params: { uri: "schema://graphql" },
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.result.contents[0].uri).toBe("schema://graphql");
      expect(response.body.result.contents[0].text).toContain("type Mutation");
    });

    it("returns an empty tools list for UNKNOWN keys", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.UNKNOWN,
        testUser.userId,
        "mcp-real-unknown-tools",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 36,
          method: "tools/list",
          params: {},
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.result.tools).toEqual([]);
    });

    it("returns an empty resources list for UNKNOWN keys", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.UNKNOWN,
        testUser.userId,
        "mcp-real-unknown-resources",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 37,
          method: "resources/list",
          params: {},
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.result.resources).toEqual([]);
    });

    it("denies resources/read for UNKNOWN keys", async () => {
      const apiKey = await createApiKeyForUser(
        ApiKeyMcpClientKey.UNKNOWN,
        testUser.userId,
        "mcp-real-unknown-read",
      );

      const response = await realMcpPost(
        {
          jsonrpc: "2.0",
          id: 38,
          method: "resources/read",
          params: { uri: "schema://graphql" },
        },
        realMcpHeaders(apiKey),
      ).expect(200);

      expect(response.body.error).toBeDefined();
    });
  });

  describe("GET /mcp", () => {
    it("should return 405 Method Not Allowed", async () => {
      const response = await request(app.getHttpServer()).get("/mcp");
      expect(response.status).toBe(405);
    });
  });

  describe("Origin validation", () => {
    it("should allow requests without an Origin header (non-browser clients)", async () => {
      const response = await request(app.getHttpServer())
        .post("/mcp")
        .set("Content-Type", "application/json")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });

      expect(response.status).not.toBe(403);
    });

    it("should allow requests from an allowed origin", async () => {
      // CORS_ORIGIN=http://localhost:3001 in .env.test, so allowedOrigins=['http://localhost:3001']
      const response = await mcpPost(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { origin: "http://localhost:3001" },
      );

      expect(response.status).not.toBe(403);
    });

    it("should reject requests from a disallowed origin", async () => {
      const response = await mcpPost(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
        { origin: "https://evil.example.com" },
      );

      expect(response.status).toBe(403);
    });
  });

  describe("request-scoped server isolation", () => {
    it("keeps per-user catalog visibility isolated across concurrent MCP servers", async () => {
      const prisma = getPrismaClient();
      const otherUser = await prisma.user.create({
        data: {
          email: "other@example.com",
          firstName: "Other",
          lastName: "User",
        },
      });

      await prisma.preferenceDefinition.createMany({
        data: [
          {
            namespace: `USER:${testUser.userId}`,
            ownerUserId: testUser.userId,
            slug: "test.user_a_only",
            description: "Only user A can see this",
            valueType: "STRING",
            scope: "GLOBAL",
          },
          {
            namespace: `USER:${otherUser.userId}`,
            ownerUserId: otherUser.userId,
            slug: "test.user_b_only",
            description: "Only user B can see this",
            valueType: "STRING",
            scope: "GLOBAL",
          },
        ],
      });

      const runListCall = async (user: TestUser) => {
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        const client = new Client({
          name: "mcp-test-client",
          version: "1.0.0",
        });
        const server = mcpService.createServer({
          user: {
            userId: user.userId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            schemaNamespace: user.schemaNamespace,
          },
          client: TEST_CLAUDE_CLIENT,
        });

        await Promise.all([
          server.connect(serverTransport),
          client.connect(clientTransport),
        ]);

        try {
          const response = await client.callTool({
            name: "listPreferenceSlugs",
            arguments: { category: "test" },
          });

          return parseToolContent(
            response as { content: Array<{ type: string; text: string }> },
          );
        } finally {
          await client.close();
        }
      };

      const [resultA, resultB] = await Promise.all([
        runListCall(testUser),
        runListCall(otherUser as TestUser),
      ]);

      const slugsA = resultA.preferences.map(
        (pref: { slug: string }) => pref.slug,
      );
      const slugsB = resultB.preferences.map(
        (pref: { slug: string }) => pref.slug,
      );

      expect(slugsA).toContain("test.user_a_only");
      expect(slugsA).not.toContain("test.user_b_only");
      expect(slugsB).toContain("test.user_b_only");
      expect(slugsB).not.toContain("test.user_a_only");
    });
  });

  describe("listPreferenceSlugs user-awareness", () => {
    it("should include user-owned definitions for authenticated callers", async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);

      await prisma.preferenceDefinition.create({
        data: {
          namespace: `USER:${testUser.userId}`,
          slug: "custom.test_pref",
          description: "A personal test preference",
          valueType: "STRING",
          scope: "GLOBAL",
          ownerUserId: testUser.userId,
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "listPreferenceSlugs", arguments: {} },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).toContain("custom.test_pref");
    });
  });

  describe("createPreferenceDefinition", () => {
    beforeEach(async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);
    });

    it("should be included in tools/list", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });
      const toolNames = response.body.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("createPreferenceDefinition");
    });

    it("should create a new user-owned definition and return normalized shape", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "cooking.preferred_oil",
            description: "Preferred cooking oil type",
            valueType: "ENUM",
            scope: "GLOBAL",
            displayName: "Cooking Oil",
            options: ["olive", "coconut", "avocado"],
            isSensitive: false,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.definition.slug).toBe("cooking.preferred_oil");
      expect(result.definition.category).toBe("cooking");
      expect(result.definition.valueType).toBe("ENUM");
      expect(result.definition.scope).toBe("GLOBAL");
      expect(result.definition.options).toEqual(["olive", "coconut", "avocado"]);
      expect(result.definition.visibility).toBe("USER");
      expect(result.definition.id).toBeDefined();
    });

    it("should reject a duplicate user slug", async () => {
      const args = {
        slug: "cooking.unique_slug",
        description: "First",
        valueType: "STRING",
        scope: "GLOBAL",
      };
      await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "createPreferenceDefinition", arguments: args },
      });

      const response = await mcpPost({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "createPreferenceDefinition", arguments: args },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("PREFERENCE_DEFINITION_CONFLICT");
    });

    it("should reject a collision with an active global slug", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "food.dietary_restrictions",
            description: "Duplicate global",
            valueType: "ARRAY",
            scope: "GLOBAL",
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("PREFERENCE_DEFINITION_CONFLICT");
    });

    it("should reject an invalid slug format", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "INVALID SLUG!",
            description: "Bad slug",
            valueType: "STRING",
            scope: "GLOBAL",
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_PREFERENCE_DEFINITION");
    });

    it("should reject ENUM type with missing options", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "test.enum_no_opts",
            description: "Enum without options",
            valueType: "ENUM",
            scope: "GLOBAL",
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_PREFERENCE_DEFINITION");
    });

    it("should reject options supplied for non-ENUM type", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "test.bool_with_opts",
            description: "Boolean with options",
            valueType: "BOOLEAN",
            scope: "GLOBAL",
            options: ["yes", "no"],
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("INVALID_PREFERENCE_DEFINITION");
    });

    it("should not expose definition to another user via listPreferenceSlugs", async () => {
      const prisma = getPrismaClient();

      const userB = await prisma.user.create({
        data: { email: "user-b-def@example.com", firstName: "User", lastName: "B" },
      });

      await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "private.user_a_only",
            description: "Only for user A",
            valueType: "STRING",
            scope: "GLOBAL",
          },
        },
      });

      registerMcpUser(userB as any);
      const response = await mcpPost(
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "listPreferenceSlugs", arguments: {} } },
        { "x-test-user-id": userB.userId },
      );

      const result = JSON.parse(response.body.result.content[0].text);
      const slugs = result.preferences.map((p: any) => p.slug);
      expect(slugs).not.toContain("private.user_a_only");
    });

    it("should reject a collision with a namespace-catalog slug for non-GLOBAL users", async () => {
      const prisma = getPrismaClient();

      // Create a user in a custom namespace (simulating a workshop group)
      const nsUser = await prisma.user.create({
        data: {
          email: "ns-collision@health.workshop.dev",
          firstName: "NS",
          lastName: "User",
          schemaNamespace: "health",
        },
      });
      setTestUser(nsUser);

      // Seed a system definition in the health namespace
      await prisma.preferenceDefinition.create({
        data: {
          namespace: "health",
          slug: "health.dietary_needs",
          description: "Dietary needs for health context",
          valueType: "ARRAY",
          scope: "GLOBAL",
        },
      });

      // Attempting to create a personal def with the same slug should conflict
      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "health.dietary_needs",
            description: "My personal dietary needs",
            valueType: "ARRAY",
            scope: "GLOBAL",
          },
        },
      });

      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.code).toBe("PREFERENCE_DEFINITION_CONFLICT");
    });

    it("should allow suggestPreference after createPreferenceDefinition", async () => {
      await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "createPreferenceDefinition",
          arguments: {
            slug: "cooking.spice_level",
            description: "Preferred spice level",
            valueType: "ENUM",
            scope: "GLOBAL",
            options: ["mild", "medium", "hot"],
          },
        },
      });

      const response = await mcpPost({
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: {
          name: "suggestPreference",
          arguments: {
            slug: "cooking.spice_level",
            value: '"hot"',
            confidence: 0.8,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(true);
      expect(result.preference.slug).toBe("cooking.spice_level");
    });
  });

  describe("suggestPreference unknown-slug structured error", () => {
    it("should return structured guidance when slug is unknown", async () => {
      const prisma = getPrismaClient();
      await seedPreferenceDefinitions(prisma);

      const response = await mcpPost({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: {
          name: "suggestPreference",
          arguments: {
            slug: "nonexistent.slug_that_does_not_exist",
            value: '"some value"',
            confidence: 0.9,
          },
        },
      });

      expect(response.status).toBe(200);
      const result = JSON.parse(response.body.result.content[0].text);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.code).toBe("UNKNOWN_PREFERENCE_SLUG");
      expect(result.suggestedTool).toBe("createPreferenceDefinition");
    });
  });

  describe("Concurrent request isolation", () => {
    it("should scope searchPreferences results to the authenticated user", async () => {
      const prisma = getPrismaClient();

      // Seed preference definitions (required FK)
      await seedPreferenceDefinitions(prisma);

      // userA is the test user already created in beforeEach
      const userA = testUser;
      const userB = await prisma.user.create({
        data: {
          email: "user-b@example.com",
          firstName: "User",
          lastName: "B",
        },
      });

      registerMcpUser(userA);
      registerMcpUser(userB);

      // Find two preference definitions to use as unique slugs
      const defA = await prisma.preferenceDefinition.findFirst({
        where: { slug: "food.dietary_restrictions" },
      });
      const defB = await prisma.preferenceDefinition.findFirst({
        where: { slug: "food.cuisine_preferences" },
      });

      expect(defA).toBeDefined();
      expect(defB).toBeDefined();

      // Seed one preference per user with a distinct value
      const uniqueValueA = "unique-value-for-user-a";
      const uniqueValueB = "unique-value-for-user-b";

      await prisma.preference.create({
        data: {
          userId: userA.userId,
          definitionId: defA!.id,
          contextKey: "GLOBAL",
          value: JSON.stringify(uniqueValueA),
          status: "ACTIVE",
          sourceType: "USER",
        },
      });

      await prisma.preference.create({
        data: {
          userId: userB.userId,
          definitionId: defB!.id,
          contextKey: "GLOBAL",
          value: JSON.stringify(uniqueValueB),
          status: "ACTIVE",
          sourceType: "USER",
        },
      });

      // Spy on Server.prototype.setRequestHandler to wrap the CallToolRequestSchema
      // handler. The barrier fires at the START of the handler — before any context
      // is read — ensuring both requests are simultaneously in-flight before either
      // resolves. This test would fail against the old singleton-context implementation
      // because both paused handlers would race on getContext() after the barrier lifts.
      const originalSetRequestHandler = Server.prototype.setRequestHandler;
      let resolveBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });
      let inflightCount = 0;

      const setRequestHandlerSpy = jest
        .spyOn(Server.prototype, "setRequestHandler")
        .mockImplementation(function (this: Server, schema: any, handler: any) {
          if (schema === CallToolRequestSchema) {
            const wrappedHandler = async (...args: any[]) => {
              inflightCount++;
              if (inflightCount === 2) {
                // Both handlers are now in-flight — release the barrier
                resolveBarrier();
              }
              await barrier;
              return handler.apply(this, args);
            };
            return originalSetRequestHandler.call(this, schema, wrappedHandler);
          }
          return originalSetRequestHandler.call(this, schema, handler);
        });

      const mcpRequest = (userId: string) =>
        mcpPost(
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "searchPreferences", arguments: {} },
          },
          { "x-test-user-id": userId },
        );

      const [responseA, responseB] = await Promise.all([
        mcpRequest(userA.userId),
        mcpRequest(userB.userId),
      ]);

      setRequestHandlerSpy.mockRestore();

      expect(responseA.status).toBe(200);
      expect(responseB.status).toBe(200);

      const textA = responseA.body.result?.content?.[0]?.text ?? "";
      const textB = responseB.body.result?.content?.[0]?.text ?? "";

      // User A's response contains A's value and not B's
      expect(textA).toContain(uniqueValueA);
      expect(textA).not.toContain(uniqueValueB);

      // User B's response contains B's value and not A's
      expect(textB).toContain(uniqueValueB);
      expect(textB).not.toContain(uniqueValueA);
    });
  });
});
