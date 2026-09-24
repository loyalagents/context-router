import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import passport from "passport";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import { ModulesContainer } from "@nestjs/core";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import type { INestApplication } from "@nestjs/common";
import { graphql, type GraphQLSchema } from "graphql";
import { LocalApplicationModule } from "@/composition/local-application.module";
import { configureLocalIdentityPreview } from "@/bootstrap/local-identity-preview";
import { SqliteDatabase } from "@/infrastructure/storage/sqlite/sqlite-database";
import { SQLITE_TABLES } from "@/infrastructure/storage/sqlite/sqlite-schema";
import { SqliteStorageUnitOfWork } from "@/infrastructure/storage/sqlite/sqlite-unit-of-work";
import { StorageUnitOfWork } from "@/domains/shared/storage/storage-unit-of-work";
import { HUMAN_AUTH_STRATEGY } from "@/domains/shared/ports/human-auth.constants";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import {
  decodeLocalIdentityState,
  type LocalIdentityState,
} from "@/modules/auth/local-identity-state.codec";
import { PreferenceAuditService } from "@/modules/preferences/audit/preference-audit.service";
import { fixtureRows } from "./fixture-rows";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpService } from "@/mcp/mcp.service";
import { McpAuthorizationService } from "@/mcp/auth/mcp-authorization.service";
import { McpAccessLogService } from "@/mcp/access-log/mcp-access-log.service";
import { PreferenceMutateTool } from "@/mcp/tools/preference-mutate.tool";
import { PermissionGrantService } from "@/modules/permission-grant/permission-grant.service";
import { PreferenceService } from "@/modules/preferences/preference/preference.service";
import { PreferenceDefinitionService } from "@/modules/preferences/preference-definition/preference-definition.service";
import { PreferenceDefinitionRepository } from "@/modules/preferences/preference-definition/preference-definition.repository";
import { AccessHistoryStorage } from "@/domains/shared/storage/history-storage";

