import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, createTestUser } from '../setup/test-app';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let setTestUser: (user: any) => void;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    setTestUser = testApp.setTestUser;
  });

  beforeEach(async () => {
    // Create fresh user after resetDb()
    const user = await createTestUser();
    setTestUser(user);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('should return status ok', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });
});
