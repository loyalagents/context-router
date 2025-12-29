/**
 * Test Application Factory
 *
 * Creates a NestJS test application with:
 * - Auth guards bypassed (injects test user into context)
 * - VertexAiService mocked
 * - Auth0Service mocked
 * - ValidationPipe applied globally
 *
 * Usage pattern (Option 5 - fixtures in beforeEach):
 * - Call createTestApp() in beforeAll (expensive app bootstrap, done once)
 * - Call createTestUser() in beforeEach (cheap, runs after resetDb)
 * - Use setTestUser() to update the guard's user reference
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
} from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AppModule } from '../../src/app.module';
import { GqlAuthGuard } from '../../src/common/guards/gql-auth.guard';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { VertexAiService } from '../../src/infrastructure/vertex-ai/vertex-ai.service';
import { Auth0Service } from '../../src/infrastructure/auth0/auth0.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { getPrismaClient } from './test-db';

/**
 * Default test user data for database seeding.
 */
export const DEFAULT_TEST_USER_DATA = {
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
};

/**
 * Test user type matching the Prisma User model.
 */
export interface TestUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mutable reference to the current test user.
 * Used by the mock auth guard to always inject the latest user.
 */
interface UserRef {
  current: TestUser | null;
}

/**
 * Mock implementation of VertexAiService.
 * All methods are jest.fn() for easy spying and per-test overrides.
 */
export const createMockVertexAiService = () => ({
  generateText: jest.fn().mockResolvedValue('Mock AI response'),
  generateTextWithFile: jest.fn().mockResolvedValue(
    JSON.stringify({
      suggestions: [],
      documentSummary: 'Mock document summary',
    }),
  ),
});

/**
 * Mock implementation of Auth0Service.
 */
export const createMockAuth0Service = () => ({
  getUserInfo: jest.fn().mockResolvedValue({
    data: {
      user_id: 'auth0|test-user-id',
      email: 'test@example.com',
      name: 'Test User',
    },
  }),
  updateUserMetadata: jest.fn().mockResolvedValue({}),
  getManagementClient: jest.fn(),
  getAuthClient: jest.fn(),
});

/**
 * Options for createTestApp
 */
export interface CreateTestAppOptions {
  /** Custom mock for VertexAiService */
  mockVertexAi?: ReturnType<typeof createMockVertexAiService>;
  /** Custom mock for Auth0Service */
  mockAuth0?: ReturnType<typeof createMockAuth0Service>;
}

/**
 * Creates a mock auth guard that:
 * 1. Always returns true (allows all requests)
 * 2. Attaches the current test user from userRef to the request context
 *
 * Uses a mutable reference so the user can be updated between tests
 * without recreating the guard or app.
 */
function createMockAuthGuard(userRef: UserRef) {
  return {
    canActivate: (context: ExecutionContext) => {
      // Handle GraphQL context
      const gqlContext = GqlExecutionContext.create(context);
      const ctx = gqlContext.getContext();

      if (ctx?.req) {
        // GraphQL request
        ctx.req.user = userRef.current;
      } else {
        // HTTP request (REST endpoints)
        const request = context.switchToHttp().getRequest();
        if (request) {
          request.user = userRef.current;
        }
      }

      return true;
    },
  };
}

/**
 * Creates a test user in the database.
 * Call this in beforeEach after resetDb() to ensure a fresh user exists.
 *
 * @returns The created user
 */
export async function createTestUser(): Promise<TestUser> {
  const prisma = getPrismaClient();
  const user = await prisma.user.create({
    data: DEFAULT_TEST_USER_DATA,
  });
  return user;
}

/**
 * Creates a fully configured NestJS test application.
 *
 * This should be called in beforeAll. The returned setTestUser function
 * should be called in beforeEach after resetDb() runs to update the
 * user reference with a freshly created user.
 *
 * @example
 * ```ts
 * let app: INestApplication;
 * let testUser: TestUser;
 * let setTestUser: (user: TestUser) => void;
 *
 * beforeAll(async () => {
 *   const testApp = await createTestApp();
 *   app = testApp.app;
 *   setTestUser = testApp.setTestUser;
 * });
 *
 * beforeEach(async () => {
 *   // Runs after global resetDb()
 *   testUser = await createTestUser();
 *   setTestUser(testUser);
 * });
 *
 * afterAll(async () => {
 *   await app.close();
 * });
 *
 * it('should work', async () => {
 *   // testUser is fresh and exists in DB
 *   const response = await request(app.getHttpServer())
 *     .post('/graphql')
 *     .send({ query: '{ preferences { preferenceId } }' });
 * });
 * ```
 */
export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<{
  app: INestApplication;
  module: TestingModule;
  setTestUser: (user: TestUser) => void;
  mocks: {
    vertexAi: ReturnType<typeof createMockVertexAiService>;
    auth0: ReturnType<typeof createMockAuth0Service>;
  };
}> {
  const mockVertexAi = options.mockVertexAi || createMockVertexAiService();
  const mockAuth0 = options.mockAuth0 || createMockAuth0Service();

  // Mutable reference - guard always reads current value
  const userRef: UserRef = { current: null };
  const mockAuthGuard = createMockAuthGuard(userRef);

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  // Override guards
  moduleBuilder.overrideGuard(GqlAuthGuard).useValue(mockAuthGuard);
  moduleBuilder.overrideGuard(JwtAuthGuard).useValue(mockAuthGuard);

  // Override external services
  moduleBuilder.overrideProvider(VertexAiService).useValue(mockVertexAi);
  moduleBuilder.overrideProvider(Auth0Service).useValue(mockAuth0);

  // Use test database PrismaClient
  moduleBuilder.overrideProvider(PrismaService).useValue(getPrismaClient());

  const module = await moduleBuilder.compile();

  const app = module.createNestApplication();

  // Apply global validation pipe (matches production config in main.ts)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  await app.init();

  return {
    app,
    module,
    setTestUser: (user: TestUser) => {
      userRef.current = user;
    },
    mocks: {
      vertexAi: mockVertexAi,
      auth0: mockAuth0,
    },
  };
}
