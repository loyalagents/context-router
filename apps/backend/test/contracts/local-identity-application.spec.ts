import passport from "passport";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { INestApplication } from "@nestjs/common";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import { Test, type TestingModule } from "@nestjs/testing";
import { ExecutionContextHost } from "@nestjs/core/helpers/execution-context-host";
import { graphql, type GraphQLSchema } from "graphql";

import { LocalApplicationModule } from "../../src/composition/local-application.module";
import type { LocalIdentityConfiguration } from "../../src/config/local-identity.config";
import { HUMAN_AUTH_STRATEGY } from "../../src/domains/shared/ports/human-auth.constants";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service";
import { VertexAiStructuredService } from "../../src/infrastructure/vertex-ai/vertex-ai-structured.service";
import { VertexAiService } from "../../src/infrastructure/vertex-ai/vertex-ai.service";
import { McpService } from "../../src/mcp/mcp.service";
import { JwtAuthGuard } from "../../src/common/guards/jwt-auth.guard";
import { JwtStrategy } from "../../src/modules/auth/strategies/jwt.strategy";
import {
  encodeLocalIdentityState,
  type LocalIdentityState,
} from "../../src/modules/auth/local-identity-state.codec";

const token = (fill: number) => Buffer.alloc(32, fill).toString("base64url");
const DATABASE_TARGET_ID = token(0x11);
const PRINCIPAL_ID = token(0x22);
const INITIAL_CREDENTIAL = token(0x33);
const ROTATED_CREDENTIAL = token(0x44);

