import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Prisma } from "./generated-client";

type DirectPrismaClientOptions = Extract<
  Prisma.PrismaClientOptions,
  { adapter: unknown }
>;

type BuildPrismaClientOptionsInput = {
  databaseUrl: string;
};

export function buildPrismaClientOptions(
  options: BuildPrismaClientOptionsInput,
): DirectPrismaClientOptions {
  if (!options.databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return {
    adapter: new PrismaPg(new Pool({ connectionString: options.databaseUrl }), {
      disposeExternalPool: true,
    }),
  };
}
