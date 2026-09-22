import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createTestApp, createTestUser, TestUser } from "../setup/test-app";
import { getPrismaClient } from "../setup/test-db";

describe("User Identity GraphQL API (e2e)", () => {
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
    request(app.getHttpServer()).post("/graphql").send({ query, variables });

  it("exposes account identity without profile name fields", async () => {
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

  it("does not expose the legacy updateUser mutation", async () => {
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

  it("keeps user(id) self-only while preserving its current shape", async () => {
    const sameUser = await graphqlRequest(
      `
        query User($id: ID!) {
          user(id: $id) {
            userId
            email
          }
        }
      `,
      { id: testUser.userId },
    ).expect(200);

    expect(sameUser.body.errors).toBeUndefined();
    expect(sameUser.body.data.user).toEqual({
      userId: testUser.userId,
      email: testUser.email,
    });

    const otherUser = await getPrismaClient().user.create({
      data: { email: "identity-other@example.test" },
    });
    const crossUser = await graphqlRequest(
      `
        query User($id: ID!) {
          user(id: $id) {
            userId
            email
          }
        }
      `,
      { id: otherUser.userId },
    ).expect(200);

    expect(crossUser.body.data).toBeNull();
    expect(crossUser.body.errors?.[0]?.message).toBe(
      "You can only view your own account",
    );
  });
});
