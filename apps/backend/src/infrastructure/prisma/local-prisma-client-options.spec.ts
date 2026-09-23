jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation((configuration) => ({
    kind: 'pool',
    configuration,
  })),
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation((pool, options) => ({
    kind: 'adapter',
    pool,
    options,
  })),
}));

import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { buildLocalPrismaClientOptions } from './local-prisma-client-options';

describe('buildLocalPrismaClientOptions', () => {
  it('passes the explicit verified-TLS PoolConfig without reconstructing a connection string', () => {
    const poolConfig = {
      host: '127.0.0.1',
      port: 55432,
      database: 'context-router',
      user: 'local-user',
      password: 'database-password-canary',
      ssl: {
        ca: 'certificate',
        rejectUnauthorized: true,
        checkServerIdentity: jest.fn(),
      },
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
    };

    const options = buildLocalPrismaClientOptions(poolConfig);

    expect(Pool).toHaveBeenCalledWith(poolConfig);
    expect(PrismaPg).toHaveBeenCalledWith(expect.anything(), {
      disposeExternalPool: true,
      schema: 'public',
    });
    expect(options).toEqual({
      adapter: expect.objectContaining({ kind: 'adapter' }),
    });
    expect(
      JSON.stringify((Pool as unknown as jest.Mock).mock.calls),
    ).not.toContain('connectionString');
  });
});