const user = {
  userId: PRINCIPAL_ID,
  email: "local@principal.invalid",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function state(
  credential = INITIAL_CREDENTIAL,
  generation = 1,
): LocalIdentityState {
  return {
    schemaVersion: 1,
    databaseTargetId: DATABASE_TARGET_ID,
    principalId: PRINCIPAL_ID,
    credential,
    generation,
  };
}

function configuration(stateRoot: string): LocalIdentityConfiguration {
  const connection = {
    host: "127.0.0.1",
    port: 1,
    database: "local_identity_contract",
    user: "local-contract",
    password: "database-password-canary",
    ssl: { rejectUnauthorized: true, ca: "tls-ca-canary" },
  };
  return {
    stateRoot,
    databaseTargetId: DATABASE_TARGET_ID,
    database: {
      protocol: "postgresql:",
      host: "127.0.0.1",
      port: 1,
      database: "local_identity_contract",
      schema: "public",
    },
    clientConfig: { ...connection },
    poolConfig: { ...connection },
  };
}

function authorization(credential: string): string {
  return `Bearer ${credential}`;
}

describe("real local identity application composition", () => {
  let temporaryRoot: string;
  let stateRoot: string;
  let statePath: string;
  let testingModule: TestingModule;
  let application: INestApplication;
  let schema: GraphQLSchema;
  let prisma: Record<string, any>;
  let transaction: Record<string, any>;

  async function replaceState(next: LocalIdentityState): Promise<void> {
    const stage = join(stateRoot, "identity.stage-test.tmp");
    await writeFile(stage, encodeLocalIdentityState(next), { mode: 0o600 });
    await rename(stage, statePath);
  }

  function requestFor(credential?: string) {
    if (!credential) return { headers: {}, rawHeaders: [] };
    const value = authorization(credential);
    return {
      headers: { authorization: value },
      rawHeaders: ["Authorization", value],
    };
  }

  function executeGraphql(
    source: string,
    credential?: string,
    variableValues?: Record<string, unknown>,
  ) {
    return graphql({
      schema,
      source,
      variableValues,
      contextValue: { req: requestFor(credential) },
    });
  }

  beforeAll(async () => {
    const createdRoot = await mkdtemp(join(tmpdir(), "local-app-contract-"));
    await chmod(createdRoot, 0o700);
    temporaryRoot = await realpath(createdRoot);
    stateRoot = join(temporaryRoot, "state");
    statePath = join(stateRoot, "identity.json");
    await mkdir(stateRoot, { mode: 0o700 });
    await writeFile(statePath, encodeLocalIdentityState(state()), {
      mode: 0o600,
    });

    transaction = {
      preferenceAuditEvent: {
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      mcpAccessEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      preferenceDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      preference: {
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      location: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      permissionGrant: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma = {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.userId === PRINCIPAL_ID ? user : null,
        ),
      },
      $transaction: jest.fn(async (operation: (tx: unknown) => unknown) =>
        operation(transaction),
      ),
    };

    const builder = Test.createTestingModule({
      imports: [LocalApplicationModule.register(configuration(stateRoot))],
    });
    builder.overrideProvider(PrismaService).useValue(prisma);
    testingModule = await builder.compile();
    application = testingModule.createNestApplication({ logger: false });
    await application.init();
    schema = application.get(GraphQLSchemaHost).schema;
  });

  beforeEach(async () => {
    await replaceState(state());
    jest.clearAllMocks();
  });

  afterAll(async () => {
    if (application) await application.close();
    else if (testingModule) await testingModule.close();
    passport.unuse(HUMAN_AUTH_STRATEGY);
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("accepts only the exact local bearer for me", async () => {
    const query = "{ me { userId email } }";

    const accepted = await executeGraphql(query, INITIAL_CREDENTIAL);
    expect(accepted).toMatchObject({
      data: { me: { userId: PRINCIPAL_ID, email: user.email } },
    });

    for (const credential of [undefined, token(0x55)]) {
      const denied = await executeGraphql(query, credential);
      expect(denied.data ?? null).toBeNull();
      expect(denied.errors).toHaveLength(1);
    }
  });

  it("keeps user(id) self-only under local authentication", async () => {
    const own = await executeGraphql(
      "query($id: ID!) { user(id: $id) { userId email } }",
      INITIAL_CREDENTIAL,
      { id: PRINCIPAL_ID },
    );
    expect((own.data?.user as Record<string, unknown>).userId).toBe(
      PRINCIPAL_ID,
    );

    const other = await executeGraphql(
      "query($id: ID!) { user(id: $id) { userId } }",
      INITIAL_CREDENTIAL,
      { id: token(0x66) },
    );
    expect(other.data ?? null).toBeNull();
    expect(other.errors?.[0].message).toBe(
      "You can only view your own account",
    );
  });

  it("uses the same local human bearer for guarded REST routes", async () => {
    const guard = application.get(JwtAuthGuard);
    const deniedRequest = requestFor(token(0x55));
    const deniedContext = new ExecutionContextHost([
      deniedRequest,
      {},
      jest.fn(),
    ]);
    deniedContext.setType("http");
    await expect(guard.canActivate(deniedContext)).rejects.toThrow(
      "Unauthorized",
    );

    const acceptedRequest = requestFor(INITIAL_CREDENTIAL) as Record<
      string,
      unknown
    >;
    const acceptedContext = new ExecutionContextHost([
      acceptedRequest,
      {},
      jest.fn(),
    ]);
    acceptedContext.setType("http");
    await expect(guard.canActivate(acceptedContext)).resolves.toBe(true);
    expect(acceptedRequest.user).toEqual(user);
  });

  it("linearizes credential rotation between requests", async () => {
    const query = "{ me { userId } }";
    const initial = await executeGraphql(query, INITIAL_CREDENTIAL);
    expect((initial.data?.me as Record<string, unknown>).userId).toBe(
      PRINCIPAL_ID,
    );

    await replaceState(state(ROTATED_CREDENTIAL, 2));

    const oldCredential = await executeGraphql(query, INITIAL_CREDENTIAL);
    expect(oldCredential.data ?? null).toBeNull();

    const newCredential = await executeGraphql(query, ROTATED_CREDENTIAL);
    expect((newCredential.data?.me as Record<string, unknown>).userId).toBe(
      PRINCIPAL_ID,
    );
  });

  it("keeps identity bytes unchanged across a memory reset", async () => {
    const before = await readFile(statePath);
    const response = await executeGraphql(
      "mutation { resetMyMemory(mode: MEMORY_ONLY) { mode preferencesDeleted } }",
      INITIAL_CREDENTIAL,
    );

    expect(response).toMatchObject({
      data: {
        resetMyMemory: { mode: "MEMORY_ONLY", preferencesDeleted: 2 },
      },
    });
    await expect(readFile(statePath)).resolves.toEqual(before);
  });

  it("binds the local unavailable model and excludes hosted/MCP providers", async () => {
    const response = await executeGraphql(
      '{ askVertexAI(message: "prompt-secret-canary") }',
      INITIAL_CREDENTIAL,
    );

    expect(response.data ?? null).toBeNull();
    expect(response.errors?.[0].message).toBe(
      "Failed to generate response from Vertex AI. Please try again later.",
    );
    for (const provider of [
      JwtStrategy,
      McpService,
      VertexAiService,
      VertexAiStructuredService,
    ]) {
      expect(() => testingModule.get(provider, { strict: false })).toThrow();
    }
  });
});
