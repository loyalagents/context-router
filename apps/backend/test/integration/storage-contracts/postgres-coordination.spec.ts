import { randomBytes } from "node:crypto";
import {
  PostgresLocalIdentityCoordination as LocalIdentityRepository,
  createLocalIdentityDatabaseClient,
  type LocalIdentityDatabaseClient,
  type LocalIdentityDatabaseSession,
} from '@/infrastructure/storage/postgres/postgres-local-identity-coordination';
import { getPrismaClient } from "../../setup/test-db";
import { localCoordinationContract } from "./local-coordination.contract";

localCoordinationContract("PostgreSQL", async () => {
  const db = getPrismaClient();
  const state = {
    schemaVersion: 1 as const,
    databaseTargetId: randomBytes(32).toString("base64url"),
    principalId: randomBytes(32).toString("base64url"),
    credential: randomBytes(32).toString("base64url"),
    generation: 1,
  };
  const handles: LocalIdentityDatabaseSession[] = [];
  let heldClient: LocalIdentityDatabaseClient | undefined;
  let queries = 0;
  const repository = new LocalIdentityRepository({
    clientConfig: { connectionString: process.env.DATABASE_URL },
    clientFactory: (config) => {
      const client = createLocalIdentityDatabaseClient(config);
      return {
        connect: () => client.connect(),
        query: async (sql, parameters) => {
          queries++;
          const result = await client.query(sql, parameters);
          if (result.rows[0]?.locked === true) heldClient = client;
          return result;
        },
        end: () => client.end(),
        destroy: () => client.destroy(),
        assertHealthy: () => client.assertHealthy(),
      };
    },
  });
  return {
    state,
    async acquire() {
      const handle = await repository.acquire();
      handles.push(handle);
      return handle;
    },
    snapshot: () =>
      Promise.all([
        db.user.findMany({ orderBy: { userId: "asc" } }),
        db.externalIdentity.findMany({ orderBy: { id: "asc" } }),
      ]),
    async createForeignPrincipal() {
      await db.user.create({ data: { email: "foreign@example.test" } });
    },
    async changeEmailAndAttachIdentity() {
      await db.user.update({
        where: { userId: state.principalId },
        data: { email: "changed@example.test" },
      });
      await db.externalIdentity.create({
        data: {
          userId: state.principalId,
          provider: "contract",
          issuer: "https://issuer.example.test/",
          providerUserId: "subject",
        },
      });
    },
    loseHeldConnection() {
      heldClient!.destroy();
    },
    queryCount: () => queries,
    async dispose() {
      for (const handle of handles) {
        try {
          await handle.release();
        } finally {
          handle.destroy();
        }
      }
    },
  };
});
