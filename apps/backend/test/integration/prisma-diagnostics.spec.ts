import { PrismaClient } from "../../src/infrastructure/prisma/generated-client";
import { buildPrismaClientOptions } from "../../src/infrastructure/prisma/prisma-client-options";

describe("Prisma diagnostics", () => {
  it("does not emit a rejected request error through engine stdout logging", async () => {
    const canary = "prisma-request-error-canary";
    const writes: unknown[][] = [];
    const spies = ["error", "info", "log", "warn"].map((method) =>
      jest
        .spyOn(console, method as "error")
        .mockImplementation((...values: unknown[]) => {
          writes.push(values);
        }),
    );
    const prisma = new PrismaClient(
      buildPrismaClientOptions({
        databaseUrl: process.env.DATABASE_URL as string,
      }),
    );

    try {
      await expect(
        prisma.$executeRawUnsafe(
          `DO $$ BEGIN RAISE EXCEPTION '${canary}'; END $$`,
        ),
      ).rejects.toBeDefined();
      expect(JSON.stringify(writes)).not.toContain(canary);
    } finally {
      await prisma.$disconnect();
      for (const spy of spies) spy.mockRestore();
    }
  });
});
