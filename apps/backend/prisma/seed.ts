import { PrismaClient } from "../src/infrastructure/prisma/generated-client";
import {
  PREFERENCE_CATALOG,
  type PreferenceDefinition,
} from "../src/config/preferences-catalog-data";
import { buildPrismaClientOptions } from "../src/infrastructure/prisma/prisma-client-options";
import { PostgresCatalogStorage } from "../src/infrastructure/storage/postgres/postgres-catalog-storage";
import { seedCatalog } from "../src/domains/shared/storage/seed-catalog";

const prisma = new PrismaClient(
  buildPrismaClientOptions({ databaseUrl: process.env.DATABASE_URL ?? "" }),
);

/** PostgreSQL operational assembly; the catalog loop depends only on CatalogStorage. */
export function seedPreferenceDefinitions(
  client: Pick<PrismaClient, "preferenceDefinition"> = prisma,
  catalog: Readonly<Record<string, PreferenceDefinition>> = PREFERENCE_CATALOG,
) {
  return seedCatalog(new PostgresCatalogStorage(client), catalog);
}

async function main() {
  console.log("Seeding database...");
  await seedPreferenceDefinitions();
  console.log("Seeding completed.");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("Error seeding database:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
