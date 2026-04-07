import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import request from 'supertest';
import { createTestApp, createTestUser, TestUser } from '../setup/test-app';
import { getPrismaClient } from '../setup/test-db';
import { ApiKeyMcpClientKey } from '../../src/infrastructure/prisma/generated-client';

describe('Export Preference Schema Auth Contract (e2e)', () => {
  let app: INestApplication;
  let testUser: TestUser;

  const apiKey = 'grp-a-export-auth';
  const EXPORT_QUERY = `
    query ExportPreferenceSchema($scope: ExportSchemaScope!) {
      exportPreferenceSchema(scope: $scope) {
        slug
        namespace
      }
    }
  `;

  beforeAll(async () => {
    const testApp = await createTestApp({ mockAuthGuards: false });
    app = testApp.app;
  });

  beforeEach(async () => {
    testUser = await createTestUser();

    const prisma = getPrismaClient();
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        keyHash: createHash('sha256').update(apiKey).digest('hex'),
        groupName: 'Export Auth Test Group',
        mcpClientKey: ApiKeyMcpClientKey.CLAUDE,
      },
    });

    await prisma.apiKeyUser.create({
      data: {
        apiKeyId: apiKeyRecord.id,
        userId: testUser.userId,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const exportRequest = () =>
    request(app.getHttpServer()).post('/graphql').send({
      query: EXPORT_QUERY,
      variables: { scope: 'GLOBAL' },
    });

  it('rejects export requests that omit the user identity', async () => {
    const response = await exportRequest()
      .set('Authorization', `Bearer ${apiKey}`)
      .expect(200);

    expect(response.body.data).toBeNull();
    expect(response.body.errors?.[0]?.message).toContain('No userId provided');
  });

  it('accepts export requests that send x-user-id', async () => {
    const response = await exportRequest()
      .set('Authorization', `Bearer ${apiKey}`)
      .set('x-user-id', testUser.userId)
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.exportPreferenceSchema.length).toBeGreaterThan(0);
    response.body.data.exportPreferenceSchema.forEach(
      (def: { namespace: string }) => {
        expect(def.namespace).toBe('GLOBAL');
      },
    );
  });

  it('accepts export requests that send ?asUser', async () => {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .query({ asUser: testUser.userId })
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        query: EXPORT_QUERY,
        variables: { scope: 'GLOBAL' },
      })
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.exportPreferenceSchema.length).toBeGreaterThan(0);
  });

  it('accepts export requests that use a compound bearer token', async () => {
    const response = await exportRequest()
      .set('Authorization', `Bearer ${apiKey}.${testUser.userId}`)
      .expect(200);

    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.exportPreferenceSchema.length).toBeGreaterThan(0);
  });
});
