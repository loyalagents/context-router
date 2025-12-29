// Jest Configuration with Projects
//
// Three test layers:
// - unit: Fast, parallel tests in src/**/*.spec.ts (no DB, no app boot)
// - integration: DB + DI tests in test/integration/**/*.spec.ts (serial)
// - e2e: Full HTTP boundary tests in test/e2e/**/*.e2e-spec.ts (serial)

// Shared config for all projects
const baseConfig = {
  moduleFileExtensions: ['js', 'json', 'ts'],
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
      testMatch: ['<rootDir>/src/**/*.spec.ts'],
      collectCoverageFrom: ['src/**/*.(t|j)s'],
      coverageDirectory: './coverage/unit',
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
