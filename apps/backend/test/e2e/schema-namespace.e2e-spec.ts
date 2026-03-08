/**
 * CP8: Schema Namespace Isolation Tests
 *
 * Verifies that schemaNamespace on User correctly scopes the preference catalog.
 * The global beforeEach (jest.after-env.ts) resets DB + seeds GLOBAL defs.
 * Our local beforeEach seeds health/education defs and creates category users.
 *
 * 1. Health user sees only health namespace definitions
 * 2. Education user sees only education_k16 namespace definitions
 * 3. Regression: GLOBAL user still sees GLOBAL definitions
 * 4. Health user cannot use a GLOBAL slug (setPreference fails)
 */
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';

describe('Schema Namespace Isolation (e2e)', () => {
  let app: INestApplication;
  let setTestUser: (user: TestUser) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  afterAll(async () => {
    await app.close();
  });

  // Local beforeEach runs AFTER the global beforeEach (which resets DB + seeds GLOBAL defs).
  // We add health/education definitions here so each test starts with all 3 namespaces seeded.
  beforeEach(async () => {
    const prisma = getPrismaClient();

    // Seed a few health definitions
    const healthDefs = [
      { slug: 'identification.name',      description: 'Patient name',     valueType: 'STRING' as const },
      { slug: 'identification.age',       description: 'Patient age',      valueType: 'STRING' as const },
      { slug: 'profile.baseline_summary', description: 'Baseline summary', valueType: 'STRING' as const },
    ];
    for (const d of healthDefs) {
      await prisma.preferenceDefinition.create({
        data: { namespace: 'health', slug: d.slug, description: d.description, valueType: d.valueType, scope: 'GLOBAL', isCore: true },
      });
    }

    // Seed a few education_k16 definitions
    const eduDefs = [
      { slug: 'profile.preferred_name',   description: 'Preferred name', valueType: 'STRING' as const },
      { slug: 'demographics.age',         description: 'Student age',    valueType: 'STRING' as const },
      { slug: 'education.current_level',  description: 'Current level',  valueType: 'STRING' as const },
    ];
    for (const d of eduDefs) {
      await prisma.preferenceDefinition.create({
        data: { namespace: 'education_k16', slug: d.slug, description: d.description, valueType: d.valueType, scope: 'GLOBAL', isCore: true },
      });
    }
  });

  const catalogQuery = `
    query {
      preferenceCatalog {
        slug
        namespace
      }
    }
  `;

  it('health user sees only health namespace definitions', async () => {
    const prisma = getPrismaClient();
    const healthUser = await prisma.user.create({
      data: { email: 'health@test.dev', firstName: 'Health', lastName: 'Patient', schemaNamespace: 'health' },
    });
    setTestUser(healthUser as unknown as TestUser);

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: catalogQuery })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    const catalog: Array<{ slug: string; namespace: string }> = response.body.data.preferenceCatalog;
    expect(catalog.length).toBeGreaterThan(0);

    // All system-owned defs must be health namespace
    const nonHealthDefs = catalog.filter(
      (d) => d.namespace !== 'health' && !d.namespace.startsWith('USER:'),
    );
    expect(nonHealthDefs).toEqual([]);

    const slugs = catalog.map((d) => d.slug);
    expect(slugs).toContain('identification.name');

    // Must not contain GLOBAL or education slugs
    expect(slugs).not.toContain('system.response_tone');
    expect(slugs).not.toContain('profile.preferred_name'); // education slug
  });

  it('education user sees only education_k16 namespace definitions', async () => {
    const prisma = getPrismaClient();
    const educationUser = await prisma.user.create({
      data: { email: 'edu@test.dev', firstName: 'Edu', lastName: 'Student', schemaNamespace: 'education_k16' },
    });
    setTestUser(educationUser as unknown as TestUser);

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: catalogQuery })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    const catalog: Array<{ slug: string; namespace: string }> = response.body.data.preferenceCatalog;
    expect(catalog.length).toBeGreaterThan(0);

    // All system-owned defs must be education_k16 namespace
    const nonEduDefs = catalog.filter(
      (d) => d.namespace !== 'education_k16' && !d.namespace.startsWith('USER:'),
    );
    expect(nonEduDefs).toEqual([]);

    const slugs = catalog.map((d) => d.slug);
    expect(slugs).toContain('profile.preferred_name');

    // Must not contain GLOBAL or health slugs
    expect(slugs).not.toContain('system.response_tone');
    expect(slugs).not.toContain('identification.name'); // health slug
  });

  it('regression: GLOBAL user still sees only GLOBAL definitions', async () => {
    const prisma = getPrismaClient();
    const globalUser = await prisma.user.create({
      data: { email: 'global@test.dev', firstName: 'Global', lastName: 'User', schemaNamespace: 'GLOBAL' },
    });
    setTestUser(globalUser as unknown as TestUser);

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: catalogQuery })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    const catalog: Array<{ slug: string; namespace: string }> = response.body.data.preferenceCatalog;
    expect(catalog.length).toBeGreaterThanOrEqual(12);

    // All system-owned defs must be GLOBAL namespace
    const nonGlobalSystemDefs = catalog.filter(
      (d) => !d.namespace.startsWith('USER:') && d.namespace !== 'GLOBAL',
    );
    expect(nonGlobalSystemDefs).toEqual([]);

    const slugs = catalog.map((d) => d.slug);
    expect(slugs).toContain('system.response_tone');
    expect(slugs).toContain('food.dietary_restrictions');

    // Health and education slugs must not appear
    expect(slugs).not.toContain('identification.name');    // health
    expect(slugs).not.toContain('profile.preferred_name'); // education
  });

  it('health user cannot setPreference with a GLOBAL slug', async () => {
    const prisma = getPrismaClient();
    const healthUser = await prisma.user.create({
      data: { email: 'health2@test.dev', firstName: 'Health', lastName: 'Patient2', schemaNamespace: 'health' },
    });
    setTestUser(healthUser as unknown as TestUser);

    const mutation = `
      mutation {
        setPreference(input: { slug: "system.response_tone", value: "casual" }) {
          id
        }
      }
    `;

    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: mutation })
      .expect(200);

    // "system.response_tone" is GLOBAL, not in "health" namespace — must fail
    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].message).toMatch(/Unknown preference slug/);
  });
});
