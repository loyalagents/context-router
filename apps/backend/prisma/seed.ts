import {
  PrismaClient,
  PreferenceValueType,
  PreferenceScope,
} from '@prisma/client';
import {
  PREFERENCE_CATALOG,
  PreferenceDefinition,
} from '../src/config/preferences.catalog';

const prisma = new PrismaClient();

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

async function seedPreferenceDefinitions() {
  console.log('Seeding preference definitions...');

  for (const [slug, def] of Object.entries(PREFERENCE_CATALOG)) {
    const catalogDef = def as PreferenceDefinition;
    await prisma.preferenceDefinition.upsert({
      where: { slug },
      update: {
        description: catalogDef.description,
        valueType: VALUE_TYPE_MAP[catalogDef.valueType],
        scope: SCOPE_MAP[catalogDef.scope],
        options: catalogDef.options ?? null,
        isSensitive: catalogDef.isSensitive ?? false,
        isCore: true,
      },
      create: {
        slug,
        description: catalogDef.description,
        valueType: VALUE_TYPE_MAP[catalogDef.valueType],
        scope: SCOPE_MAP[catalogDef.scope],
        options: catalogDef.options ?? null,
        isSensitive: catalogDef.isSensitive ?? false,
        isCore: true,
      },
    });
  }

  console.log(
    `Seeded ${Object.keys(PREFERENCE_CATALOG).length} preference definitions`,
  );
}

async function main() {
  console.log('Seeding database...');

  // Seed preference definitions (must come before any preference data)
  await seedPreferenceDefinitions();

  // Create sample users
  const user1 = await prisma.user.upsert({
    where: { email: 'john.doe@example.com' },
    update: {},
    create: {
      email: 'john.doe@example.com',
      firstName: 'John',
      lastName: 'Doe',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'jane.smith@example.com' },
    update: {},
    create: {
      email: 'jane.smith@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
    },
  });

  console.log('Seeding completed:', { user1, user2 });
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
