import {
  PrismaClient,
  PreferenceValueType,
  PreferenceScope,
} from "../src/infrastructure/prisma/generated-client";
import {
  PREFERENCE_CATALOG,
  PreferenceDefinition,
} from "../src/config/preferences.catalog";
import { buildPrismaClientOptions } from "../src/infrastructure/prisma/prisma-client-options";

const prisma = new PrismaClient(buildPrismaClientOptions());

const VALUE_TYPE_MAP: Record<string, PreferenceValueType> = {
  string: PreferenceValueType.STRING,
  boolean: PreferenceValueType.BOOLEAN,
  enum: PreferenceValueType.ENUM,
  array: PreferenceValueType.ARRAY,
};

const SCOPE_MAP: Record<string, PreferenceScope> = {
  global: PreferenceScope.GLOBAL,
  location: PreferenceScope.LOCATION,
};

export async function seedPreferenceDefinitions() {
  console.log("Seeding preference definitions...");

  for (const [slug, def] of Object.entries(PREFERENCE_CATALOG)) {
    const catalogDef = def as PreferenceDefinition;

    const existing = await prisma.preferenceDefinition.findFirst({
      where: { namespace: "GLOBAL", slug, archivedAt: null },
    });

    if (existing) {
      await prisma.preferenceDefinition.update({
        where: { id: existing.id },
        data: {
          displayName: catalogDef.displayName ?? null,
          description: catalogDef.description,
          valueType: VALUE_TYPE_MAP[catalogDef.valueType],
          scope: SCOPE_MAP[catalogDef.scope],
          options: catalogDef.options ?? null,
          isSensitive: catalogDef.isSensitive ?? false,
          isCore: true,
        },
      });
    } else {
      // Warn if any active user defs share this slug (slug collision — allowed, user wins)
      const collidingCount = await prisma.preferenceDefinition.count({
        where: { namespace: { not: "GLOBAL" }, slug, archivedAt: null },
      });
      if (collidingCount > 0) {
        console.warn(
          `[seed] GLOBAL slug "${slug}" collides with ${collidingCount} active user definition(s). Global definition created; user defs take precedence for affected users.`,
        );
      }

      await prisma.preferenceDefinition.create({
        data: {
          namespace: "GLOBAL",
          slug,
          ownerUserId: null,
          displayName: catalogDef.displayName ?? null,
          description: catalogDef.description,
          valueType: VALUE_TYPE_MAP[catalogDef.valueType],
          scope: SCOPE_MAP[catalogDef.scope],
          options: catalogDef.options ?? null,
          isSensitive: catalogDef.isSensitive ?? false,
          isCore: true,
        },
      });
    }
  }

  console.log(
    `Seeded ${Object.keys(PREFERENCE_CATALOG).length} preference definitions`,
  );
}

async function main() {
  console.log("Seeding database...");

  // Seed preference definitions (must come before any preference data)
  await seedPreferenceDefinitions();

  // Create sample users
  const user1 = await prisma.user.upsert({
    where: { email: "john.doe@example.com" },
    update: {},
    create: {
      email: "john.doe@example.com",
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: "jane.smith@example.com" },
    update: {},
    create: {
      email: "jane.smith@example.com",
    },
  });

  console.log("Seeding completed:", { user1, user2 });
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
