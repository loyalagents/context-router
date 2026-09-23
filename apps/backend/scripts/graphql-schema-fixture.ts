import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { GraphQLSchemaHost } from "@nestjs/graphql";
import { Test, type TestingModule } from "@nestjs/testing";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { AppModule } from "../src/app.module";
import { resolveRuntimeConfiguration } from "../src/config/runtime-config";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service";
import { VertexAiStructuredService } from "../src/infrastructure/vertex-ai/vertex-ai-structured.service";
import { VertexAiService } from "../src/infrastructure/vertex-ai/vertex-ai.service";
import { serializeGraphqlSchema } from "../src/mcp/resources/graphql-schema-sdl";

export const GRAPHQL_SCHEMA_FIXTURE_PATH = resolve(
  __dirname,
  "..",
  "src",
  "schema.gql",
);
export const GRAPHQL_SCHEMA_STALE_MESSAGE =
  'GraphQL schema fixture is stale. Run "pnpm --filter backend schema:generate".';

const GRAPHQL_SCHEMA_USAGE =
  "Usage: graphql-schema-fixture.ts (--check | --write)";

type SchemaSupplier = () => string | Promise<string>;

export interface GraphqlSchemaFixtureOptions {
  fixturePath?: string;
  schemaSupplier?: SchemaSupplier;
}

export function createGraphqlSchemaBuildEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PORT: "0",
    APP_HOST: "127.0.0.1",
    CORS_ORIGIN: "http://127.0.0.1",
    DATABASE_URL:
      "postgresql://schema-fixture:schema-fixture@127.0.0.1:1/schema_fixture",
    GRAPHQL_PLAYGROUND: "false",
    GRAPHQL_DEBUG: "false",
    AUTH0_AUDIENCE: "https://schema-fixture.invalid/api",
    AUTH0_ISSUER: "https://schema-fixture.invalid/",
    MCP_SERVER_URL: "https://schema-fixture.invalid",
    MCP_RESOURCE: "https://schema-fixture.invalid/mcp",
    MCP_HTTP_ENABLED: "false",
    MCP_STDIO_ENABLED: "false",
    ENABLE_DEMO_RESET: "false",
  };
}

function throwSchemaBuildFailures(
  primaryError: unknown,
  cleanupError: unknown,
): void {
  if (primaryError !== undefined && cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      "GraphQL schema generation and cleanup both failed",
    );
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;
}

export async function buildApplicationGraphqlSchemaSdl(): Promise<string> {
  const inheritedEnvironment = process.env;
  let testingModule: TestingModule | undefined;
  let application: INestApplication | undefined;
  let schema: string | undefined;
  let primaryError: unknown;
  let cleanupError: unknown;

  process.env = createGraphqlSchemaBuildEnvironment();
  try {
    try {
      const configuration = resolveRuntimeConfiguration(process.env);
      const moduleBuilder = Test.createTestingModule({
        imports: [AppModule.register(configuration, process.env)],
      });
      moduleBuilder.overrideProvider(PrismaService).useValue({});
      moduleBuilder.overrideProvider(VertexAiService).useValue({});
      moduleBuilder.overrideProvider(VertexAiStructuredService).useValue({});

      testingModule = await moduleBuilder.compile();
      application = testingModule.createNestApplication({ logger: false });
      await application.init();
      schema = serializeGraphqlSchema(
        application.get(GraphQLSchemaHost).schema,
      );
    } catch (error) {
      primaryError = error;
    } finally {
      try {
        if (application) await application.close();
        else if (testingModule) await testingModule.close();
      } catch (error) {
        cleanupError = error;
      }
    }
  } finally {
    process.env = inheritedEnvironment;
  }

  throwSchemaBuildFailures(primaryError, cleanupError);
  if (schema === undefined) {
    throw new Error("GraphQL schema generation returned no schema");
  }
  return schema;
}

function resolveFixtureOptions({
  fixturePath = GRAPHQL_SCHEMA_FIXTURE_PATH,
  schemaSupplier = buildApplicationGraphqlSchemaSdl,
}: GraphqlSchemaFixtureOptions): {
  fixturePath: string;
  schemaSupplier: SchemaSupplier;
} {
  return { fixturePath, schemaSupplier };
}

export async function checkGraphqlSchemaFixture(
  options: GraphqlSchemaFixtureOptions = {},
): Promise<void> {
  const { fixturePath, schemaSupplier } = resolveFixtureOptions(options);
  const generatedSchema = await schemaSupplier();
  let trackedSchema: string | undefined;
  try {
    trackedSchema = await readFile(fixturePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (trackedSchema !== generatedSchema) {
    throw new Error(GRAPHQL_SCHEMA_STALE_MESSAGE);
  }
}

export async function writeGraphqlSchemaFixture(
  options: GraphqlSchemaFixtureOptions = {},
): Promise<void> {
  const { fixturePath, schemaSupplier } = resolveFixtureOptions(options);
  await writeFile(fixturePath, await schemaSupplier(), "utf8");
}

export async function runGraphqlSchemaFixtureCommand(
  arguments_: string[],
): Promise<void> {
  if (arguments_.length !== 1) throw new Error(GRAPHQL_SCHEMA_USAGE);
  if (arguments_[0] === "--check") {
    await checkGraphqlSchemaFixture();
    process.stdout.write("GraphQL schema fixture is current.\n");
    return;
  }
  if (arguments_[0] === "--write") {
    await writeGraphqlSchemaFixture();
    process.stdout.write("Updated apps/backend/src/schema.gql.\n");
    return;
  }
  throw new Error(GRAPHQL_SCHEMA_USAGE);
}

if (require.main === module) {
  void runGraphqlSchemaFixtureCommand(process.argv.slice(2)).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
