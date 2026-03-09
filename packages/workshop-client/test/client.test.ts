import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  WorkshopClientError,
  createWorkshopClient,
  type WorkshopCatalogEntry,
} from "../src";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(body: string, status = 500): Response {
  return new Response(body, { status });
}

describe("workshop client", () => {
  it("normalizes GraphQL and upload URLs from an origin baseUrl", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { groupUsers: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          analysisId: "analysis-1",
          suggestions: [],
          filteredSuggestions: [],
          status: "no_matches",
          filteredCount: 0,
        }),
      );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    });

    await client.users();
    await client
      .withUser("user-1")
      .analyzeDocument({ file: new File(["test"], "notes.txt") });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/graphql");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.example.com/api/preferences/analysis",
    );
  });

  it("preserves /graphql and path-prefixed base URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => jsonResponse({ data: { me: { userId: "u" } } }));

    const directGraphqlClient = createWorkshopClient({
      baseUrl: "https://api.example.com/graphql",
      apiKey: "group-key",
      fetch: fetchMock,
    });
    await directGraphqlClient.withUser("user-1").me();

    const prefixedClient = createWorkshopClient({
      baseUrl: "https://api.example.com/prefix",
      apiKey: "group-key",
      fetch: fetchMock,
    });
    await prefixedClient.withUser("user-1").me();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.example.com/graphql");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.example.com/prefix/graphql",
    );
  });

  it("lets graphqlUrl and uploadUrl override derived URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { me: { userId: "u" } } }))
      .mockResolvedValueOnce(
        jsonResponse({
          analysisId: "analysis-1",
          suggestions: [],
          filteredSuggestions: [],
          status: "no_matches",
          filteredCount: 0,
        }),
      );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com/prefix",
      apiKey: "group-key",
      graphqlUrl: "https://graphql.example.com/custom",
      uploadUrl: "https://upload.example.com/custom",
      fetch: fetchMock,
    });

    const userClient = client.withUser("user-1");
    await userClient.me();
    await userClient.analyzeDocument({
      file: new File(["test"], "notes.txt"),
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://graphql.example.com/custom");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://upload.example.com/custom");
  });

  it("sends users() through groupUsers without auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          groupUsers: [
            {
              userId: "user-1",
              email: "user@example.com",
              firstName: "User",
              lastName: "One",
              createdAt: "2026-03-08T00:00:00.000Z",
              updatedAt: "2026-03-08T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    });

    await expect(client.users()).resolves.toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(String(init.body))).toMatchObject({
      variables: { apiKey: "group-key" },
    });
  });

  it("sends me() with Bearer auth and X-User-Id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          me: {
            userId: "user-1",
            email: "user@example.com",
            firstName: "User",
            lastName: "One",
            createdAt: "2026-03-08T00:00:00.000Z",
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
        },
      }),
    );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    });

    await client.withUser("user-1").me();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(headers.get("authorization")).toBe("Bearer group-key");
    expect(headers.get("x-user-id")).toBe("user-1");
  });

  it("fetches catalog fresh on every call and filters to global workshop-visible defs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            exportPreferenceSchema: [
              {
                slug: "system.response_tone",
                displayName: "Response Tone",
                ownerUserId: null,
                description: "The AI tone",
                valueType: "ENUM",
                scope: "GLOBAL",
                options: ["casual", "professional"],
              },
              {
                slug: "workshop.team_name",
                displayName: "Team Name",
                ownerUserId: "user-1",
                description: "Personal team name",
                valueType: "STRING",
                scope: "GLOBAL",
                options: null,
              },
              {
                slug: "location.default_temperature",
                ownerUserId: null,
                description: "Location only",
                valueType: "STRING",
                scope: "LOCATION",
                options: null,
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            exportPreferenceSchema: [],
          },
        }),
      );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    }).withUser("user-1");

    const firstCatalog = await client.catalog();
    const secondCatalog = await client.catalog();

    expect(firstCatalog).toEqual<WorkshopCatalogEntry[]>([
      {
        slug: "system.response_tone",
        displayName: "Response Tone",
        description: "The AI tone",
        valueType: "ENUM",
        options: ["casual", "professional"],
        origin: "system",
      },
      {
        slug: "workshop.team_name",
        displayName: "Team Name",
        description: "Personal team name",
        valueType: "STRING",
        origin: "personal",
      },
    ]);
    expect(secondCatalog).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches active preferences and maps the GraphQL response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          activePreferences: [
            {
              id: "pref-1",
              userId: "user-1",
              locationId: null,
              slug: "system.response_tone",
              definitionId: "def-1",
              value: "casual",
              status: "ACTIVE",
              sourceType: "USER",
              confidence: null,
              evidence: null,
              createdAt: "2026-03-08T00:00:00.000Z",
              updatedAt: "2026-03-08T00:00:00.000Z",
              category: "system",
              description: "The AI tone",
            },
          ],
        },
      }),
    );

    const preferences = await createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    })
      .withUser("user-1")
      .activePreferences();

    expect(preferences[0]).toMatchObject({
      slug: "system.response_tone",
      value: "casual",
      definitionId: "def-1",
    });
  });

  it("validates setPreference() against a fresh live catalog before mutation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            exportPreferenceSchema: [
              {
                slug: "system.response_tone",
                ownerUserId: null,
                description: "The AI tone",
                valueType: "ENUM",
                scope: "GLOBAL",
                options: ["casual", "professional"],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setPreference: {
              id: "pref-1",
              userId: "user-1",
              locationId: null,
              slug: "system.response_tone",
              definitionId: "def-1",
              value: "professional",
              status: "ACTIVE",
              sourceType: "USER",
              confidence: null,
              evidence: null,
              createdAt: "2026-03-08T00:00:00.000Z",
              updatedAt: "2026-03-08T00:00:00.000Z",
              category: "system",
              description: "The AI tone",
            },
          },
        }),
      );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    }).withUser("user-1");

    await expect(
      client.setPreference({
        slug: "system.response_tone",
        value: "professional",
      }),
    ).resolves.toMatchObject({ value: "professional" });

    const [, mutationInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(mutationInit.body))).toMatchObject({
      variables: {
        input: {
          slug: "system.response_tone",
          value: "professional",
        },
      },
    });
  });

  it("rejects unknown and invalid preference values before sending a mutation", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      jsonResponse({
        data: {
          exportPreferenceSchema: [
            {
              slug: "system.response_tone",
              ownerUserId: null,
              description: "The AI tone",
              valueType: "ENUM",
              scope: "GLOBAL",
              options: ["casual", "professional"],
            },
          ],
        },
      }),
    );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    }).withUser("user-1");

    await expect(
      client.setPreference({ slug: "missing.slug", value: "anything" }),
    ).rejects.toMatchObject({
      kind: "config",
      operation: "setPreference",
    });

    await expect(
      client.setPreference({ slug: "system.response_tone", value: "loud" }),
    ).rejects.toMatchObject({
      kind: "config",
      operation: "setPreference",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("builds multipart upload requests and infers filename from File", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        analysisId: "analysis-1",
        suggestions: [],
        filteredSuggestions: [],
        status: "no_matches",
        filteredCount: 0,
      }),
    );

    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: fetchMock,
    }).withUser("user-1");

    await client.analyzeDocument({
      file: new File(["document"], "profile.txt", { type: "text/plain" }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    const formData = init.body as FormData;
    const entry = formData.get("file");

    expect(headers.get("authorization")).toBe("Bearer group-key");
    expect(headers.get("content-type")).toBeNull();
    expect(entry).toBeInstanceOf(File);
    expect((entry as File).name).toBe("profile.txt");
  });

  it("requires filename for generic blobs passed to analyzeDocument()", async () => {
    const client = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: vi.fn(),
    }).withUser("user-1");

    await expect(
      client.analyzeDocument({ file: new Blob(["document"]) }),
    ).rejects.toMatchObject({
      kind: "config",
      operation: "analyzeDocument",
    });
  });

  it("wraps config, network, http, and graphql failures", async () => {
    expect(() =>
      createWorkshopClient({
        baseUrl: "",
        apiKey: "group-key",
        fetch: vi.fn(),
      }),
    ).toThrowError(WorkshopClientError);

    const networkClient = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: vi.fn().mockRejectedValue(new Error("socket closed")),
    });
    await expect(networkClient.users()).rejects.toMatchObject({
      kind: "network",
      operation: "users",
    });

    const httpClient = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: vi.fn().mockResolvedValue(textResponse("boom", 500)),
    });
    await expect(httpClient.withUser("user-1").me()).rejects.toMatchObject({
      kind: "http",
      operation: "me",
      statusCode: 500,
    });

    const graphqlClient = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          errors: [{ message: "No userId provided" }],
        }),
      ),
    });
    await expect(graphqlClient.withUser("user-1").me()).rejects.toMatchObject({
      kind: "graphql",
      operation: "me",
    });
  });

  it("keeps catalog() off the base client surface and exposes the user client methods", () => {
    const base = createWorkshopClient({
      baseUrl: "https://api.example.com",
      apiKey: "group-key",
      fetch: vi.fn(),
    });
    const userClient = base.withUser("user-1");

    expectTypeOf(base.users).toBeFunction();
    expectTypeOf(userClient.catalog).toBeFunction();
    expectTypeOf(userClient.me).toBeFunction();
    expectTypeOf(userClient.activePreferences).toBeFunction();
    expectTypeOf(userClient.setPreference).toBeFunction();
    expectTypeOf(userClient.analyzeDocument).toBeFunction();
  });
});