describe("real SQLite local application", () => {
  let root: string,
    databaseRoot: string,
    stateRoot: string,
    state: LocalIdentityState;
  let app: INestApplication,
    schema: GraphQLSchema,
    db: SqliteDatabase,
    rows: ReturnType<typeof fixtureRows>;
  const stateBytes = () =>
    fs.readFileSync(path.join(stateRoot, "identity.json"));
  function admin(command: string) {
    const result = spawnSync(
      process.execPath,
      [
        "--no-global-search-paths",
        path.resolve(__dirname, "../../dist/local-identity.js"),
        command,
      ],
      {
        cwd: root,
        env: {
          LOCAL_DATABASE_ROOT: databaseRoot,
          LOCAL_IDENTITY_STATE_ROOT: stateRoot,
        },
        encoding: "utf8",
        timeout: 8000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    return result.stdout;
  }
  async function open() {
    const module = await Test.createTestingModule({
      imports: [
        LocalApplicationModule.register({
          kind: "sqlite",
          databaseRoot,
          stateRoot,
        }),
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    const listen = jest.spyOn(app, "listen").mockImplementation(() => {
      throw new Error("Local application must not listen");
    });
    configureLocalIdentityPreview(app);
    await app.init();
    expect(listen).not.toHaveBeenCalled();
    schema = app.get(GraphQLSchemaHost).schema;
    db = app.get(SqliteDatabase);
    rows = fixtureRows(db);
  }
  beforeEach(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-application-")),
    );
    databaseRoot = path.join(root, "data");
    stateRoot = path.join(root, "identity");
    admin("initialize");
    state = decodeLocalIdentityState(stateBytes());
    await open();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    if (app) await app.close();
    passport.unuse(HUMAN_AUTH_STRATEGY);
    fs.rmSync(root, { recursive: true, force: true });
  });
  function request(credential?: string): any {
    return credential
      ? {
          headers: { authorization: `Bearer ${credential}` },
          rawHeaders: ["Authorization", `Bearer ${credential}`],
        }
      : { headers: {}, rawHeaders: [] };
  }
  const query = (
    source: string,
    variables?: Record<string, unknown>,
    credential: string | undefined = state.credential,
  ) =>
    graphql({
      schema,
      source,
      variableValues: variables,
      contextValue: { req: request(credential) },
    });
  const me = (credential = state.credential) =>
    query("{ me { userId email } }", undefined, credential);
  const set = () =>
    query(
      "mutation($input:SetPreferenceInput!){setPreference(input:$input){id value}}",
      { input: { slug: "profile.first_name", value: "Ada" } },
    );
  const reset = (mode: string) =>
    query(
      `mutation { resetMyMemory(mode:${mode}) { mode preferencesDeleted preferenceDefinitionsDeleted locationsDeleted preferenceAuditEventsDeleted mcpAccessEventsDeleted permissionGrantsDeleted } }`,
    );
  function snapshot() {
    const c = db.connect();
    try {
      return SQLITE_TABLES.map((table) =>
        c.all(`SELECT * FROM ${table} ORDER BY 1`).map((row) => ({ ...row })),
      );
    } finally {
      c.close();
    }
  }
  function enableReset() {
    const config = app.get(ConfigService),
      original = config.get.bind(config);
    jest
      .spyOn(config, "get")
      .mockImplementation((key: string, ...args: any[]) =>
        key === "app.enableDemoReset" ? true : original(key, ...args),
      );
  }
  async function authenticated() {
    expect(await me()).toMatchObject({
      data: { me: { userId: state.principalId } },
    });
  }
  async function http(credential: string, accepted: boolean) {
    const req = request(credential),
      context = new ExecutionContextHost([req, {}, jest.fn()]);
    context.setType("http");
    const call = app.get(JwtAuthGuard).canActivate(context);
    if (accepted) {
      await expect(call).resolves.toBe(true);
      expect(req.user.userId).toBe(state.principalId);
    } else await expect(call).rejects.toThrow("Unauthorized");
  }
  it("wires real ports, catalog, exact GraphQL/HTTP authentication and self-only lookup without a listener or hosted providers", async () => {
    expect(app.get(StorageUnitOfWork)).toBeInstanceOf(SqliteStorageUnitOfWork);
    expect(() => app.get(PreferenceAuditService)).toThrow();
    const providers = [...app.get(ModulesContainer).values()].flatMap(
      (module) =>
        [...module.providers.keys()].map((token) =>
          typeof token === "function" ? token.name : String(token),
        ),
    );
    for (const name of [
      "PrismaService",
      "PostgresStorageUnitOfWork",
      "McpService",
      "JwtStrategy",
      "VertexAiService",
      "VertexAiStructuredService",
    ])
      expect(providers).not.toContain(name);
    expect(await rows.user.count()).toBe(1);
    expect(await rows.externalIdentity.count()).toBe(0);
    expect(
      await rows.preferenceDefinition.count({ where: { namespace: "GLOBAL" } }),
    ).toBe(19);
    await authenticated();
    await http(state.credential, true);
    await http("wrong", false);
    expect((await me("wrong")).errors).toHaveLength(1);
    expect(
      (
        await graphql({
          schema,
          source: "{me{userId}}",
          contextValue: { req: request() },
        })
      ).errors,
    ).toHaveLength(1);
    await rows.user.create({
      data: { userId: "other", email: "other@example.test" },
    });
    expect(
      await query("query($id:ID!){user(id:$id){userId}}", {
        id: state.principalId,
      }),
    ).toMatchObject({ data: { user: { userId: state.principalId } } });
    expect(
      (await query("query($id:ID!){user(id:$id){userId}}", { id: "other" }))
        .errors?.[0].message,
    ).toBe("You can only view your own account");
    expect(
      (await query('{askVertexAI(message:"prompt-secret-canary")}')).errors?.[0]
        .message,
    ).toBe(
      "Failed to generate response from Vertex AI. Please try again later.",
    );
  });
  it("uses committed preference/audit/history/grant paths and validates mutation input", async () => {
    expect((await set()).errors).toBeUndefined();
    const history = await query(
      '{ preferenceAuditHistory(input:{first:20,subjectSlug:"profile."}) { items { id subjectSlug eventType } hasNextPage } }',
    );
    expect(history.errors).toBeUndefined();
    expect((history.data!.preferenceAuditHistory as any).items).toEqual([
      expect.objectContaining({
        subjectSlug: "profile.first_name",
        eventType: "PREFERENCE_SET",
      }),
    ]);
    const grant = await query(
      'mutation { setPermissionGrant(input:{clientKey:"codex",target:"*",action:READ,effect:ALLOW}) { id action effect } }',
    );
    expect(grant.errors).toBeUndefined();
    expect(await query("{myPermissionGrants{action effect}}")).toMatchObject({
      data: { myPermissionGrants: [{ action: "READ", effect: "ALLOW" }] },
    });
    const before = snapshot();
    expect(
      (
        await query(
          'mutation { setPermissionGrant(input:{clientKey:"unknown",target:"*",action:READ,effect:ALLOW}) { id } }',
        )
      ).errors,
    ).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });
  it("rotates through the actual administrator and persists old/new bearer behavior across a new application", async () => {
    const before = snapshot(),
      old = state.credential;
    admin("rotate");
    state = decodeLocalIdentityState(stateBytes());
    expect(state.generation).toBe(2);
    expect(snapshot()).toEqual(before);
    expect((await me(old)).errors).toHaveLength(1);
    await authenticated();
    await http(old, false);
    await http(state.credential, true);
    await app.close();
    passport.unuse(HUMAN_AUTH_STRATEGY);
    await open();
    await authenticated();
    expect((await me(old)).errors).toHaveLength(1);
    expect(snapshot()).toEqual(before);
  });
  it("keeps the actual MCP dispatcher result and committed audit when a real independent access append fails", async () => {
    // A separate in-memory MCP assembly exercises the hosted-compatible caller; local composition gains no transport/provider.
    const authorization = new McpAuthorizationService(
      app.get(PermissionGrantService),
    );
    const tool = new PreferenceMutateTool(
      app.get(PreferenceService),
      app.get(PreferenceDefinitionService),
      app.get(PreferenceDefinitionRepository),
      authorization,
    );
    const access = new McpAccessLogService(app.get(AccessHistoryStorage));
    const service = new McpService(
      new ConfigService({
        mcp: {
          server: { name: "local-contract", version: "1" },
          tools: { preferences: { enabled: true } },
          resources: { schema: { enabled: false } },
        },
      }),
      [tool],
      [],
      authorization,
      access,
    );
    service.onModuleInit();
    const server = service.createServer({
      user: { userId: state.principalId, email: "local@principal.invalid" },
      client: {
        key: "codex",
        policy: {
          key: "codex",
          label: "test",
          capabilities: ["preferences:write"],
          targetRules: [],
        },
      },
    });
    const client = new Client(
      { name: "sqlite-contract", version: "1" },
      { capabilities: {} },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    let reached = false;
    const connect = db.connect.bind(db);
    const spy = jest.spyOn(db, "connect").mockImplementation(() => {
      const c = connect();
      c.exec(
        "CREATE TEMP TRIGGER fail_access BEFORE INSERT ON mcp_access_events BEGIN SELECT RAISE(ABORT,'private-access-canary'); END",
      );
      const get = c.get.bind(c);
      c.get = (sql, values) => {
        if (sql.startsWith("INSERT INTO mcp_access_events")) {
          expect(c.get("SELECT count(*) n FROM user_preferences")!.n).toBe(1);
          expect(
            c.get("SELECT count(*) n FROM preference_audit_events")!.n,
          ).toBe(1);
          expect(c.inTransaction).toBe(false);
          reached = true;
        }
        return get(sql, values);
      };
      return c;
    });
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: "mutatePreferences",
        arguments: {
          operation: "SET_PREFERENCE",
          preference: { slug: "profile.first_name", value: '"Ada"' },
        },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.parse((result.content as any)[0].text)).toMatchObject({
        success: true,
        changed: true,
      });
      expect(reached).toBe(true);
      spy.mockRestore();
      const preference = await rows.preference.findFirst();
      expect(preference.value).toBe("Ada");
      expect(await rows.preferenceAuditEvent.findMany()).toEqual([
        expect.objectContaining({
          targetId: preference.id,
          eventType: "PREFERENCE_SET",
          origin: "MCP",
        }),
      ]);
      expect(await rows.mcpAccessEvent.count()).toBe(0);
    } finally {
      spy.mockRestore();
      await client.close();
      await server.close();
    }
  });
  async function prepare() {
    expect((await set()).errors).toBeUndefined();
    const userId = state.principalId;
    const definition = await rows.preferenceDefinition.create({
      data: {
        namespace: `USER:${userId}`,
        slug: "custom.local",
        description: "Owned",
        valueType: "STRING",
        scope: "LOCATION",
        ownerUserId: userId,
      },
    });
    const location = await rows.location.create({
      data: { userId, type: "HOME", label: "Home", address: "private-address" },
    });
    await rows.preference.create({
      data: {
        userId,
        definitionId: definition.id,
        locationId: location.locationId,
        contextKey: location.locationId,
        value: "local",
        status: "ACTIVE",
        sourceType: "USER",
      },
    });
    await rows.externalIdentity.create({
      data: {
        userId,
        provider: "test",
        issuer: "test",
        providerUserId: "subject",
        metadata: { preserve: true },
      },
    });
    await rows.permissionGrant.create({
      data: {
        userId,
        clientKey: "codex",
        target: "*",
        action: "READ",
        effect: "ALLOW",
      },
    });
    await rows.mcpAccessEvent.create({
      data: {
        userId,
        clientKey: "codex",
        surface: "TOOLS_CALL",
        operationName: "test",
        outcome: "SUCCESS",
        correlationId: "test",
        latencyMs: 1,
      },
    });
    await rows.user.create({
      data: { userId: "other", email: "other@example.test" },
    });
    const global = await rows.preferenceDefinition.findFirst({
      where: { namespace: "GLOBAL", slug: "profile.first_name" },
    });
    await rows.preference.create({
      data: {
        userId: "other",
        definitionId: global.id,
        contextKey: "__GLOBAL__",
        value: "other",
      },
    });
    await rows.permissionGrant.create({
      data: {
        userId: "other",
        clientKey: "codex",
        target: "*",
        action: "WRITE",
        effect: "DENY",
      },
    });
    return {
      definition,
      identities: await Promise.all([
        rows.user.findMany(),
        rows.externalIdentity.findMany(),
      ]),
      bytes: stateBytes(),
    };
  }
  it("denies advanced reset by default without changing data or identity", async () => {
    await prepare();
    const before = snapshot(),
      bytes = stateBytes();
    expect((await reset("FULL_USER_DATA")).errors?.[0].message).toContain(
      "Demo reset modes are disabled",
    );
    expect(snapshot()).toEqual(before);
    expect(stateBytes()).toEqual(bytes);
    await authenticated();
  });
  it.each(["MEMORY_ONLY", "DEMO_DATA", "FULL_USER_DATA"])(
    "applies %s to real rows while preserving identity and other-user data",
    async (mode) => {
      const before = await prepare();
      enableReset();
      const result = await reset(mode);
      expect(result.errors).toBeUndefined();
      expect(result.data!.resetMyMemory).toEqual({
        mode,
        preferencesDeleted: 2,
        preferenceDefinitionsDeleted: mode === "MEMORY_ONLY" ? 0 : 1,
        locationsDeleted: mode === "MEMORY_ONLY" ? 0 : 1,
        preferenceAuditEventsDeleted: mode === "MEMORY_ONLY" ? 0 : 1,
        mcpAccessEventsDeleted: mode === "MEMORY_ONLY" ? 0 : 1,
        permissionGrantsDeleted: mode === "FULL_USER_DATA" ? 1 : 0,
      });
      expect(
        await rows.preference.count({ where: { userId: state.principalId } }),
      ).toBe(0);
      expect(await rows.preference.count({ where: { userId: "other" } })).toBe(
        1,
      );
      expect(
        await rows.permissionGrant.count({ where: { userId: "other" } }),
      ).toBe(1);
      expect(
        await rows.preferenceDefinition.count({
          where: { namespace: "GLOBAL" },
        }),
      ).toBe(19);
      expect(
        await rows.preferenceAuditEvent.count({
          where: { userId: state.principalId },
        }),
      ).toBe(mode === "MEMORY_ONLY" ? 2 : 0);
      expect(
        await Promise.all([
          rows.user.findMany(),
          rows.externalIdentity.findMany(),
        ]),
      ).toEqual(before.identities);
      expect(stateBytes()).toEqual(before.bytes);
      await authenticated();
    },
  );
  it("rolls back earlier deletes when another user references an owned definition", async () => {
    const { definition } = await prepare();
    enableReset();
    await rows.preference.create({
      data: {
        userId: "other",
        definitionId: definition.id,
        contextKey: "__GLOBAL__",
        value: "foreign",
      },
    });
    const before = snapshot(),
      bytes = stateBytes();
    expect((await reset("FULL_USER_DATA")).errors?.[0].message).toContain(
      "referenced by another user",
    );
    expect(snapshot()).toEqual(before);
    expect(stateBytes()).toEqual(bytes);
    await authenticated();
  });
  it.each([
    ["MEMORY_ONLY", "preference_audit_events", "INSERT"],
    ["DEMO_DATA", "locations", "DELETE"],
    ["FULL_USER_DATA", "permission_grants", "DELETE"],
  ])(
    "rolls back witnessed late %s failure and preserves exact identity access",
    async (mode, table, operation) => {
      await prepare();
      enableReset();
      const before = snapshot(),
        bytes = stateBytes();
      let witnessed = false;
      const connect = db.connect.bind(db);
      const spy = jest.spyOn(db, "connect").mockImplementation(() => {
        const c = connect();
        c.exec(
          `CREATE TEMP TRIGGER fail_reset BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture'); END`,
        );
        const observe = (sql: string) => {
          if (sql.includes(table) && sql.startsWith(operation)) {
            expect(
              c.get("SELECT count(*) n FROM user_preferences WHERE user_id=?", [
                state.principalId,
              ])!.n,
            ).toBe(0);
            witnessed = true;
          }
        };
        const run = c.run.bind(c),
          get = c.get.bind(c);
        c.run = (sql, values) => {
          observe(sql);
          return run(sql, values);
        };
        c.get = (sql, values) => {
          observe(sql);
          return get(sql, values);
        };
        return c;
      });
      expect((await reset(mode)).errors).toHaveLength(1);
      spy.mockRestore();
      expect(witnessed).toBe(true);
      expect(snapshot()).toEqual(before);
      expect(stateBytes()).toEqual(bytes);
      await authenticated();
    },
  );
});
