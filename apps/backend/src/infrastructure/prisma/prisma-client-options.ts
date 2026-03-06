import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { Prisma } from "./generated-client";

type PrismaLogLevel = "query" | "info" | "warn" | "error";

type BuildPrismaClientOptionsInput = {
  databaseUrl?: string;
  log?: PrismaLogLevel[];
};

export function buildPrismaClientOptions(
  options: BuildPrismaClientOptionsInput = {},
): Prisma.PrismaClientOptions {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  return {
    adapter: new PrismaPg(new Pool({ connectionString: databaseUrl })),
    ...(options.log ? { log: options.log } : {}),
  };
}
