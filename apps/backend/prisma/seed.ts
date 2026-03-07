import {
  PrismaClient,
  PreferenceValueType,
  PreferenceScope,
  PreferenceStatus,
  SourceType,
} from '../src/infrastructure/prisma/generated-client';
import type { User } from '../src/infrastructure/prisma/prisma-models';
import {
  PREFERENCE_CATALOG,
  PreferenceDefinition,
} from '../src/config/preferences.catalog';
import { createHash, randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { buildPrismaClientOptions } from '../src/infrastructure/prisma/prisma-client-options';

const prisma = new PrismaClient(buildPrismaClientOptions());

// ─── Helpers ───

function generateApiKey(prefix: string): string {
  const key = `${prefix}-${randomBytes(16).toString('hex')}`;
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error(`Invalid key format: ${key}`);
  }
  return key;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

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

// ─── Core.json types ───

interface MemoryNode<T> {
  value: T;
  confidence: number;
  persistency: string;
  evidence_ids: string[];
  updated_at: string;
  created_at: string;
}

interface CoreMemory {
  profile: {
    summary: string;
    confidence: number;
  };
  identity: {
    name: MemoryNode<string>;
    age: MemoryNode<number>;
    date_of_birth: MemoryNode<string> | null;
    location: MemoryNode<string>;
    nationality: MemoryNode<string>;
    languages: MemoryNode<string[]>;
    visa_status: MemoryNode<string> | null;
  };
  professional: {
    current_role: MemoryNode<string>;
    current_company: MemoryNode<string>;
    industry: MemoryNode<string>;
    experience_years: MemoryNode<number>;
    education: MemoryNode<string>;
    skills: MemoryNode<string[]>;
    expertise_areas: MemoryNode<string[]>;
    work_style: MemoryNode<string>;
  };
  projects: {
    current: MemoryNode<{ name: string; description: string; stage: string }>[];
    past: string[];
  };
  goals: {
    short_term: MemoryNode<string[]>;
    long_term: MemoryNode<string[]>;
    career: MemoryNode<string>;
    personal: MemoryNode<string>;
  };
  preferences: {
    tools: MemoryNode<string[]>;
    technologies: MemoryNode<string[]>;
    work_environment: MemoryNode<string>;
    communication_style: MemoryNode<string>;
  };
  values: {
    core_beliefs: MemoryNode<string[]>;
    principles: MemoryNode<string[]>;
    priorities: MemoryNode<string[]>;
  };
  relationships: {
    family: MemoryNode<string>;
    professional_network: MemoryNode<string[]>;
    mentors: MemoryNode<string[]> | null;
  };
  concerns: {
    current: MemoryNode<string[]>;
    recurring: MemoryNode<string[]>;
  };
}

// ─── Preference mapping ───

interface PreferenceMapping {
  slug: string;
  extract: (core: CoreMemory) => unknown | null;
  confidence: (core: CoreMemory) => number | null;
}

const PREFERENCE_MAPPINGS: PreferenceMapping[] = [
  // Profile
  {
    slug: 'profile.bio',
    extract: (c) => c.profile?.summary ?? null,
    confidence: (c) => c.profile?.confidence ?? null,
  },
  // Identity
  {
    slug: 'identity.age',
    extract: (c) => c.identity?.age != null ? String(c.identity.age.value) : null,
    confidence: (c) => c.identity?.age?.confidence ?? null,
  },
  {
    slug: 'identity.date_of_birth',
    extract: (c) => c.identity?.date_of_birth?.value ?? null,
    confidence: (c) => c.identity?.date_of_birth?.confidence ?? null,
  },
  {
    slug: 'identity.location',
    extract: (c) => c.identity?.location?.value ?? null,
    confidence: (c) => c.identity?.location?.confidence ?? null,
  },
  {
    slug: 'identity.nationality',
    extract: (c) => c.identity?.nationality?.value ?? null,
    confidence: (c) => c.identity?.nationality?.confidence ?? null,
  },
  {
    slug: 'identity.languages',
    extract: (c) => c.identity?.languages?.value ?? null,
    confidence: (c) => c.identity?.languages?.confidence ?? null,
  },
  {
    slug: 'identity.visa_status',
    extract: (c) => c.identity?.visa_status?.value ?? null,
    confidence: (c) => c.identity?.visa_status?.confidence ?? null,
  },
  // Professional
  {
    slug: 'professional.current_role',
    extract: (c) => c.professional?.current_role?.value ?? null,
    confidence: (c) => c.professional?.current_role?.confidence ?? null,
  },
  {
    slug: 'professional.current_company',
    extract: (c) => c.professional?.current_company?.value ?? null,
    confidence: (c) => c.professional?.current_company?.confidence ?? null,
  },
  {
    slug: 'professional.industry',
    extract: (c) => c.professional?.industry?.value ?? null,
    confidence: (c) => c.professional?.industry?.confidence ?? null,
  },
  {
    slug: 'professional.experience_years',
    extract: (c) => c.professional?.experience_years != null ? String(c.professional.experience_years.value) : null,
    confidence: (c) => c.professional?.experience_years?.confidence ?? null,
  },
  {
    slug: 'professional.education',
    extract: (c) => c.professional?.education?.value ?? null,
    confidence: (c) => c.professional?.education?.confidence ?? null,
  },
  {
    slug: 'professional.skills',
    extract: (c) => c.professional?.skills?.value ?? null,
    confidence: (c) => c.professional?.skills?.confidence ?? null,
  },
  {
    slug: 'professional.expertise_areas',
    extract: (c) => c.professional?.expertise_areas?.value ?? null,
    confidence: (c) => c.professional?.expertise_areas?.confidence ?? null,
  },
  {
    slug: 'professional.work_style',
    extract: (c) => c.professional?.work_style?.value ?? null,
    confidence: (c) => c.professional?.work_style?.confidence ?? null,
  },
  // Projects
  {
    slug: 'projects.current',
    extract: (c) => c.projects?.current?.map((p) => p.value) ?? null,
    confidence: (c) =>
      c.projects?.current?.length > 0 ? c.projects.current[0].confidence : null,
  },
  {
    slug: 'projects.past',
    extract: (c) => c.projects?.past ?? null,
    confidence: () => null,
  },
  // Goals
  {
    slug: 'goals.short_term',
    extract: (c) => c.goals?.short_term?.value ?? null,
    confidence: (c) => c.goals?.short_term?.confidence ?? null,
  },
  {
    slug: 'goals.long_term',
    extract: (c) => c.goals?.long_term?.value ?? null,
    confidence: (c) => c.goals?.long_term?.confidence ?? null,
  },
  {
    slug: 'goals.career',
    extract: (c) => c.goals?.career?.value ?? null,
    confidence: (c) => c.goals?.career?.confidence ?? null,
  },
  {
    slug: 'goals.personal',
    extract: (c) => c.goals?.personal?.value ?? null,
    confidence: (c) => c.goals?.personal?.confidence ?? null,
  },
  // Work preferences
  {
    slug: 'work.preferred_tools',
    extract: (c) => c.preferences?.tools?.value ?? null,
    confidence: (c) => c.preferences?.tools?.confidence ?? null,
  },
  {
    slug: 'work.preferred_technologies',
    extract: (c) => c.preferences?.technologies?.value ?? null,
    confidence: (c) => c.preferences?.technologies?.confidence ?? null,
  },
  {
    slug: 'work.environment',
    extract: (c) => c.preferences?.work_environment?.value ?? null,
    confidence: (c) => c.preferences?.work_environment?.confidence ?? null,
  },
  // Communication
  {
    slug: 'communication.style',
    extract: (c) => c.preferences?.communication_style?.value ?? null,
    confidence: (c) => c.preferences?.communication_style?.confidence ?? null,
  },
  // Values
  {
    slug: 'values.core_beliefs',
    extract: (c) => c.values?.core_beliefs?.value ?? null,
    confidence: (c) => c.values?.core_beliefs?.confidence ?? null,
  },
  {
    slug: 'values.principles',
    extract: (c) => c.values?.principles?.value ?? null,
    confidence: (c) => c.values?.principles?.confidence ?? null,
  },
  {
    slug: 'values.priorities',
    extract: (c) => c.values?.priorities?.value ?? null,
    confidence: (c) => c.values?.priorities?.confidence ?? null,
  },
  // Relationships
  {
    slug: 'relationships.family',
    extract: (c) => c.relationships?.family?.value ?? null,
    confidence: (c) => c.relationships?.family?.confidence ?? null,
  },
  {
    slug: 'relationships.professional_network',
    extract: (c) => c.relationships?.professional_network?.value ?? null,
    confidence: (c) => c.relationships?.professional_network?.confidence ?? null,
  },
  {
    slug: 'relationships.mentors',
    extract: (c) => c.relationships?.mentors?.value ?? null,
    confidence: (c) => c.relationships?.mentors?.confidence ?? null,
  },
  // Concerns
  {
    slug: 'concerns.current',
    extract: (c) => c.concerns?.current?.value ?? null,
    confidence: (c) => c.concerns?.current?.confidence ?? null,
  },
  {
    slug: 'concerns.recurring',
    extract: (c) => c.concerns?.recurring?.value ?? null,
    confidence: (c) => c.concerns?.recurring?.confidence ?? null,
  },
];

// ─── Seed functions ───

async function seedPreferenceDefinitions() {
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

function loadSyntheticUsers(): Array<{ dirName: string; coreData: CoreMemory }> {
  const basePath = path.resolve(
    __dirname,
    '../../../synthetic_users/usermem/synthetic_users_20',
  );

  if (!fs.existsSync(basePath)) {
    console.warn(`Synthetic users directory not found: ${basePath}`);
    return [];
  }

  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  const users: Array<{ dirName: string; coreData: CoreMemory }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const corePath = path.join(basePath, entry.name, 'memory', 'core.json');
    if (!fs.existsSync(corePath)) continue;

    const raw = fs.readFileSync(corePath, 'utf-8');
    users.push({ dirName: entry.name, coreData: JSON.parse(raw) });
  }

  return users.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

function extractUserFields(dirName: string, core: CoreMemory) {
  const fullName = core.identity.name.value;
  const spaceIndex = fullName.indexOf(' ');
  return {
    email: `${dirName}@workshop.dev`,
    firstName: spaceIndex > 0 ? fullName.substring(0, spaceIndex) : fullName,
    lastName: spaceIndex > 0 ? fullName.substring(spaceIndex + 1) : dirName,
  };
}

async function seedSyntheticUsers(): Promise<User[]> {
  const syntheticUsers = loadSyntheticUsers();
  console.log(`\nFound ${syntheticUsers.length} synthetic users to seed`);

  const createdUsers: User[] = [];
  const importedAt = new Date().toISOString();

  for (const { dirName, coreData } of syntheticUsers) {
    const fields = extractUserFields(dirName, coreData);
    const user = await prisma.user.upsert({
      where: { email: fields.email },
      update: { firstName: fields.firstName, lastName: fields.lastName },
      create: fields,
    });
    createdUsers.push(user);

    let prefCount = 0;
    for (const mapping of PREFERENCE_MAPPINGS) {
      const value = mapping.extract(coreData);
      if (value == null) continue;

      const confidence = mapping.confidence(coreData);

      // Use findFirst + create/update pattern for null locationId
      const existing = await prisma.preference.findFirst({
        where: {
          userId: user.userId,
          locationId: null,
          slug: mapping.slug,
          status: PreferenceStatus.ACTIVE,
        },
      });

      if (existing) {
        await prisma.preference.update({
          where: { id: existing.id },
          data: {
            value: value as any,
            confidence,
            sourceType: SourceType.IMPORTED,
            evidence: {
              source: 'synthetic_core_memory',
              importedAt,
            },
          },
        });
      } else {
        await prisma.preference.create({
          data: {
            userId: user.userId,
            locationId: null,
            slug: mapping.slug,
            value: value as any,
            status: PreferenceStatus.ACTIVE,
            sourceType: SourceType.IMPORTED,
            confidence,
            evidence: {
              source: 'synthetic_core_memory',
              importedAt,
            },
          },
        });
      }
      prefCount++;
    }

    console.log(
      `  ${user.firstName} ${user.lastName} (${user.email}) - ${prefCount} preferences`,
    );
  }

  return createdUsers;
}

async function createWorkshopGroups(users: User[]) {
  console.log('\nCreating workshop groups...');

  const groups = [
    { prefix: 'grp-a', name: 'Group A' },
    { prefix: 'grp-b', name: 'Group B' },
  ];

  console.log('\n' + '='.repeat(60));
  console.log('WORKSHOP CREDENTIALS');
  console.log('='.repeat(60));

  for (const group of groups) {
    const apiKey = generateApiKey(group.prefix);
    const apiKeyRecord = await prisma.apiKey.create({
      data: { keyHash: hashKey(apiKey), groupName: group.name },
    });

    // Add ALL users to this group
    for (const user of users) {
      await prisma.apiKeyUser.upsert({
        where: {
          apiKeyId_userId: {
            apiKeyId: apiKeyRecord.id,
            userId: user.userId,
          },
        },
        update: {},
        create: { apiKeyId: apiKeyRecord.id, userId: user.userId },
      });
    }

    console.log(`\n--- ${group.name} ---`);
    console.log(`API Key: ${apiKey}`);
    console.log(`Users (${users.length}):`);
    for (const user of users) {
      console.log(
        `  ${user.firstName} ${user.lastName} (${user.email}) - ID: ${user.userId}`,
      );
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Save these keys! They cannot be retrieved after this.');
  console.log('='.repeat(60));
}

// ─── Main ───

async function main() {
  console.log('Seeding workshop database...\n');

  // 1. Seed preference definitions (must come before preference data)
  await seedPreferenceDefinitions();

  // 2. Load and seed synthetic users with their preferences
  const users = await seedSyntheticUsers();

  // 3. Create workshop groups (all users in both groups)
  await createWorkshopGroups(users);
}

main()
  .catch((e) => {
    console.error("Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
