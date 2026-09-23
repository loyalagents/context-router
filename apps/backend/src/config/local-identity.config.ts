import { createHash, X509Certificate } from 'node:crypto';
import { isAbsolute, parse as parsePath } from 'node:path';
import { checkServerIdentity } from 'node:tls';

import type { ClientConfig, PoolConfig } from 'pg';

export const LOCAL_DATABASE_CONNECT_TIMEOUT_MS = 5_000;
export const LOCAL_DATABASE_QUERY_TIMEOUT_MS = 10_000;
export const LOCAL_DATABASE_STATEMENT_TIMEOUT_MS = 10_000;
export const LOCAL_DATABASE_LOCK_TIMEOUT_MS = 5_000;
export const LOCAL_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS = 10_000;

const MAX_STATE_ROOT_BYTES = 4_096;
const MAX_DATABASE_URL_BYTES = 4_096;
const MAX_CA_PEM_BYTES = 32_768;
const DATABASE_TARGET_LABEL = 'context-router/local-database-target/v1';
const LOCAL_IDENTITY_AMBIENT_DRIVER_KEYS = [
  'NODE_PG_FORCE_NATIVE',
  'PGBINARY',
] as const;

export function clearLocalIdentityAmbientDriverSelection(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of LOCAL_IDENTITY_AMBIENT_DRIVER_KEYS) {
    delete environment[key];
  }
}

export interface LocalIdentityDatabasePeer {
  protocol: 'postgresql:';
  host: '127.0.0.1';
  port: number;
  database: string;
  schema: 'public';
}

export interface LocalIdentityConfiguration {
  stateRoot: string;
  databaseTargetId: string;
  database: LocalIdentityDatabasePeer;
  clientConfig: ClientConfig;
  poolConfig: PoolConfig;
}

function invalidConfiguration(): never {
  throw new Error('Invalid local identity configuration');
}

function boundedString(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes &&
    !value.includes('\0')
  );
}

function parseStateRoot(value: unknown): string {
  if (
    !boundedString(value, MAX_STATE_ROOT_BYTES) ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !isAbsolute(value) ||
    value === parsePath(value).root
  ) {
    invalidConfiguration();
  }
  return value;
}

function decodeUrlComponent(value: string): string {
  const decoded = decodeURIComponent(value);
  if (
    decoded.length === 0 ||
    decoded.includes('\0') ||
    /[\u0000-\u001f\u007f]/u.test(decoded)
  ) {
    invalidConfiguration();
  }
  return decoded;
}

function parseDatabaseUrl(value: unknown): {
  peer: LocalIdentityDatabasePeer;
  user: string;
  password: string;
} {
  if (
    !boundedString(value, MAX_DATABASE_URL_BYTES) ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    invalidConfiguration();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidConfiguration();
  }
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port.length === 0 ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0 ||
    !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%\-]+$/u.test(parsed.pathname)
  ) {
    invalidConfiguration();
  }

  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    invalidConfiguration();
  }
  const database = decodeUrlComponent(parsed.pathname.slice(1));
  if (database.includes('/')) {
    invalidConfiguration();
  }

  return {
    peer: {
      protocol: 'postgresql:',
      host: '127.0.0.1',
      port,
      database,
      schema: 'public',
    },
    user: decodeUrlComponent(parsed.username),
    password: decodeUrlComponent(parsed.password),
  };
}

function parseCertificate(value: unknown): {
  pem: string;
  spkiDigest: Buffer;
} {
  if (!boundedString(value, MAX_CA_PEM_BYTES)) {
    invalidConfiguration();
  }
  const matches = value.match(/-----BEGIN CERTIFICATE-----/gu);
  if (
    matches?.length !== 1 ||
    !/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/]{1,80}={0,2}\r?\n)+-----END CERTIFICATE-----\r?\n?$/u.test(
      value,
    )
  ) {
    invalidConfiguration();
  }

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(value);
  } catch {
    invalidConfiguration();
  }
  if (!certificate.ca) {
    invalidConfiguration();
  }
  const publicKey = certificate.publicKey.export({
    format: 'der',
    type: 'spki',
  });
  return {
    pem: value,
    spkiDigest: createHash('sha256').update(publicKey).digest(),
  };
}

function updateFramed(
  hash: ReturnType<typeof createHash>,
  value: Buffer,
): void {
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(value.byteLength);
  hash.update(length);
  hash.update(value);
}

function createDatabaseTargetId(
  peer: LocalIdentityDatabasePeer,
  spkiDigest: Buffer,
): string {
  const hash = createHash('sha256');
  updateFramed(hash, Buffer.from(DATABASE_TARGET_LABEL, 'utf8'));
  for (const field of [
    Buffer.from(peer.protocol, 'utf8'),
    Buffer.from(peer.host, 'utf8'),
    Buffer.from(String(peer.port), 'utf8'),
    Buffer.from(peer.database, 'utf8'),
    Buffer.from(peer.schema, 'utf8'),
    spkiDigest,
  ]) {
    updateFramed(hash, field);
  }
  return hash.digest('base64url');
}

export function createLocalIdentityConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): LocalIdentityConfiguration {
  try {
    const stateRootValue = environment.LOCAL_IDENTITY_STATE_ROOT;
    const databaseUrlValue = environment.DATABASE_URL;
    const caPemValue = environment.LOCAL_DATABASE_TLS_CA_PEM;

    const stateRoot = parseStateRoot(stateRootValue);
    const { peer, user, password } = parseDatabaseUrl(databaseUrlValue);
    const certificate = parseCertificate(caPemValue);
    const ssl = {
      ca: certificate.pem,
      rejectUnauthorized: true,
      checkServerIdentity: (
        _hostname: string,
        peerCertificate: Parameters<typeof checkServerIdentity>[1],
      ) => checkServerIdentity(peer.host, peerCertificate),
    };
    const common: ClientConfig = {
      host: peer.host,
      port: peer.port,
      database: peer.database,
      user,
      password,
      ssl,
      application_name: 'context-router-local-identity',
      fallback_application_name: 'context-router-local-identity',
      binary: false,
      options: '-c search_path=public',
      client_encoding: 'UTF8',
      replication: 'false',
      connectionTimeoutMillis: LOCAL_DATABASE_CONNECT_TIMEOUT_MS,
      query_timeout: LOCAL_DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: LOCAL_DATABASE_STATEMENT_TIMEOUT_MS,
      lock_timeout: LOCAL_DATABASE_LOCK_TIMEOUT_MS,
      idle_in_transaction_session_timeout:
        LOCAL_DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: 1_000,
    };

    return {
      stateRoot,
      databaseTargetId: createDatabaseTargetId(peer, certificate.spkiDigest),
      database: peer,
      clientConfig: { ...common, ssl: { ...ssl } },
      poolConfig: {
        ...common,
        ssl: { ...ssl },
        max: 10,
        idleTimeoutMillis: 10_000,
      },
    };
  } catch {
    invalidConfiguration();
  }
}
