import { existsSync, readFileSync, readdirSync } from "fs";
import { extname, join, relative, resolve } from "path";

const repositoryRoot = resolve(__dirname, "../../../..");
const backendRoot = join(repositoryRoot, "apps/backend");

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "generated" ? [] : sourceFiles(path);
    }
    return extname(entry.name) === ".ts" && !entry.name.endsWith(".spec.ts")
      ? [path]
      : [];
  });
}

describe("runtime composition contract", () => {
  it("keeps main thin and injects the backend package root explicitly", () => {
    const main = read("apps/backend/src/main.ts");

    expect(main).toMatch(/resolve\(__dirname,\s*["']\.\.["']\)/);
    expect(main).toContain("bootstrapHostedApplication");
    expect(main).toContain("process.exit(1)");
    expect(main).not.toMatch(
      /process\.env|enableCors|useGlobalPipes|\.listen\(/,
    );
    expect(main).not.toContain("NestFactory");
  });

  it("loads configuration before dynamic application construction without cwd env search", () => {
    const appModule = read("apps/backend/src/app.module.ts");
    const bootstrap = read("apps/backend/src/bootstrap/hosted-bootstrap.ts");

    expect(appModule).toContain("ignoreEnvFile: true");
    expect(appModule).toContain("GraphQLModule.forRootAsync");
    expect(appModule).toContain("ConfigService");
    expect(appModule).not.toMatch(/process\.env|envFilePath/);
    expect(bootstrap).toContain("loadRuntimeConfiguration");
    expect(bootstrap).toContain("abortOnError: false");
    expect(bootstrap).toMatch(
      /const runtime(?:Configuration)? = loadRuntimeConfiguration[\s\S]*applicationPromise = createHostedApplication/,
    );
  });

  it("reuses production application configuration in the test launch path", () => {
    const testApp = read("apps/backend/test/setup/test-app.ts");

    expect(testApp).toContain("configureHostedApplication");
    expect(testApp).not.toContain("new ValidationPipe");
  });

  it("confines raw backend environment reads to named config loaders", () => {
    const unexpected = sourceFiles(join(backendRoot, "src"))
      .filter((path) => !path.includes(`${join("src", "config")}/`))
      .filter(
        (path) =>
          path !== join(backendRoot, "src/bootstrap/hosted-bootstrap.ts"),
      )
      .filter((path) => readFileSync(path, "utf8").includes("process.env"))
      .map((path) => relative(repositoryRoot, path));

    expect(unexpected).toEqual([]);
    expect(
      read("apps/backend/src/modules/reset/user-data-reset.service.ts"),
    ).not.toContain("process.env.ENABLE_DEMO_RESET");
    expect(
      read("apps/backend/src/infrastructure/prisma/prisma-client-options.ts"),
    ).not.toContain("process.env.DATABASE_URL");
    expect(
      read("apps/backend/src/infrastructure/prisma/prisma.service.ts"),
    ).not.toContain("process.env.NODE_ENV");
  });

  it("gives runtime config sole ownership of listener and shared CORS input", () => {
    const runtimeConfig = read("apps/backend/src/config/runtime-config.ts");
    const listenerOptions = read("apps/backend/src/config/listener-options.ts");
    const mcpConfig = read("apps/backend/src/config/mcp.config.ts");

    expect(runtimeConfig).toContain("PORT");
    expect(runtimeConfig).toContain("APP_HOST");
    expect(runtimeConfig).toContain("CORS_ORIGIN");
    expect(listenerOptions).not.toContain("process.env");
    expect(listenerOptions).toContain("RuntimeConfiguration");
    expect(mcpConfig).not.toContain("environment.CORS_ORIGIN");
    expect(mcpConfig).toContain("MCP_HTTP_ALLOWED_ORIGINS");
  });

  it("owns the runtime schema in memory without caller-cwd filesystem access", () => {
    const appModule = read("apps/backend/src/app.module.ts");
    const schemaResource = read(
      "apps/backend/src/mcp/resources/schema.resource.ts",
    );
    const schemaProvider = read(
      "apps/backend/src/mcp/resources/graphql-schema-sdl.ts",
    );
    const collector = read(
      "apps/backend/test/contracts/mcp-contract-collector.ts",
    );

    expect(appModule).toMatch(/autoSchemaFile:\s*true/);
    expect(appModule).not.toMatch(/process\.cwd|schema\.gql/);
    expect(schemaResource).not.toMatch(
      /process\.cwd|schema\.gql|readFile|from ["']fs|from ["']path/,
    );
    expect(schemaProvider).toContain("strict: false");
    expect(collector).toMatch(/new SchemaResource\(\(\) =>/);
  });

  it("separates application PORT from Compose publication variables", () => {
    const backendExample = read("apps/backend/.env.example");
    const composeExamplePath = join(
      repositoryRoot,
      "docker-compose.env.example",
    );

    expect(backendExample).toMatch(/^PORT=3000$/m);
    expect(backendExample).not.toMatch(/^APP_PORT=/m);
    expect(existsSync(composeExamplePath)).toBe(true);

    const composeExample = readFileSync(composeExamplePath, "utf8");
    for (const name of [
      "APP_PORT",
      "DATABASE_USER",
      "DATABASE_PASSWORD",
      "DATABASE_NAME",
      "DATABASE_PORT",
    ]) {
      expect(composeExample).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it("documents every known launch topology and its env migration path", () => {
    const rootReadme = read("README.md");
    const cloudRun = read("docs/useful/CLOUD_RUN_DEPLOY.md");

    expect(rootReadme).toContain("apps/backend/.env.local");
    expect(rootReadme).toContain("apps/backend/.env");
    expect(rootReadme).toContain("docker compose --env-file");
    expect(rootReadme).toContain("root `.env`");
    expect(rootReadme).toContain("pnpm dev:backend");
    expect(rootReadme).toContain("pnpm --filter backend start");
    expect(rootReadme).toContain("pnpm --filter backend start:dev");
    expect(rootReadme).toContain("pnpm --filter backend start:prod");
    expect(rootReadme).toContain("Docker");
    expect(rootReadme).toContain("tests and staged runtime");
    expect(cloudRun).toContain("process environment");
  });
});
