import { INestApplication } from "@nestjs/common";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import request from "supertest";
import { createTestApp, createTestUser, TestUser } from "../setup/test-app";
import { getPrismaClient } from "../setup/test-db";
import { McpService } from "../../src/mcp/mcp.service";

function parseSsePayload(responseText: string) {
  const match = responseText.match(/^data:\s(.+)$/m);
  if (!match) {
    throw new Error(`Expected SSE data payload, got: ${responseText}`);
  }

  return JSON.parse(match[1]);
}

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
  let mcpService: McpService;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
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

  const mcpPost = (payload: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send(payload);

  const callTool = async (
    name: string,
    args?: Record<string, unknown>,
  ): Promise<unknown> => {
    const response = await mcpPost({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
      id: 1,
    }).expect(200);

    const rpc = parseSsePayload(response.text);
    expect(rpc.error).toBeUndefined();
    return parseToolContent(rpc.result);
  };

  describe("HTTP endpoint", () => {
    it("lists the supported MCP tools", async () => {
      const response = await mcpPost({
        jsonrpc: "2.0",
        method: "tools/list",
        id: 1,
      }).expect(200);

      const rpc = parseSsePayload(response.text);
      expect(rpc.error).toBeUndefined();

      const toolNames = rpc.result.tools.map(
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

      const result = await callTool("listPreferenceSlugs", {
        category: "test",
      });
      const parsed = result as {
        success: boolean;
        preferences: Array<{ slug: string }>;
      };

      expect(parsed.success).toBe(true);
      expect(
        parsed.preferences.some((pref) => pref.slug === "test.favorite_editor"),
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
        input: {
          slug: "travel.seat_preference",
          value: "aisle",
        },
      }).expect(200);

      await graphqlRequest(mutation, {
        input: {
          slug: "system.response_tone",
          value: "casual",
        },
      }).expect(200);

      const result = await callTool("searchPreferences", {
        category: "travel",
      });
      const parsed = result as {
        success: boolean;
        active: { count: number; preferences: Array<{ slug: string }> };
      };

      expect(parsed.success).toBe(true);
      expect(parsed.active.count).toBe(1);
      expect(parsed.active.preferences[0].slug).toBe("travel.seat_preference");
    });

    it("can suggest and then delete a preference", async () => {
      const suggestResult = (await callTool("suggestPreference", {
        slug: "system.response_tone",
        value: '"professional"',
        confidence: 0.9,
      })) as {
        success: boolean;
        preference: { id: string; slug: string; status: string };
      };

      expect(suggestResult.success).toBe(true);
      expect(suggestResult.preference.slug).toBe("system.response_tone");
      expect(suggestResult.preference.status).toBe("SUGGESTED");

      const searchResult = (await callTool("searchPreferences", {
        query: "system",
        includeSuggestions: true,
      })) as {
        success: boolean;
        suggested: { count: number; preferences: Array<{ id: string }> };
      };

      expect(searchResult.success).toBe(true);
      expect(searchResult.suggested.count).toBe(1);
      expect(searchResult.suggested.preferences[0].id).toBe(
        suggestResult.preference.id,
      );

      const deleteResult = (await callTool("deletePreference", {
        id: suggestResult.preference.id,
      })) as { success: boolean; deletedId: string };

      expect(deleteResult).toEqual({
        success: true,
        deletedId: suggestResult.preference.id,
      });

      const afterDelete = (await callTool("searchPreferences", {
        query: "system",
        includeSuggestions: true,
      })) as {
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
        params: {
          uri: "schema://graphql",
        },
        id: 1,
      }).expect(200);

      const rpc = parseSsePayload(response.text);
      expect(rpc.error).toBeUndefined();
      expect(rpc.result.contents[0].uri).toBe("schema://graphql");
      expect(rpc.result.contents[0].text).toContain("type Query");
      expect(rpc.result.contents[0].text).toContain("type Mutation");
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
});
