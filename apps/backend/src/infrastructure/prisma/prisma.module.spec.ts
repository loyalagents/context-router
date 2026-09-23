import { ConfigService } from "@nestjs/config";
import type { PoolConfig } from "pg";

import { PrismaModule } from "./prisma.module";
import { PRISMA_SERVICE_CONFIGURATION, PrismaService } from "./prisma.service";

type FactoryProvider = {
  provide: unknown;
  inject?: unknown[];
  useFactory?: (...args: never[]) => unknown;
};

function factoryProvider(
  providers: unknown[] | undefined,
  token: unknown,
): FactoryProvider {
  const provider = providers?.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as FactoryProvider).provide === token,
  ) as FactoryProvider | undefined;
  if (!provider) throw new Error("missing provider");
  return provider;
}

describe("PrismaModule composition registration", () => {
  it("keeps the bare feature-module import provider-free", () => {
    expect(Reflect.getMetadata("providers", PrismaModule) ?? []).toEqual([]);
  });

  it("registers hosted options only through the hosted composition root", () => {
    const module = PrismaModule.registerHosted();
    const configuration = factoryProvider(
      module.providers,
      PRISMA_SERVICE_CONFIGURATION,
    );

    expect(module.global).toBe(true);
    expect(configuration.inject).toEqual([ConfigService]);
    expect(module.providers).toContain(PrismaService);
    expect(module.exports).toEqual([PrismaService]);
  });

  it("registers the reviewed local pool config without ConfigService or a connection string", () => {
    const poolConfig: PoolConfig = {
      host: "127.0.0.1",
      port: 55432,
      database: "context_router",
      user: "local_user",
      password: "database-password-canary",
      ssl: { ca: "certificate-canary", rejectUnauthorized: true },
    };
    const module = PrismaModule.registerLocal(poolConfig);
    const configuration = factoryProvider(
      module.providers,
      PRISMA_SERVICE_CONFIGURATION,
    );

    expect(module.global).toBe(true);
    expect(configuration.inject ?? []).toEqual([]);
    expect(configuration.useFactory).toEqual(expect.any(Function));
    expect(JSON.stringify(module)).not.toContain("connectionString");
    expect(module.providers).toContain(PrismaService);
    expect(module.exports).toEqual([PrismaService]);
  });
});
