// Jest Configuration with Projects
//
// Four test layers:
// - unit: Fast, parallel tests in src/**/*.spec.ts and test/contracts
// - local-database: Real SQLite files, compiled workers and owned processes (serial)
// - integration: DB + DI tests in test/integration/**/*.spec.ts (serial)
// - e2e: Full HTTP boundary tests in test/e2e/**/*.e2e-spec.ts (serial)

// Shared config for all projects
const baseConfig = {
  // Keep ts before json so extensionless imports resolve typed wrappers before
  // same-basename data files, e.g. preferences.catalog.ts over .json.
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@infrastructure/(.*)$': '<rootDir>/src/infrastructure/$1',
    '^@graphql/(.*)$': '<rootDir>/src/graphql/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  },
};

module.exports = {
  projects: [
    // Unit tests - fast, parallel, no DB
    {
      ...baseConfig,
      displayName: 'unit',
      rootDir: '.',
      testMatch: [
        '<rootDir>/src/**/*.spec.ts',
        '<rootDir>/test/contracts/**/*.spec.ts',
      ],
      collectCoverageFrom: ['src/**/*.(t|j)s'],
      coverageDirectory: './coverage/unit',
    },

    // Real local files, isolated roots; deliberately no PostgreSQL setup.
    {
      ...baseConfig,
      displayName: 'local-database',
      rootDir: '.',
      testMatch: ['<rootDir>/test/local-database/**/*.spec.ts'],
      maxWorkers: 1,
      coverageDirectory: './coverage/local-database',
    },

    // Integration tests - DB + DI, serial
    {
      ...baseConfig,
      displayName: 'integration',
      rootDir: '.',
      testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
      setupFiles: ['<rootDir>/test/setup/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/jest.after-env.ts'],
      maxWorkers: 1,
      collectCoverageFrom: ['src/**/*.(t|j)s'],
      coverageDirectory: './coverage/integration',
    },

    // E2E tests - HTTP boundary, serial
    {
      ...baseConfig,
      displayName: 'e2e',
      rootDir: '.',
      testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/setup/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup/jest.after-env.ts'],
      maxWorkers: 1,
      collectCoverageFrom: ['src/**/*.(t|j)s'],
      coverageDirectory: './coverage/e2e',
    },
  ],

  // Global coverage settings (when running all projects)
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
};
