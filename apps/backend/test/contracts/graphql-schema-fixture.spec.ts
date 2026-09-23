import { readFileSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { resolve } from "path";
import dns = require("node:dns");
import { Socket } from "net";
import {
  GRAPHQL_SCHEMA_FIXTURE_PATH,
  GRAPHQL_SCHEMA_STALE_MESSAGE,
  buildApplicationGraphqlSchemaSdl,
  buildLocalApplicationGraphqlSchemaSdl,
  checkGraphqlSchemaFixture,
  createGraphqlSchemaBuildEnvironment,
  writeGraphqlSchemaFixture,
} from "../../scripts/graphql-schema-fixture";

const trackedSchema = readFileSync(
  resolve(__dirname, "..", "..", "src", "schema.gql"),
  "utf8",
);

describe("GraphQL schema fixture tool", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("builds the full application schema exactly without inherited credentials", async () => {
    const originalEnvironment = process.env;
    const originalSecret = process.env.AUTH0_CLIENT_SECRET;
    const originalProject = process.env.GCP_PROJECT_ID;
    process.env.AUTH0_CLIENT_SECRET = "schema-test-secret-canary";
    process.env.GCP_PROJECT_ID = "schema-test-project-canary";

    try {
      const buildEnvironment = createGraphqlSchemaBuildEnvironment();
      expect(buildEnvironment).not.toHaveProperty("AUTH0_CLIENT_SECRET");
      expect(buildEnvironment).not.toHaveProperty("GCP_PROJECT_ID");
      expect(buildEnvironment).not.toHaveProperty(
        "GOOGLE_APPLICATION_CREDENTIALS",
      );

      await expect(buildApplicationGraphqlSchemaSdl()).resolves.toBe(
        trackedSchema,
      );
      expect(Buffer.byteLength(trackedSchema, "utf8")).toBe(14088);
      expect(process.env).toBe(originalEnvironment);
      expect(process.env.AUTH0_CLIENT_SECRET).toBe("schema-test-secret-canary");
      expect(process.env.GCP_PROJECT_ID).toBe("schema-test-project-canary");
    } finally {
      if (originalSecret === undefined) delete process.env.AUTH0_CLIENT_SECRET;
      else process.env.AUTH0_CLIENT_SECRET = originalSecret;
      if (originalProject === undefined) delete process.env.GCP_PROJECT_ID;
      else process.env.GCP_PROJECT_ID = originalProject;
    }
  });

  it("resolves the tracked fixture independently of the caller cwd", () => {
    expect(GRAPHQL_SCHEMA_FIXTURE_PATH).toBe(
      resolve(__dirname, "..", "..", "src", "schema.gql"),
    );
  });

  it("builds the local application schema byte-for-byte equal to hosted and tracked SDL", async () => {
    const hosted = await buildApplicationGraphqlSchemaSdl();
    const local = await buildLocalApplicationGraphqlSchemaSdl();

    expect(local).toBe(hosted);
    expect(local).toBe(trackedSchema);
    expect(local).toContain("mcpAccessHistory");
  });

  it("initializes the local schema composition without DNS or socket I/O", async () => {
    const lookup = jest.spyOn(dns, "lookup");
    const connect = jest.spyOn(Socket.prototype, "connect");

    await expect(buildLocalApplicationGraphqlSchemaSdl()).resolves.toBe(
      trackedSchema,
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("checks without changing a stale fixture and reports the supported producer", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "schema-fixture-check-"));
    temporaryRoots.push(root);
    const fixturePath = resolve(root, "schema.gql");
    await writeFile(fixturePath, "stale-schema", "utf8");

    await expect(
      checkGraphqlSchemaFixture({
        fixturePath,
        schemaSupplier: async () => trackedSchema,
      }),
    ).rejects.toThrow(GRAPHQL_SCHEMA_STALE_MESSAGE);
    await expect(readFile(fixturePath, "utf8")).resolves.toBe("stale-schema");
  });

  it("writes and then verifies the serializer bytes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "schema-fixture-write-"));
    temporaryRoots.push(root);
    const fixturePath = resolve(root, "schema.gql");
    const schemaSupplier = async () => trackedSchema;

    await writeGraphqlSchemaFixture({ fixturePath, schemaSupplier });

    await expect(readFile(fixturePath, "utf8")).resolves.toBe(trackedSchema);
    await expect(
      checkGraphqlSchemaFixture({ fixturePath, schemaSupplier }),
    ).resolves.toBeUndefined();
  });
});
