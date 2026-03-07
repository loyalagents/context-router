jest.mock("pg", () => ({
  Pool: jest.fn().mockImplementation((config) => ({
    config,
  })),
}));

jest.mock("@prisma/adapter-pg", () => ({
  PrismaPg: jest.fn().mockImplementation((pool, options) => ({
    pool,
    options,
  })),
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { buildPrismaClientOptions } from "./prisma-client-options";

describe("buildPrismaClientOptions", () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.DATABASE_URL;
  });

  it("configures Prisma to dispose an injected pg pool on disconnect", () => {
    buildPrismaClientOptions({
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/context_router",
    });

    expect(Pool).toHaveBeenCalledWith({
      connectionString:
        "postgresql://postgres:postgres@localhost:5432/context_router",
    });
    expect(PrismaPg).toHaveBeenCalledWith(expect.anything(), {
      disposeExternalPool: true,
    });
  });
});
