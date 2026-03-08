import { INestApplication } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import request from "supertest";
import { createTestApp, createTestUser, TestUser } from "../setup/test-app";
import { getPrismaClient, seedPreferenceDefinitions } from "../setup/test-db";
import { McpService } from "../../src/mcp/mcp.service";

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
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post("/graphql").send({ query, variables });

  const mcpPost = (body: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())
      .post("/mcp")
      .set("Content-Type", "application/json")
      .set("Accept", "application/json")
      .set(headers)
      .send(body);

  describe("MCP Service", () => {
    it("should be defined", () => {
      expect(mcpService).toBeDefined();
    });

    it("should create a distinct server per call", () => {
      const context = { user: testUser };
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
        "suggestPreference",
        "deletePreference",
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
          },
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
