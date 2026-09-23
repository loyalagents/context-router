import { rootCertificates } from 'node:tls';
import { Client } from 'pg';

import {
  LOCAL_DATABASE_CONNECT_TIMEOUT_MS,
  LOCAL_DATABASE_LOCK_TIMEOUT_MS,
  LOCAL_DATABASE_QUERY_TIMEOUT_MS,
  LOCAL_DATABASE_STATEMENT_TIMEOUT_MS,
  clearLocalIdentityAmbientDriverSelection,
  createLocalIdentityConfiguration,
} from './local-identity.config';

const TEST_CA = `${rootCertificates[0].trim()}\n`;

function validEnvironment(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    LOCAL_IDENTITY_STATE_ROOT: '/private/tmp/context-router-identity',
    DATABASE_URL:
      'postgresql://local%2Duser:local%2Dpassword@127.0.0.1:55432/context%2Drouter',
    LOCAL_DATABASE_TLS_CA_PEM: TEST_CA,
    ...overrides,
  };
}

describe('createLocalIdentityConfiguration', () => {
  it('removes ambient native-driver selectors before the database driver loads', () => {
    const environment: NodeJS.ProcessEnv = {
      NODE_PG_FORCE_NATIVE: '1',
      PGBINARY: '/attacker/pg-native.node',
      DATABASE_URL: 'preserved',
    };

    clearLocalIdentityAmbientDriverSelection(environment);

    expect(environment).toEqual({ DATABASE_URL: 'preserved' });
  });

  it('reads only the three local inputs and constructs explicit verified-TLS client and pool settings', () => {
    const reads: PropertyKey[] = [];
    const environment = new Proxy(validEnvironment(), {
      get(target, property, receiver) {
        reads.push(property);
        return Reflect.get(target, property, receiver);
      },
      ownKeys() {
        throw new Error(
          'local configuration must not enumerate the environment',
        );
      },
    });

    const configuration = createLocalIdentityConfiguration(environment);

    expect(reads).toEqual([
      'LOCAL_IDENTITY_STATE_ROOT',
      'DATABASE_URL',
      'LOCAL_DATABASE_TLS_CA_PEM',
    ]);
    expect(configuration).toMatchObject({
      stateRoot: '/private/tmp/context-router-identity',
      databaseTargetId: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      database: {
        protocol: 'postgresql:',
        host: '127.0.0.1',
        port: 55432,
        database: 'context-router',
        schema: 'public',
      },
      clientConfig: {
        host: '127.0.0.1',
        port: 55432,
        database: 'context-router',
        user: 'local-user',
        password: 'local-password',
        connectionTimeoutMillis: LOCAL_DATABASE_CONNECT_TIMEOUT_MS,
        query_timeout: LOCAL_DATABASE_QUERY_TIMEOUT_MS,
        statement_timeout: LOCAL_DATABASE_STATEMENT_TIMEOUT_MS,
        lock_timeout: LOCAL_DATABASE_LOCK_TIMEOUT_MS,
        ssl: {
          ca: TEST_CA,
          rejectUnauthorized: true,
          checkServerIdentity: expect.any(Function),
        },
      },
      poolConfig: {
        host: '127.0.0.1',
        port: 55432,
        database: 'context-router',
        user: 'local-user',
        password: 'local-password',
        connectionTimeoutMillis: LOCAL_DATABASE_CONNECT_TIMEOUT_MS,
        query_timeout: LOCAL_DATABASE_QUERY_TIMEOUT_MS,
        statement_timeout: LOCAL_DATABASE_STATEMENT_TIMEOUT_MS,
        lock_timeout: LOCAL_DATABASE_LOCK_TIMEOUT_MS,
        ssl: {
          ca: TEST_CA,
          rejectUnauthorized: true,
          checkServerIdentity: expect.any(Function),
        },
      },
    });
    expect(configuration.clientConfig).not.toBe(configuration.poolConfig);
    expect(configuration.clientConfig.ssl).not.toBe(
      configuration.poolConfig.ssl,
    );
  });

  it('derives a credential-free target ID while binding every peer-identity field', () => {
    const first = createLocalIdentityConfiguration(validEnvironment());
    expect(first.databaseTargetId).toBe(
      '7jWbg_X9bruPU5LO2Kf1y0Q9GlWsISEkvB3_ffz6PKM',
    );
    const changedCredentials = createLocalIdentityConfiguration(
      validEnvironment({
        DATABASE_URL:
          'postgresql://another:entirely-different@127.0.0.1:55432/context%2Drouter',
      }),
    );
    expect(changedCredentials.databaseTargetId).toBe(first.databaseTargetId);

    const changedPort = createLocalIdentityConfiguration(
      validEnvironment({
        DATABASE_URL:
          'postgresql://local-user:local-password@127.0.0.1:55433/context-router',
      }),
    );
    const changedDatabase = createLocalIdentityConfiguration(
      validEnvironment({
        DATABASE_URL:
          'postgresql://local-user:local-password@127.0.0.1:55432/context-router-two',
      }),
    );
    const changedCa = createLocalIdentityConfiguration(
      validEnvironment({
        LOCAL_DATABASE_TLS_CA_PEM: `${rootCertificates[1].trim()}\n`,
      }),
    );
    expect(
      new Set([
        first.databaseTargetId,
        changedPort.databaseTargetId,
        changedDatabase.databaseTargetId,
        changedCa.databaseTargetId,
      ]).size,
    ).toBe(4);
    const crlfCertificate = createLocalIdentityConfiguration(
      validEnvironment({
        LOCAL_DATABASE_TLS_CA_PEM: TEST_CA.replaceAll('\n', '\r\n'),
      }),
    );
    expect(crlfCertificate.databaseTargetId).toBe(first.databaseTargetId);
  });

  it('overrides ambient libpq behavior with explicit safe startup parameters', () => {
    const previous = {
      PGOPTIONS: process.env.PGOPTIONS,
      PGREPLICATION: process.env.PGREPLICATION,
      PGCLIENT_ENCODING: process.env.PGCLIENT_ENCODING,
      PGAPPNAME: process.env.PGAPPNAME,
    };
    Object.assign(process.env, {
      PGOPTIONS: '-c search_path=attacker',
      PGREPLICATION: 'database',
      PGCLIENT_ENCODING: 'SQL_ASCII',
      PGAPPNAME: 'attacker-app',
    });
    try {
      const configuration =
        createLocalIdentityConfiguration(validEnvironment());
      const client = new Client(configuration.clientConfig) as Client & {
        connectionParameters: Record<string, unknown>;
      };
      expect(client.connectionParameters).toMatchObject({
        options: '-c search_path=public',
        replication: 'false',
        client_encoding: 'UTF8',
        application_name: 'context-router-local-identity',
        fallback_application_name: 'context-router-local-identity',
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it.each([
    ['missing root', { LOCAL_IDENTITY_STATE_ROOT: undefined }],
    ['relative root', { LOCAL_IDENTITY_STATE_ROOT: 'relative/state' }],
    ['root path', { LOCAL_IDENTITY_STATE_ROOT: '/' }],
    [
      'root with a control character',
      { LOCAL_IDENTITY_STATE_ROOT: '/private/tmp/state\nother' },
    ],
    ['missing URL', { DATABASE_URL: undefined }],
    [
      'URL with a raw tab',
      { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db\t' },
    ],
    [
      'URL with a raw line feed',
      { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db\n' },
    ],
    ['wrong protocol', { DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db' }],
    ['alternate host', { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' }],
    ['IPv6 host', { DATABASE_URL: 'postgresql://u:p@[::1]:5432/db' }],
    ['missing port', { DATABASE_URL: 'postgresql://u:p@127.0.0.1/db' }],
    ['missing user', { DATABASE_URL: 'postgresql://:p@127.0.0.1:5432/db' }],
    ['missing password', { DATABASE_URL: 'postgresql://u@127.0.0.1:5432/db' }],
    ['missing database', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/' }],
    [
      'nested database',
      { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/a/b' },
    ],
    [
      'query',
      { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db?sslmode=disable' },
    ],
    [
      'fragment',
      { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db#fragment' },
    ],
    ['missing CA', { LOCAL_DATABASE_TLS_CA_PEM: undefined }],
    ['non-certificate CA', { LOCAL_DATABASE_TLS_CA_PEM: 'not a certificate' }],
    ['two certificates', { LOCAL_DATABASE_TLS_CA_PEM: `${TEST_CA}${TEST_CA}` }],
  ])('rejects %s', (_name, overrides) => {
    expect(() =>
      createLocalIdentityConfiguration(validEnvironment(overrides)),
    ).toThrow('Invalid local identity configuration');
  });

  it('rejects unbounded inputs without reflecting their contents', () => {
    const urlCanary = `url-${'x'.repeat(8_192)}`;
    const caCanary = `ca-${'x'.repeat(65_536)}`;
    const rootCanary = `/private/tmp/root-${'x'.repeat(8_192)}`;
    for (const overrides of [
      { DATABASE_URL: urlCanary },
      { LOCAL_DATABASE_TLS_CA_PEM: caCanary },
      { LOCAL_IDENTITY_STATE_ROOT: rootCanary },
    ]) {
      let thrown: unknown;
      try {
        createLocalIdentityConfiguration(validEnvironment(overrides));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(
        'Invalid local identity configuration',
      );
      expect((thrown as Error).message).not.toContain('url-');
      expect((thrown as Error).message).not.toContain('ca-');
      expect((thrown as Error).message).not.toContain('root-');
    }
  });
});
