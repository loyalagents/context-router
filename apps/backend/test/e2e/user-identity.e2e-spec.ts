import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';

describe('User Identity GraphQL API (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;
  let setTestUser: (user: TestUser) => void;

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

  it('exposes account identity without profile name fields', async () => {
    const response = await graphqlRequest(`
      query Me {
        me {
          userId
          email
        }
      }
    `).expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.me).toEqual({
      userId: testUser.userId,
      email: testUser.email,
    });

    const invalidResponse = await graphqlRequest(`
      query MeWithRemovedNames {
        me {
          firstName
          lastName
        }
      }
    `).expect(400);

    expect(invalidResponse.body.errors?.[0]?.message).toContain(
      'Cannot query field "firstName"',
    );
  });

  it('does not expose the legacy updateUser mutation', async () => {
    const response = await graphqlRequest(`
      mutation UpdateUser {
        updateUser(updateUserInput: { userId: "user-1", email: "new@example.test" }) {
          userId
        }
      }
    `).expect(400);

    expect(response.body.errors?.[0]?.message).toContain(
      'Cannot query field "updateUser"',
    );
  });
});
