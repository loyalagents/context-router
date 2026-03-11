import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { createTestApp } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';

describe('createGroupUser mutation (e2e)', () => {
  let app: INestApplication;

  const apiKey = 'grp-test-create-user';
  let apiKeyId: string;

  const CREATE_GROUP_USER_MUTATION = `
    mutation CreateGroupUser($input: CreateGroupUserInput!) {
      createGroupUser(input: $input) {
        userId
        email
        firstName
        lastName
      }
    }
  `;

  const GROUP_USERS_QUERY = `
    query GroupUsers($apiKey: String!) {
      groupUsers(apiKey: $apiKey) {
        userId
        email
        firstName
        lastName
      }
    }
  `;

  beforeAll(async () => {
    const testApp = await createTestApp({ mockAuthGuards: false });
    app = testApp.app;
  });

  beforeEach(async () => {
    const prisma = getPrismaClient();
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        keyHash: createHash('sha256').update(apiKey).digest('hex'),
        groupName: 'Create User Test Group',
      },
    });
    apiKeyId = apiKeyRecord.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const gqlRequest = (query: string, variables?: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/graphql').send({ query, variables });

  it('creates a user and associates them with the API key group', async () => {
    const response = await gqlRequest(CREATE_GROUP_USER_MUTATION, {
      input: {
        apiKey,
        email: 'newuser@example.com',
        firstName: 'Alice',
        lastName: 'Smith',
      },
    }).expect(200);

    expect(response.body.errors).toBeUndefined();
    const created = response.body.data.createGroupUser;
    expect(created).toMatchObject({
      email: 'newuser@example.com',
      firstName: 'Alice',
      lastName: 'Smith',
    });
    expect(created.userId).toBeDefined();

    // Verify the user appears in groupUsers
    const listResponse = await gqlRequest(GROUP_USERS_QUERY, { apiKey }).expect(200);
    expect(listResponse.body.errors).toBeUndefined();
    const userIds = listResponse.body.data.groupUsers.map((u: { userId: string }) => u.userId);
    expect(userIds).toContain(created.userId);

    // Verify ApiKeyUser record was created
    const prisma = getPrismaClient();
    const link = await prisma.apiKeyUser.findFirst({
      where: { apiKeyId, userId: created.userId },
    });
    expect(link).not.toBeNull();
  });

  it('returns an error for an invalid API key', async () => {
    const response = await gqlRequest(CREATE_GROUP_USER_MUTATION, {
      input: {
        apiKey: 'invalid-key',
        email: 'nobody@example.com',
        firstName: 'Bob',
        lastName: 'Jones',
      },
    }).expect(200);

    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].message).toContain('Invalid API key');
  });

  it('returns a conflict error for a duplicate email', async () => {
    // Create first user
    await gqlRequest(CREATE_GROUP_USER_MUTATION, {
      input: {
        apiKey,
        email: 'duplicate@example.com',
        firstName: 'Carol',
        lastName: 'White',
      },
    }).expect(200);

    // Try to create another user with the same email
    const response = await gqlRequest(CREATE_GROUP_USER_MUTATION, {
      input: {
        apiKey,
        email: 'duplicate@example.com',
        firstName: 'Carol',
        lastName: 'White',
      },
    }).expect(200);

    expect(response.body.errors).toBeDefined();
    expect(response.body.errors[0].message).toContain('duplicate@example.com');
  });
});
