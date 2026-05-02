import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import { PreferenceStatus } from '../../src/infrastructure/prisma/generated-client';

describe('Profile Preferences GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;
  const prisma = getPrismaClient();

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    testUser = await createTestUser();
    setTestUser(testUser);
  });

  afterAll(async () => {
    await app.close();
  });

  const graphqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  const SET_PREFERENCE_MUTATION = `
    mutation SetProfilePreference($input: SetPreferenceInput!) {
      setPreference(input: $input) {
        id
        slug
        value
        status
        sourceType
        locationId
        category
      }
    }
  `;

  const DELETE_PREFERENCE_MUTATION = `
    mutation DeleteProfilePreference($id: ID!) {
      deletePreference(id: $id) {
        id
        slug
      }
    }
  `;

  const ACTIVE_PREFERENCES_QUERY = `
    query ActivePreferences {
      activePreferences {
        id
        slug
        value
      }
    }
  `;

  const RESET_MUTATION = `
    mutation ResetMyMemory($mode: ResetMemoryMode!) {
      resetMyMemory(mode: $mode) {
        mode
        preferencesDeleted
      }
    }
  `;

  it('creates, updates, reads, and deletes profile memory through normal preference mutations', async () => {
    const emptyResponse = await graphqlRequest(ACTIVE_PREFERENCES_QUERY).expect(
      200,
    );
    expect(emptyResponse.body.errors).toBeUndefined();
    expect(
      emptyResponse.body.data.activePreferences.filter((preference: any) =>
        preference.slug.startsWith('profile.'),
      ),
    ).toEqual([]);

    const fullNameResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: { slug: 'profile.full_name', value: 'Profile Test User' },
    }).expect(200);
    const emailResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: { slug: 'profile.email', value: 'contact@example.test' },
    }).expect(200);
    const companyResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: { slug: 'profile.company', value: 'Memory Labs' },
    }).expect(200);

    expect(fullNameResponse.body.errors).toBeUndefined();
    expect(emailResponse.body.errors).toBeUndefined();
    expect(companyResponse.body.errors).toBeUndefined();
    expect(fullNameResponse.body.data.setPreference).toMatchObject({
      slug: 'profile.full_name',
      value: 'Profile Test User',
      status: 'ACTIVE',
      sourceType: 'USER',
      locationId: null,
      category: 'profile',
    });

    const updateResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: { slug: 'profile.full_name', value: 'Updated Profile User' },
    }).expect(200);
    expect(updateResponse.body.data.setPreference).toMatchObject({
      id: fullNameResponse.body.data.setPreference.id,
      slug: 'profile.full_name',
      value: 'Updated Profile User',
    });

    const activeResponse = await graphqlRequest(ACTIVE_PREFERENCES_QUERY).expect(
      200,
    );
    const profileBySlug = new Map(
      activeResponse.body.data.activePreferences
        .filter((preference: any) => preference.slug.startsWith('profile.'))
        .map((preference: any) => [preference.slug, preference.value]),
    );
    expect(profileBySlug).toEqual(
      new Map([
        ['profile.full_name', 'Updated Profile User'],
        ['profile.email', 'contact@example.test'],
        ['profile.company', 'Memory Labs'],
      ]),
    );

    const deleteResponse = await graphqlRequest(DELETE_PREFERENCE_MUTATION, {
      id: companyResponse.body.data.setPreference.id,
    }).expect(200);
    expect(deleteResponse.body.errors).toBeUndefined();
    expect(deleteResponse.body.data.deletePreference).toMatchObject({
      id: companyResponse.body.data.setPreference.id,
      slug: 'profile.company',
    });

    const afterDeleteResponse = await graphqlRequest(
      ACTIVE_PREFERENCES_QUERY,
    ).expect(200);
    expect(
      afterDeleteResponse.body.data.activePreferences.map(
        (preference: any) => preference.slug,
      ),
    ).not.toContain('profile.company');
  });

  it('keeps account email separate from editable contact email across reset', async () => {
    const contactEmailResponse = await graphqlRequest(SET_PREFERENCE_MUTATION, {
      input: { slug: 'profile.email', value: 'contact-only@example.test' },
    }).expect(200);
    expect(contactEmailResponse.body.errors).toBeUndefined();

    await prisma.externalIdentity.create({
      data: {
        userId: testUser.userId,
        provider: 'auth0',
        providerUserId: 'auth0|profile-preference-reset',
        metadata: { source: 'profile-preference-test' },
      },
    });

    const resetResponse = await graphqlRequest(RESET_MUTATION, {
      mode: 'MEMORY_ONLY',
    }).expect(200);
    expect(resetResponse.body.errors).toBeUndefined();
    expect(resetResponse.body.data.resetMyMemory).toMatchObject({
      mode: 'MEMORY_ONLY',
      preferencesDeleted: 1,
    });

    await expect(
      prisma.user.findUniqueOrThrow({
        where: { userId: testUser.userId },
      }),
    ).resolves.toMatchObject({
      userId: testUser.userId,
      email: testUser.email,
    });
    await expect(
      prisma.externalIdentity.count({
        where: { userId: testUser.userId },
      }),
    ).resolves.toBe(1);

    const profileEmailDefinition =
      await prisma.preferenceDefinition.findFirstOrThrow({
        where: { namespace: 'GLOBAL', slug: 'profile.email' },
      });
    await expect(
      prisma.preference.count({
        where: {
          userId: testUser.userId,
          definitionId: profileEmailDefinition.id,
          status: PreferenceStatus.ACTIVE,
        },
      }),
    ).resolves.toBe(0);
  });
});
