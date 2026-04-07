import {
  ApiKeyMcpClientKey,
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

  // Build slug → definitionId map for GLOBAL definitions
  const globalDefs = await prisma.preferenceDefinition.findMany({
    where: { namespace: 'GLOBAL', archivedAt: null },
    select: { id: true, slug: true },
  });
  const defIdBySlug = new Map(globalDefs.map((d) => [d.slug, d.id]));

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

      const definitionId = defIdBySlug.get(mapping.slug);
      if (!definitionId) {
        console.warn(`  [seed] No GLOBAL definition found for slug "${mapping.slug}", skipping`);
        continue;
      }

      const confidence = mapping.confidence(coreData);
      const contextKey = 'GLOBAL';

      // Use findFirst + create/update pattern
      const existing = await prisma.preference.findFirst({
        where: {
          userId: user.userId,
          contextKey,
          definitionId,
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
            contextKey,
            definitionId,
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

// ─── Schema namespace constants ───

const SCHEMA_NS = {
  GLOBAL: 'GLOBAL',
  HEALTH: 'health',
  EDUCATION: 'education_k16',
} as const;

// ─── Health catalog types ───

interface HealthCatalogEntry {
  id: string;
  slug: string;
  namespace: string;
  displayName: string | null;
  ownerUserId: string | null;
  description: string;
  valueType: string;
  scope: string;
  options: string[] | null;
  isSensitive: boolean;
  isCore: boolean;
  category: string;
}

interface HealthPatient {
  namespace: string;
  profile: {
    identification: {
      name: string;
      age: number;
      gender: string;
      race_ethnicity: string;
    };
    baseline_summary: string;
    care_preferences: {
      provider_style: string;
      care_setting_preference: string;
      privacy_preference: string;
    };
    communication_needs: {
      language_preference: string[];
      health_literacy_preference: string;
      accessibility_needs: string[];
    };
    vitals_and_measurements: {
      baseline_metrics: {
        height: string;
        weight: string;
        blood_pressure_range: string;
      };
      recent_trends_summary: string;
    };
    behavior_and_lifestyle: {
      sleep: string;
      nutrition_preferences: string;
      activity_preferences: string;
      stress_management_preferences: string;
    };
    [key: string]: unknown;
  };
}

// ─── Education catalog types ───

interface EducationCatalogEntry {
  id: string;
  slug: string;
  namespace: string;
  displayName: string | null;
  ownerUserId: string | null;
  description: string;
  valueType: string;
  scope: string;
  options: string[] | null;
  isSensitive: boolean;
  isCore: boolean;
  category: string;
}

interface EducationStudent {
  namespace: string;
  student_profile: {
    preferred_name: string;
    age: number;
    gender: string;
    race_ethnicity: string;
    current_level: string;
    institutions: {
      current_school: string;
      past_schools: string[];
    };
    identity_at_school: string;
    languages_at_school: string[];
    interests_and_extracurriculars: string[];
    learning_preferences: {
      modalities: string[];
      pace: string;
      group_vs_solo: string;
    };
    study_habits: {
      homework_routine: string;
      organization_style: string;
      attention_supports: string[];
    };
    academic_snapshot: {
      strengths: {
        subjects: string[];
        skills: string[];
      };
      areas_for_growth: string[];
    };
    goals_and_plans: {
      short_term_goals: string[];
      long_term_goals: string[];
      milestones: string[];
    };
    [key: string]: unknown;
  };
}

// ─── Seed health definitions ───

async function seedHealthPreferenceDefinitions(): Promise<void> {
  console.log('Seeding health preference definitions...');

  const catalogPath = path.resolve(
    __dirname,
    '../../../synthetic_users/health/health_patient_field_catalog.json',
  );
  const catalog: HealthCatalogEntry[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  for (const entry of catalog) {
    // Downcast types: INTEGER → STRING, ARRAY_OBJECT → ARRAY
    let valueType: string = entry.valueType;
    if (valueType === 'INTEGER') valueType = 'STRING';
    if (valueType === 'ARRAY_OBJECT') valueType = 'ARRAY';

    const existing = await prisma.preferenceDefinition.findFirst({
      where: { namespace: SCHEMA_NS.HEALTH, slug: entry.slug, archivedAt: null },
    });

    if (existing) {
      await prisma.preferenceDefinition.update({
        where: { id: existing.id },
        data: {
          description: entry.description,
          valueType: VALUE_TYPE_MAP[valueType.toLowerCase()] ?? PreferenceValueType.STRING,
          scope: SCOPE_MAP[entry.scope.toLowerCase()] ?? PreferenceScope.GLOBAL,
          options: entry.options ?? null,
          isSensitive: entry.isSensitive ?? false,
          isCore: true,
        },
      });
    } else {
      await prisma.preferenceDefinition.create({
        data: {
          id: entry.id,
          namespace: SCHEMA_NS.HEALTH,
          slug: entry.slug,
          displayName: entry.displayName ?? null,
          ownerUserId: null,
          description: entry.description,
          valueType: VALUE_TYPE_MAP[valueType.toLowerCase()] ?? PreferenceValueType.STRING,
          scope: SCOPE_MAP[entry.scope.toLowerCase()] ?? PreferenceScope.GLOBAL,
          options: entry.options ?? null,
          isSensitive: entry.isSensitive ?? false,
          isCore: true,
        },
      });
    }
  }

  console.log(`Seeded ${catalog.length} health preference definitions`);
}

// ─── Seed education definitions ───

async function seedEducationPreferenceDefinitions(): Promise<void> {
  console.log('Seeding education preference definitions...');

  const catalogPath = path.resolve(
    __dirname,
    '../../../synthetic_users/education/education_k16_field_catalog.json',
  );
  const catalog: EducationCatalogEntry[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

  for (const entry of catalog) {
    // Downcast types: INTEGER → STRING, ARRAY_OBJECT → ARRAY
    let valueType: string = entry.valueType;
    if (valueType === 'INTEGER') valueType = 'STRING';
    if (valueType === 'ARRAY_OBJECT') valueType = 'ARRAY';

    const existing = await prisma.preferenceDefinition.findFirst({
      where: { namespace: SCHEMA_NS.EDUCATION, slug: entry.slug, archivedAt: null },
    });

    if (existing) {
      await prisma.preferenceDefinition.update({
        where: { id: existing.id },
        data: {
          description: entry.description,
          valueType: VALUE_TYPE_MAP[valueType.toLowerCase()] ?? PreferenceValueType.STRING,
          scope: SCOPE_MAP[entry.scope.toLowerCase()] ?? PreferenceScope.GLOBAL,
          options: entry.options ?? null,
          isSensitive: entry.isSensitive ?? false,
          isCore: true,
        },
      });
    } else {
      await prisma.preferenceDefinition.create({
        data: {
          id: entry.id,
          namespace: SCHEMA_NS.EDUCATION,
          slug: entry.slug,
          displayName: entry.displayName ?? null,
          ownerUserId: null,
          description: entry.description,
          valueType: VALUE_TYPE_MAP[valueType.toLowerCase()] ?? PreferenceValueType.STRING,
          scope: SCOPE_MAP[entry.scope.toLowerCase()] ?? PreferenceScope.GLOBAL,
          options: entry.options ?? null,
          isSensitive: entry.isSensitive ?? false,
          isCore: true,
        },
      });
    }
  }

  console.log(`Seeded ${catalog.length} education preference definitions`);
}

// ─── Health user seed ───

interface HealthPreferenceMapping {
  slug: string;
  extract: (p: HealthPatient) => unknown | null;
  confidence: (p: HealthPatient) => number;
}

const HEALTH_PATH_MAPPINGS: HealthPreferenceMapping[] = [
  { slug: 'identification.name',               extract: (p) => p.profile.identification.name,                          confidence: () => 1.0 },
  { slug: 'identification.age',                extract: (p) => String(p.profile.identification.age),                   confidence: () => 1.0 },
  { slug: 'identification.gender',             extract: (p) => p.profile.identification.gender,                        confidence: () => 1.0 },
  { slug: 'profile.baseline_summary',          extract: (p) => p.profile.baseline_summary,                             confidence: () => 0.9 },
  { slug: 'care_preferences.provider_style',   extract: (p) => p.profile.care_preferences.provider_style,             confidence: () => 0.9 },
  { slug: 'care_preferences.care_setting_preference', extract: (p) => p.profile.care_preferences.care_setting_preference, confidence: () => 0.9 },
  { slug: 'communication_needs.language_preference',  extract: (p) => p.profile.communication_needs.language_preference,  confidence: () => 1.0 },
  { slug: 'vitals_and_measurements.baseline_metrics.height', extract: (p) => p.profile.vitals_and_measurements.baseline_metrics.height, confidence: () => 0.9 },
  { slug: 'vitals_and_measurements.baseline_metrics.weight', extract: (p) => p.profile.vitals_and_measurements.baseline_metrics.weight, confidence: () => 0.9 },
  { slug: 'behavior_and_lifestyle.activity_preferences',     extract: (p) => p.profile.behavior_and_lifestyle.activity_preferences,    confidence: () => 0.85 },
  { slug: 'behavior_and_lifestyle.nutrition_preferences',    extract: (p) => p.profile.behavior_and_lifestyle.nutrition_preferences,   confidence: () => 0.85 },
  { slug: 'communication_needs.health_literacy_preference',  extract: (p) => p.profile.communication_needs.health_literacy_preference, confidence: () => 0.9 },
];

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

async function seedHealthUsers(): Promise<User[]> {
  const patientsPath = path.resolve(
    __dirname,
    '../../../synthetic_users/health/synthetic_patients.jsonl',
  );
  const patients: HealthPatient[] = JSON.parse(fs.readFileSync(patientsPath, 'utf-8'));
  console.log(`\nFound ${patients.length} health patients to seed`);

  // Build slug → definitionId map for health namespace
  const healthDefs = await prisma.preferenceDefinition.findMany({
    where: { namespace: SCHEMA_NS.HEALTH, archivedAt: null },
    select: { id: true, slug: true },
  });
  const defIdBySlug = new Map(healthDefs.map((d) => [d.slug, d.id]));

  const createdUsers: User[] = [];
  const importedAt = new Date().toISOString();

  for (let i = 0; i < patients.length; i++) {
    const patient = patients[i];
    const name = patient.profile.identification.name;
    const spaceIndex = name.indexOf(' ');
    const firstName = spaceIndex > 0 ? name.substring(0, spaceIndex) : name;
    const lastName = spaceIndex > 0 ? name.substring(spaceIndex + 1) : `patient_${i}`;
    const email = `${slugifyName(name)}_${i}@health.workshop.dev`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { firstName, lastName, schemaNamespace: SCHEMA_NS.HEALTH },
      create: { email, firstName, lastName, schemaNamespace: SCHEMA_NS.HEALTH },
    });
    createdUsers.push(user);

    let prefCount = 0;
    for (const mapping of HEALTH_PATH_MAPPINGS) {
      let value: unknown;
      try {
        value = mapping.extract(patient);
      } catch {
        continue;
      }
      if (value == null) continue;

      const definitionId = defIdBySlug.get(mapping.slug);
      if (!definitionId) {
        console.warn(`  [seed] No health definition found for slug "${mapping.slug}", skipping`);
        continue;
      }

      const confidence = mapping.confidence(patient);
      const contextKey = 'GLOBAL';

      const existing = await prisma.preference.findFirst({
        where: { userId: user.userId, contextKey, definitionId, status: PreferenceStatus.ACTIVE },
      });

      if (existing) {
        await prisma.preference.update({
          where: { id: existing.id },
          data: { value: value as any, confidence, sourceType: SourceType.IMPORTED, evidence: { source: 'synthetic_health_patient', importedAt } },
        });
      } else {
        await prisma.preference.create({
          data: {
            userId: user.userId,
            locationId: null,
            contextKey,
            definitionId,
            value: value as any,
            status: PreferenceStatus.ACTIVE,
            sourceType: SourceType.IMPORTED,
            confidence,
            evidence: { source: 'synthetic_health_patient', importedAt },
          },
        });
      }
      prefCount++;
    }

    console.log(`  ${user.firstName} ${user.lastName} (${user.email}) - ${prefCount} preferences`);
  }

  return createdUsers;
}

// ─── Education user seed ───

interface EducationPreferenceMapping {
  slug: string;
  extract: (s: EducationStudent) => unknown | null;
  confidence: (s: EducationStudent) => number;
}

const EDUCATION_PATH_MAPPINGS: EducationPreferenceMapping[] = [
  { slug: 'profile.preferred_name',           extract: (s) => s.student_profile.preferred_name,                          confidence: () => 1.0 },
  { slug: 'demographics.age',                 extract: (s) => String(s.student_profile.age),                              confidence: () => 1.0 },
  { slug: 'demographics.gender',              extract: (s) => s.student_profile.gender,                                   confidence: () => 1.0 },
  { slug: 'education.current_level',          extract: (s) => s.student_profile.current_level,                            confidence: () => 1.0 },
  { slug: 'institutions.current_school',      extract: (s) => s.student_profile.institutions.current_school,              confidence: () => 1.0 },
  { slug: 'identity.identity_at_school',      extract: (s) => s.student_profile.identity_at_school,                       confidence: () => 0.9 },
  { slug: 'learning_preferences.modalities',  extract: (s) => s.student_profile.learning_preferences.modalities,          confidence: () => 0.9 },
  { slug: 'learning_preferences.pace',        extract: (s) => s.student_profile.learning_preferences.pace,                confidence: () => 0.9 },
  { slug: 'study_habits.homework_routine',    extract: (s) => s.student_profile.study_habits.homework_routine,            confidence: () => 0.85 },
  { slug: 'academic_snapshot.strengths.subjects', extract: (s) => s.student_profile.academic_snapshot.strengths.subjects, confidence: () => 0.9 },
  { slug: 'goals_and_plans.short_term_goals', extract: (s) => s.student_profile.goals_and_plans.short_term_goals,         confidence: () => 0.9 },
  { slug: 'interests.interests_and_extracurriculars', extract: (s) => s.student_profile.interests_and_extracurriculars,   confidence: () => 0.9 },
];

async function seedEducationUsers(): Promise<User[]> {
  const studentsPath = path.resolve(
    __dirname,
    '../../../synthetic_users/education/synthetic_student.jsonl',
  );
  const students: EducationStudent[] = JSON.parse(fs.readFileSync(studentsPath, 'utf-8'));
  console.log(`\nFound ${students.length} education students to seed`);

  // Build slug → definitionId map for education namespace
  const eduDefs = await prisma.preferenceDefinition.findMany({
    where: { namespace: SCHEMA_NS.EDUCATION, archivedAt: null },
    select: { id: true, slug: true },
  });
  const defIdBySlug = new Map(eduDefs.map((d) => [d.slug, d.id]));

  const createdUsers: User[] = [];
  const importedAt = new Date().toISOString();

  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    const name = student.student_profile.preferred_name;
    const firstName = name;
    const lastName = `student_${i}`;
    // Always use index to guarantee uniqueness (handles duplicate names like Sofia at 6 and 8)
    const email = `${slugifyName(name)}_${i}@education.workshop.dev`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { firstName, lastName, schemaNamespace: SCHEMA_NS.EDUCATION },
      create: { email, firstName, lastName, schemaNamespace: SCHEMA_NS.EDUCATION },
    });
    createdUsers.push(user);

    let prefCount = 0;
    for (const mapping of EDUCATION_PATH_MAPPINGS) {
      let value: unknown;
      try {
        value = mapping.extract(student);
      } catch {
        continue;
      }
      if (value == null) continue;

      const definitionId = defIdBySlug.get(mapping.slug);
      if (!definitionId) {
        console.warn(`  [seed] No education definition found for slug "${mapping.slug}", skipping`);
        continue;
      }

      const confidence = mapping.confidence(student);
      const contextKey = 'GLOBAL';

      const existing = await prisma.preference.findFirst({
        where: { userId: user.userId, contextKey, definitionId, status: PreferenceStatus.ACTIVE },
      });

      if (existing) {
        await prisma.preference.update({
          where: { id: existing.id },
          data: { value: value as any, confidence, sourceType: SourceType.IMPORTED, evidence: { source: 'synthetic_education_student', importedAt } },
        });
      } else {
        await prisma.preference.create({
          data: {
            userId: user.userId,
            locationId: null,
            contextKey,
            definitionId,
            value: value as any,
            status: PreferenceStatus.ACTIVE,
            sourceType: SourceType.IMPORTED,
            confidence,
            evidence: { source: 'synthetic_education_student', importedAt },
          },
        });
      }
      prefCount++;
    }

    console.log(`  ${user.firstName} (${user.email}) - ${prefCount} preferences`);
  }

  return createdUsers;
}

// ─── Workshop API keys ───

async function createWorkshopGroups(
  usermemUsers: User[],
  healthUsers: User[],
  eduUsers: User[],
) {
  console.log('\nCreating workshop groups...');

  const categories = [
    { key: 'usermem',   users: usermemUsers },
    { key: 'health',    users: healthUsers  },
    { key: 'education', users: eduUsers     },
  ];

  console.log('\n' + '='.repeat(60));
  console.log('WORKSHOP CREDENTIALS');
  console.log('='.repeat(60));

  for (const grp of ['a', 'b']) {
    for (const cat of categories) {
      const groupName = `grp-${grp}-${cat.key}`;
      const apiKey = generateApiKey(groupName);
      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          keyHash: hashKey(apiKey),
          groupName,
          mcpClientKey: ApiKeyMcpClientKey.CLAUDE,
        },
      });

      for (const user of cat.users) {
        await prisma.apiKeyUser.create({
          data: { apiKeyId: apiKeyRecord.id, userId: user.userId },
        });
      }

      console.log(`\n--- ${groupName} ---`);
      console.log(`API Key: ${apiKey}`);
      console.log(`Users (${cat.users.length}):`);
      for (const user of cat.users) {
        console.log(`  ${user.firstName} ${user.lastName} (${user.email}) - ID: ${user.userId}`);
      }
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
  await seedPreferenceDefinitions();            // GLOBAL (~43 defs)
  await seedHealthPreferenceDefinitions();      // health (46 defs)
  await seedEducationPreferenceDefinitions();   // education_k16 (39 defs)

  // 2. Load and seed synthetic users with their preferences
  const usermemUsers = await seedSyntheticUsers();
  const healthUsers  = await seedHealthUsers();
  const eduUsers     = await seedEducationUsers();

  // 3. Create 6 workshop API keys (grp-a/b × usermem/health/education)
  await createWorkshopGroups(usermemUsers, healthUsers, eduUsers);
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
