/**
 * Test Application Factory
 *
 * Creates a NestJS test application with:
 * - Auth guards bypassed (injects test user into context)
 * - VertexAiService mocked
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
import { ApiKeyGuard } from '../../src/common/guards/api-key.guard';
import { OptionalGqlAuthGuard } from '../../src/common/guards/optional-gql-auth.guard';
import { McpAuthGuard } from '../../src/mcp/auth/mcp-auth.guard';
import { VertexAiService } from '../../src/infrastructure/vertex-ai/vertex-ai.service';
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
 * Options for createTestApp
 */
export interface CreateTestAppOptions {
  /** Custom mock for VertexAiService */
  mockVertexAi?: ReturnType<typeof createMockVertexAiService>;
  /** Whether to replace auth guards with a test guard that injects request.user */
  mockAuthGuards?: boolean;
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
      const request = getRequestFromContext(context);
      request.user = userRef.current;

      return true;
    },
  };
}

function getRequestFromContext(context: ExecutionContext) {
  let request;

  if (context.getType<string>() === 'graphql') {
    request = GqlExecutionContext.create(context).getContext()?.req;
  } else {
    request = context.switchToHttp().getRequest();
  }

  if (!request) {
    throw new Error(
      'Test auth guard could not resolve a request object from the execution context',
    );
  }

  return request;
}

/**
 * Creates a mock MCP auth guard that supports multi-user MCP testing.
 *
 * If the request includes an X-Test-User-Id header, the guard resolves
 * that user from mcpUsersMap and attaches it to the request. This allows
 * concurrent MCP requests to authenticate as different users in the same
 * test run.
 *
 * Falls back to userRef.current when the header is absent (single-user tests).
 *
 * IMPORTANT: X-Test-User-Id logic must never appear in production code.
 * This guard is only registered in test-app.ts.
 */
function createMcpMockAuthGuard(
  mcpUsersMap: Map<string, TestUser>,
  userRef: UserRef,
) {
  return {
    canActivate: (context: ExecutionContext) => {
      const request = getRequestFromContext(context);
      const testUserId = request?.headers?.['x-test-user-id'];

      if (testUserId) {
        const user = mcpUsersMap.get(testUserId);
        if (!user) {
          throw new Error(
            `X-Test-User-Id "${testUserId}" not found in mcpUsersMap. ` +
              `Call registerMcpUser() before making MCP requests with this user ID.`,
          );
        }
        request.user = user;
      } else {
        request.user = userRef.current;
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
  registerMcpUser: (user: TestUser) => void;
  mocks: {
    vertexAi: ReturnType<typeof createMockVertexAiService>;
  };
}> {
  const mockVertexAi = options.mockVertexAi || createMockVertexAiService();
  const mockAuthGuards = options.mockAuthGuards ?? true;

  // Mutable reference - guard always reads current value
  const userRef: UserRef = { current: null };
  const mockAuthGuard = createMockAuthGuard(userRef);

  // Per-userId map for concurrent MCP tests using X-Test-User-Id header
  const mcpUsersMap = new Map<string, TestUser>();
  const mcpMockAuthGuard = createMcpMockAuthGuard(mcpUsersMap, userRef);

  const moduleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (mockAuthGuards) {
    // Most tests bypass auth and inject a fresh test user directly.
    // ApiKeyGuard uses mcpMockAuthGuard so X-Test-User-Id is honoured on MCP
    // endpoints (mcpMockAuthGuard falls back to userRef.current when the header
    // is absent, keeping all non-MCP tests unchanged).
    moduleBuilder.overrideGuard(ApiKeyGuard).useValue(mcpMockAuthGuard);
    moduleBuilder.overrideGuard(OptionalGqlAuthGuard).useValue(mockAuthGuard);
    moduleBuilder.overrideGuard(McpAuthGuard).useValue(mcpMockAuthGuard);
  }

  // Override external services
  moduleBuilder.overrideProvider(VertexAiService).useValue(mockVertexAi);

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
    registerMcpUser: (user: TestUser) => {
      mcpUsersMap.set(user.userId, user);
    },
    mocks: {
      vertexAi: mockVertexAi,
    },
  };
}
