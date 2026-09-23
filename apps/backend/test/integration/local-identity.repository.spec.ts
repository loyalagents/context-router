import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { rootCertificates } from 'node:tls';
import { pathToFileURL } from 'node:url';

import { PrismaClient } from '../../src/generated/prisma/client';
import { createLocalIdentityConfiguration } from '../../src/config/local-identity.config';
import { buildLocalPrismaClientOptions } from '../../src/infrastructure/prisma/local-prisma-client-options';
import {
  type LocalIdentityDatabaseClient,
  LocalIdentityRepository,
  createLocalIdentityDatabaseClient,
} from '../../src/modules/auth/local-identity.repository';
import {
  type LocalIdentityFileSystem,
  LocalIdentityFileStore,
  nodeLocalIdentityFileSystem,
} from '../../src/modules/auth/local-identity-filesystem';
import { LocalIdentityStateService } from '../../src/modules/auth/local-identity-state.service';
import { createSyntheticPrincipalEmail } from '../../src/modules/auth/principal-identity';
import {
  decodeLocalIdentityState,
  type LocalIdentityState,
} from '../../src/modules/auth/local-identity-state.codec';

jest.setTimeout(180_000);

const repositoryRoot = resolve(__dirname, '../../../..');

function run(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    failureMessage?: string;
  } = {},
): Promise<void> {
  return new Promise((resolveRun, reject) => {
    execFile(
      executable,
      args,
      {
        cwd: options.cwd ?? repositoryRoot,
        env: options.env ?? process.env,
        timeout: options.timeout ?? 60_000,
        maxBuffer: 1024 * 1024,
      },
      (error) => {
        if (error) {
          reject(
            new Error(
              options.failureMessage ??
                'Local identity TLS fixture command failed',
            ),
          );
          return;
        }
        resolveRun();
      },
    );
  });
}

function capture(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  return new Promise((resolveCapture) => {
    execFile(
      executable,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeout ?? 5_000,
        maxBuffer: 64 * 1024,
      },
      (error, stdout, stderr) => {
        resolveCapture({ stdout, stderr, ok: !error });
      },
    );
  });
}

async function waitForPostgres(containerName: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await run(
        'docker',
        ['exec', containerName, 'pg_isready', '-U', 'postgres'],
        {
          timeout: 5_000,
          failureMessage:
            'Local identity TLS fixture readiness probe failed',
        },
      );
      return;
    } catch {
      const status = await capture('docker', [
        'inspect',
        '--format',
        '{{.State.Running}}',
        containerName,
      ]);
      if (status.ok && status.stdout.trim() !== 'true') {
        const logs = await capture('docker', ['logs', containerName]);
        throw new Error(
          `Local identity TLS fixture exited: ${`${logs.stdout}${logs.stderr}`.slice(-2_000)}`,
        );
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  throw new Error('Local identity TLS fixture did not become ready');
}

async function createCertificates(directory: string): Promise<string> {
  const caKey = join(directory, 'ca.key');
  const caCertificate = join(directory, 'ca.crt');
  const serial = join(directory, 'ca.srl');
  await run(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '2',
      '-subj',
      '/CN=Context Router Local Identity Test CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
      '-keyout',
      caKey,
      '-out',
      caCertificate,
    ],
    {
      failureMessage:
        'Local identity TLS fixture CA generation failed',
    },
  );
  for (const [prefix, address] of [
    ['server', '127.0.0.1'],
    ['wrong-server', '127.0.0.2'],
  ] as const) {
    const serverKey = join(directory, `${prefix}.key`);
    const serverRequest = join(directory, `${prefix}.csr`);
    const serverCertificate = join(directory, `${prefix}.crt`);
    const extensions = join(directory, `${prefix}.ext`);
    await writeFile(
      extensions,
      `subjectAltName=IP:${address}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n`,
      { mode: 0o600 },
    );
    await run(
      'openssl',
      [
        'req',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-subj',
        '/CN=127.0.0.1',
        '-keyout',
        serverKey,
        '-out',
        serverRequest,
      ],
      {
        failureMessage:
          'Local identity TLS fixture server request generation failed',
      },
    );
    await run(
      'openssl',
      [
        'x509',
        '-req',
        '-in',
        serverRequest,
        '-CA',
        caCertificate,
        '-CAkey',
        caKey,
        '-CAserial',
        serial,
        ...(prefix === 'server' ? ['-CAcreateserial'] : []),
        '-days',
        '2',
        '-sha256',
        '-extfile',
        extensions,
        '-out',
        serverCertificate,
      ],
      {
        failureMessage:
          'Local identity TLS fixture server certificate signing failed',
      },
    );
    await chmod(serverKey, 0o600);
    await Promise.all([unlink(serverRequest), unlink(extensions)]);
  }
  await Promise.all([unlink(caKey), unlink(serial)]);
  return readFile(caCertificate, 'utf8');
}

async function startTlsPostgres(options: {
  containerName: string;
  fixtureLabel: string;
  password: string;
  tlsDirectory: string;
  certificatePrefix: 'server' | 'wrong-server';
}): Promise<number> {
  const containerScript = [
    `cp /tls-source/${options.certificatePrefix}.crt /var/lib/postgresql/server.crt`,
    `cp /tls-source/${options.certificatePrefix}.key /var/lib/postgresql/server.key`,
    'chown postgres:postgres /var/lib/postgresql/server.crt /var/lib/postgresql/server.key',
    'chmod 0600 /var/lib/postgresql/server.key',
    'exec /usr/local/bin/docker-entrypoint.sh "$@"',
  ].join('; ');
  await run(
    'docker',
    [
      'run',
      '--pull=never',
      '-d',
      '--name',
      options.containerName,
      '--label',
      options.fixtureLabel,
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=536870912,mode=0700',
      '-p',
      '127.0.0.1::5432',
      '-e',
      'POSTGRES_USER=postgres',
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=context_router_test',
      '--mount',
      `type=bind,src=${options.tlsDirectory},dst=/tls-source,readonly`,
      '--entrypoint',
      '/bin/sh',
      'postgres:15-alpine',
      '-ceu',
      containerScript,
      '--',
      'postgres',
      '-c',
      'ssl=on',
      '-c',
      'ssl_cert_file=/var/lib/postgresql/server.crt',
      '-c',
      'ssl_key_file=/var/lib/postgresql/server.key',
      '-c',
      'ssl_min_protocol_version=TLSv1.2',
    ],
    {
      env: { ...process.env, POSTGRES_PASSWORD: options.password },
      timeout: 30_000,
      failureMessage: 'Local identity TLS fixture container start failed',
    },
  );
  const mapping = await capture(
    'docker',
    ['port', options.containerName, '5432/tcp'],
    { timeout: 5_000 },
  );
  const match = mapping.stdout.trim().match(/^127\.0\.0\.1:(\d+)$/u);
  if (!mapping.ok || !match) {
    throw new Error('Local identity TLS fixture port discovery failed');
  }
  await waitForPostgres(options.containerName);
  return Number(match[1]);
}

function commitFaultClient(
  configuration: Parameters<typeof createLocalIdentityDatabaseClient>[0],
  boundary: 'before' | 'after',
): LocalIdentityDatabaseClient {
  const delegate = createLocalIdentityDatabaseClient(configuration);
  return {
    connect: () => delegate.connect(),
    async query(text, values) {
      if (text === 'COMMIT') {
        if (boundary === 'before') {
          delegate.destroy();
          throw new Error('injected commit disconnect');
        }
        await delegate.query(text, values);
        throw new Error('injected lost commit response');
      }
      return delegate.query(text, values);
    },
    end: () => delegate.end(),
    destroy: () => delegate.destroy(),
    assertHealthy: () => delegate.assertHealthy(),
  };
}

async function acquireEventually(
  repository: LocalIdentityRepository,
): Promise<Awaited<ReturnType<LocalIdentityRepository['acquire']>>> {
  const deadline = Date.now() + 5_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await repository.acquire();
    } catch (error) {
      if ((error as Error)?.message !== 'Local identity operation busy') {
        throw error;
      }
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
  }
  throw lastError ?? new Error('Local identity fresh session unavailable');
}

async function resetIdentityTables(
  configuration: Parameters<typeof createLocalIdentityDatabaseClient>[0],
): Promise<void> {
  const client = createLocalIdentityDatabaseClient(configuration);
  await client.connect();
  try {
    await client.query(
      'TRUNCATE TABLE public.external_identities, public.users RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}

async function readIdentityRows(
  configuration: Parameters<typeof createLocalIdentityDatabaseClient>[0],
): Promise<{
  users: Array<{ user_id: string; email: string }>;
  identities: Array<{ id: string; user_id: string }>;
}> {
  const client = createLocalIdentityDatabaseClient(configuration);
  await client.connect();
  try {
    const users = await client.query(
      'SELECT user_id, email FROM public.users ORDER BY user_id',
    );
    const identities = await client.query(
      'SELECT id, user_id FROM public.external_identities ORDER BY id',
    );
    return {
      users: users.rows as Array<{ user_id: string; email: string }>,
      identities: identities.rows as Array<{ id: string; user_id: string }>,
    };
  } finally {
    await client.end();
  }
}

async function readLocalIdentityArtifacts(root: string): Promise<
  Array<{
    name: string;
    bytes: Buffer;
    dev: bigint;
    ino: bigint;
    nlink: bigint;
    mode: bigint;
  }>
> {
  return Promise.all(
    (await readdir(root)).sort().map(async (name) => {
      const path = join(root, name);
      const [bytes, metadata] = await Promise.all([
        readFile(path),
        lstat(path, { bigint: true }),
      ]);
      return {
        name,
        bytes,
        dev: metadata.dev,
        ino: metadata.ino,
        nlink: metadata.nlink,
        mode: metadata.mode,
      };
    }),
  );
}

async function readOptionalLocalIdentityArtifacts(
  root: string,
): Promise<Awaited<ReturnType<typeof readLocalIdentityArtifacts>> | null> {
  try {
    return await readLocalIdentityArtifacts(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameLocalIdentityArtifacts(
  left: Awaited<ReturnType<typeof readLocalIdentityArtifacts>> | null,
  right: Awaited<ReturnType<typeof readLocalIdentityArtifacts>> | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.length === right.length &&
    left.every((artifact, index) => {
      const expected = right[index];
      return (
        artifact.name === expected.name &&
        artifact.bytes.equals(expected.bytes) &&
        artifact.dev === expected.dev &&
        artifact.ino === expected.ino &&
        artifact.nlink === expected.nlink &&
        artifact.mode === expected.mode
      );
    })
  );
}

async function waitForBackendAbsent(
  client: LocalIdentityDatabaseClient,
  pid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query(
      'SELECT pid FROM pg_catalog.pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (result.rows.length === 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity terminated backend remained visible');
}

async function waitForClientLoss(
  client: LocalIdentityDatabaseClient,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      client.assertHealthy();
    } catch {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity terminated client did not latch loss');
}

function startCapturedProcess(options: {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): {
  child: ChildProcess;
  result: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>;
  readOutput: () => { stdout: string; stderr: string };
} {
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout = `${stdout}${chunk}`.slice(-64 * 1024);
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-64 * 1024);
  });
  const result = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
  }>((resolveResult, rejectResult) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 30_000);
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectResult(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr });
    });
  });
  return {
    child,
    result,
    readOutput: () => ({ stdout, stderr }),
  };
}

async function waitForCapturedStdout(
  captured: ReturnType<typeof startCapturedProcess>,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const output = captured.readOutput();
    if (output.stdout === expected) return;
    if (
      !expected.startsWith(output.stdout) ||
      output.stderr.length > 0 ||
      captured.child.exitCode !== null ||
      captured.child.signalCode !== null
    ) {
      throw new Error('Local identity preview failed before readiness');
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity preview readiness timed out');
}

async function waitForCandidate(root: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  let lastNames: string[] = [];
  while (Date.now() < deadline) {
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    lastNames = names;
    const candidate = names.find(
      (name) =>
        name.startsWith('identity.pending-') ||
        name.startsWith('identity.rotate-'),
    );
    if (candidate) return candidate;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const shapes = lastNames.map((name) =>
    name
      .replace(/[A-Za-z0-9_-]{43}/gu, '<nonce>')
      .replace(/^identity\.stage-operation-.+$/u, 'operation-stage')
      .replace(/^identity\.stage-.+-candidate\.tmp$/u, 'candidate-stage')
      .replace(/^identity\.pending-.+$/u, 'initialize-candidate')
      .replace(/^identity\.rotate-.+$/u, 'rotation-candidate'),
  );
  throw new Error(
    `Local identity candidate did not become observable (${shapes.join(',')})`,
  );
}

async function waitForPublishedCandidateStageRemoval(
  root: string,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  let lastNames: string[] = [];
  while (Date.now() < deadline) {
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    lastNames = names;
    const candidate = names.find(
      (name) =>
        name.startsWith('identity.pending-') ||
        name.startsWith('identity.rotate-'),
    );
    if (
      candidate &&
      !names.some(
        (name) =>
          name.startsWith('identity.stage-') &&
          name.endsWith('-candidate.tmp'),
      )
    ) {
      return candidate;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(
    `Local identity candidate stage removal was not observed (${lastNames.join(',')})`,
  );
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity process marker was not observed');
}

async function makeTreeOwnerWritable(path: string): Promise<void> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info || info.isSymbolicLink()) return;
  if (info.isDirectory()) {
    await chmod(path, 0o700);
    for (const name of await readdir(path)) {
      await makeTreeOwnerWritable(join(path, name));
    }
    return;
  }
  if (info.isFile()) await chmod(path, 0o600);
}

async function assertTreeExcludesBytes(
  root: string,
  forbidden: string,
): Promise<void> {
  const forbiddenBytes = Buffer.from(forbidden, 'utf8');
  async function inspect(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of await readdir(path)) await inspect(join(path, name));
      return;
    }
    if (info.isFile() && (await readFile(path)).includes(forbiddenBytes)) {
      throw new Error(
        'Relocated local identity package retained a source path',
      );
    }
  }
  await inspect(root);
}

const TEST_COMMIT_BARRIER_KEY = [36_541_119, 1_879_950_421] as const;

async function waitForBlockedLocalIdentityBackend(
  client: LocalIdentityDatabaseClient,
  queryText: string,
  timeoutMs = 8_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT pid
         FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND application_name = 'context-router-local-identity'
          AND position($1 in btrim(query)) > 0
          AND wait_event_type = 'Lock'
        ORDER BY query_start DESC
        LIMIT 1`,
      [queryText],
    );
    const pid = Number(result.rows[0]?.pid);
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  const diagnostic = await client.query(
    `SELECT application_name, state, wait_event_type, wait_event,
            left(btrim(query), 160) AS query
       FROM pg_catalog.pg_stat_activity
      WHERE datname = current_database()
        AND application_name LIKE 'context-router-local-identity%'
      ORDER BY application_name, backend_start`,
  );
  throw new Error(
    `Local identity database boundary was not observed: ${JSON.stringify(
      diagnostic.rows,
    )}`,
  );
}

async function waitForCommittedPrincipal(
  client: LocalIdentityDatabaseClient,
  principalId: string,
): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await client.query(
      'SELECT user_id FROM public.users WHERE user_id = $1',
      [principalId],
    );
    if (result.rows.length === 1) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity committed principal was not observable');
}

async function waitForProcessStopped(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const status = await capture('ps', ['-o', 'stat=', '-p', String(pid)], {
      timeout: 2_000,
    });
    if (status.ok && /T/u.test(status.stdout)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity process did not stop');
}

async function waitForLocalIdentityProcessBackend(
  client: LocalIdentityDatabaseClient,
): Promise<number> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await client.query(
      `SELECT pid
         FROM pg_catalog.pg_stat_activity
        WHERE datname = current_database()
          AND application_name = 'context-router-local-identity'
          AND pid <> pg_backend_pid()
        ORDER BY backend_start DESC`,
    );
    if (result.rows.length > 1) {
      throw new Error('Multiple local identity process backends were observed');
    }
    const pid = Number(result.rows[0]?.pid);
    if (Number.isSafeInteger(pid) && pid > 0) return pid;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('Local identity process backend was not observed');
}

const INITIALIZE_SESSION_LOSS_BOUNDARIES = [
  { boundary: 'root.mkdir', generation: 1, recovery: 'initialize' },
  { boundary: 'root.parent-dir-fsync', generation: null },
  { boundary: 'operation.stage.create', generation: null },
  { boundary: 'operation.stage.write', generation: null },
  { boundary: 'operation.stage.file-fsync', generation: null },
  { boundary: 'operation.publish.link', generation: null },
  { boundary: 'operation.publish.verify', generation: null },
  { boundary: 'operation.publish.dir-fsync', generation: null },
  { boundary: 'operation.stage.unlink', generation: null },
  { boundary: 'operation.stage.dir-fsync', generation: null },
  { boundary: 'candidate.stage.create', generation: null },
  { boundary: 'candidate.stage.write', generation: null },
  { boundary: 'candidate.stage.file-fsync', generation: null },
  { boundary: 'candidate.publish.link', generation: null },
  { boundary: 'candidate.publish.verify', generation: 1 },
  { boundary: 'candidate.publish.dir-fsync', generation: 1 },
  { boundary: 'candidate.stage.unlink', generation: 1 },
  { boundary: 'candidate.stage.dir-fsync', generation: 1 },
  { boundary: 'initial.publish.link', generation: 1 },
  { boundary: 'initial.publish.verify', generation: 1 },
  { boundary: 'initial.publish.dir-fsync', generation: 1 },
  { boundary: 'initial.candidate.unlink', generation: 1 },
  { boundary: 'initial.candidate.dir-fsync', generation: 1 },
  { boundary: 'operation.cleanup.unlink', generation: 1 },
  { boundary: 'operation.cleanup.dir-fsync', generation: 1 },
] as const;

const ROTATION_SESSION_LOSS_BOUNDARIES = [
  { boundary: 'operation.stage.create', generation: 1 },
  { boundary: 'operation.stage.write', generation: 1 },
  { boundary: 'operation.stage.file-fsync', generation: 1 },
  { boundary: 'operation.publish.link', generation: 1 },
  { boundary: 'operation.publish.verify', generation: 1 },
  { boundary: 'operation.publish.dir-fsync', generation: 1 },
  { boundary: 'operation.stage.unlink', generation: 1 },
  { boundary: 'operation.stage.dir-fsync', generation: 1 },
  { boundary: 'candidate.stage.create', generation: 1 },
  { boundary: 'candidate.stage.write', generation: 1 },
  { boundary: 'candidate.stage.file-fsync', generation: 1 },
  { boundary: 'candidate.publish.link', generation: 1 },
  { boundary: 'candidate.publish.verify', generation: 1 },
  { boundary: 'candidate.publish.dir-fsync', generation: 1 },
  { boundary: 'candidate.stage.unlink', generation: 1 },
  { boundary: 'candidate.stage.dir-fsync', generation: 1 },
  { boundary: 'rotation.rename', generation: 1 },
  { boundary: 'rotation.rename.verify', generation: 2 },
  { boundary: 'rotation.rename.dir-fsync', generation: 2 },
  { boundary: 'operation.cleanup.unlink', generation: 2 },
  { boundary: 'operation.cleanup.dir-fsync', generation: 2 },
] as const;

async function installCommitBarrier(
  configuration: Parameters<typeof createLocalIdentityDatabaseClient>[0],
): Promise<{
  controller: LocalIdentityDatabaseClient;
  waitForCommit(): Promise<number>;
  release(): Promise<void>;
  dispose(): Promise<void>;
}> {
  const setup = createLocalIdentityDatabaseClient({
    ...configuration,
    application_name: 'context-router-local-identity-barrier-setup',
  });
  await setup.connect();
  try {
    await setup.query(
      'DROP TRIGGER IF EXISTS local_identity_test_commit_barrier ON public.users',
    );
    await setup.query(
      'DROP FUNCTION IF EXISTS public.local_identity_test_commit_barrier()',
    );
    await setup.query(`
      CREATE FUNCTION public.local_identity_test_commit_barrier()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF current_setting('application_name') = 'context-router-local-identity' THEN
          PERFORM pg_advisory_xact_lock(36541119, 1879950421);
        END IF;
        RETURN NEW;
      END
      $function$`);
    await setup.query(`
      CREATE CONSTRAINT TRIGGER local_identity_test_commit_barrier
      AFTER INSERT ON public.users
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      EXECUTE FUNCTION public.local_identity_test_commit_barrier()`);
  } finally {
    await setup.end();
  }

  const controller = createLocalIdentityDatabaseClient({
    ...configuration,
    application_name: 'context-router-local-identity-barrier-controller',
  });
  await controller.connect();
  await controller.query(
    'SELECT pg_advisory_lock($1::int, $2::int)',
    TEST_COMMIT_BARRIER_KEY,
  );
  let held = true;
  let closed = false;
  return {
    controller,
    waitForCommit: () =>
      waitForBlockedLocalIdentityBackend(controller, 'COMMIT'),
    async release() {
      if (!held) return;
      const result = await controller.query(
        'SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked',
        TEST_COMMIT_BARRIER_KEY,
      );
      if (result.rows[0]?.unlocked !== true) {
        throw new Error('Local identity commit barrier release failed');
      }
      held = false;
    },
    async dispose() {
      if (held) {
        await controller
          .query(
            'SELECT pg_advisory_unlock($1::int, $2::int) AS unlocked',
            TEST_COMMIT_BARRIER_KEY,
          )
          .catch(() => undefined);
        held = false;
      }
      if (!closed) {
        await controller.end().catch(() => undefined);
        closed = true;
      }
      const cleanup = createLocalIdentityDatabaseClient({
        ...configuration,
        application_name: 'context-router-local-identity-barrier-cleanup',
      });
      await cleanup.connect();
      try {
        await cleanup.query(
          'DROP TRIGGER IF EXISTS local_identity_test_commit_barrier ON public.users',
        );
        await cleanup.query(
          'DROP FUNCTION IF EXISTS public.local_identity_test_commit_barrier()',
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}

describe('local identity direct-TLS repository', () => {
  it('uses TLS inside PostgreSQL, serializes dedicated sessions, and supports the explicit Prisma pool', async () => {
    const created = await mkdtemp(join(tmpdir(), 'local-identity-tls-'));
    await chmod(created, 0o700);
    const fixtureRoot = await realpath(created);
    const tlsDirectory = join(fixtureRoot, 'tls');
    const stateParent = join(fixtureRoot, 'state-parent');
    await Promise.all([
      mkdir(tlsDirectory, { mode: 0o700 }),
      mkdir(stateParent, { mode: 0o700 }),
    ]);
    const containerName = `context-router-local-identity-${randomUUID().replaceAll('-', '')}`;
    const wrongSanContainerName = `${containerName}-wrong-san`;
    const fixtureLabel = `context-router.local-identity.test=${containerName}`;
    const password = randomBytes(24).toString('base64url');
    const startedContainers: string[] = [];
    const spawnedChildren: ChildProcess[] = [];
    let prisma: PrismaClient | undefined;
    let primaryError: unknown;
    try {
      const ca = await createCertificates(tlsDirectory);
      startedContainers.push(containerName);
      const port = await startTlsPostgres({
        containerName,
        fixtureLabel,
        password,
        tlsDirectory,
        certificatePrefix: 'server',
      });

      const databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/context_router_test`;
      await run(
        'pnpm',
        ['--filter', 'backend', 'exec', 'prisma', 'migrate', 'deploy'],
        {
          env: { ...process.env, DATABASE_URL: databaseUrl },
          timeout: 90_000,
          failureMessage: 'Local identity TLS fixture migration failed',
        },
      );
      const configuration = createLocalIdentityConfiguration({
        LOCAL_IDENTITY_STATE_ROOT: join(stateParent, 'state'),
        DATABASE_URL: databaseUrl,
        LOCAL_DATABASE_TLS_CA_PEM: ca,
      });

      const direct = createLocalIdentityDatabaseClient(
        configuration.clientConfig,
      );
      await direct.connect();
      const directTls = await direct.query(
        'SELECT ssl, version, cipher FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      expect(directTls.rows).toEqual([
        {
          ssl: true,
          version: expect.any(String),
          cipher: expect.any(String),
        },
      ]);
      await direct.end();

      prisma = new PrismaClient(
        buildLocalPrismaClientOptions(configuration.poolConfig),
      );
      const prismaTls = await prisma.$queryRawUnsafe<
        Array<{ ssl: boolean; version: string; cipher: string }>
      >(
        'SELECT ssl, version, cipher FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()',
      );
      expect(prismaTls).toEqual([
        {
          ssl: true,
          version: expect.any(String),
          cipher: expect.any(String),
        },
      ]);
      await prisma.$disconnect();
      prisma = undefined;

      const wrongConfiguration = createLocalIdentityConfiguration({
        LOCAL_IDENTITY_STATE_ROOT: join(stateParent, 'wrong-state'),
        DATABASE_URL: databaseUrl,
        LOCAL_DATABASE_TLS_CA_PEM: `${rootCertificates[0].trim()}\n`,
      });
      const wrongClient = createLocalIdentityDatabaseClient(
        wrongConfiguration.clientConfig,
      );
      const wrongCaError = await wrongClient.connect().then(
        () => null,
        (error: NodeJS.ErrnoException) => error,
      );
      wrongClient.destroy();
      expect(wrongCaError?.code).toMatch(
        /^(?:SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/u,
      );

      startedContainers.push(wrongSanContainerName);
      const wrongSanPort = await startTlsPostgres({
        containerName: wrongSanContainerName,
        fixtureLabel,
        password,
        tlsDirectory,
        certificatePrefix: 'wrong-server',
      });
      const wrongSanConfiguration = createLocalIdentityConfiguration({
        LOCAL_IDENTITY_STATE_ROOT: join(stateParent, 'wrong-san-state'),
        DATABASE_URL: `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${wrongSanPort}/context_router_test`,
        LOCAL_DATABASE_TLS_CA_PEM: ca,
      });
      const wrongSanClient = createLocalIdentityDatabaseClient(
        wrongSanConfiguration.clientConfig,
      );
      const wrongSanError = await wrongSanClient.connect().then(
        () => null,
        (error: NodeJS.ErrnoException) => error,
      );
      wrongSanClient.destroy();
      expect(wrongSanError?.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
      await run('docker', ['rm', '-f', wrongSanContainerName], {
        timeout: 30_000,
        failureMessage:
          'Local identity wrong-SAN fixture cleanup failed',
      });
      startedContainers.splice(
        startedContainers.indexOf(wrongSanContainerName),
        1,
      );

      const state: LocalIdentityState = {
        schemaVersion: 1,
        databaseTargetId: configuration.databaseTargetId,
        principalId: randomBytes(32).toString('base64url'),
        credential: randomBytes(32).toString('base64url'),
        generation: 1,
      };
      const repository = new LocalIdentityRepository({
        clientConfig: configuration.clientConfig,
      });
      const first = await repository.acquire();
      await expect(repository.acquire()).rejects.toThrow(
        'Local identity operation busy',
      );
      await expect(first.initialize(state)).resolves.toBe('inserted');
      await first.release();

      const fresh = await repository.acquire();
      await expect(fresh.verify(state)).resolves.toBeUndefined();
      await fresh.release();

      const inspection = createLocalIdentityDatabaseClient(
        configuration.clientConfig,
      );
      await inspection.connect();
      await expect(
        inspection.query(
          'SELECT user_id, email FROM public.users ORDER BY user_id',
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            user_id: state.principalId,
            email: createSyntheticPrincipalEmail(state.principalId),
          },
        ],
      });
      await expect(
        inspection.query('SELECT id FROM public.external_identities'),
      ).resolves.toMatchObject({ rows: [] });
      await inspection.query(
        'UPDATE public.users SET email = $1, updated_at = NOW() WHERE user_id = $2',
        ['changed@example.test', state.principalId],
      );
      await inspection.query(
        `INSERT INTO public.external_identities
          (id, user_id, provider, issuer, provider_user_id, updated_at)
         VALUES
          ($1, $2, 'auth0', 'https://tenant.example.test/', 'subject-one', NOW()),
          ($3, $2, 'second-idp', 'https://issuer.example.test/', 'subject-two', NOW())`,
        [randomUUID(), state.principalId, randomUUID()],
      );
      await inspection.end();

      const boundPrincipal = await repository.acquire();
      await expect(boundPrincipal.initialize(state)).resolves.toBe('matched');
      await expect(boundPrincipal.verify(state)).resolves.toBeUndefined();
      await boundPrincipal.release();
      await expect(
        readIdentityRows(configuration.clientConfig),
      ).resolves.toMatchObject({
        users: [
          {
            user_id: state.principalId,
            email: 'changed@example.test',
          },
        ],
        identities: [
          { user_id: state.principalId },
          { user_id: state.principalId },
        ],
      });

      for (const conflictingUsers of [
        [randomBytes(32).toString('base64url')],
        [
          randomBytes(32).toString('base64url'),
          randomBytes(32).toString('base64url'),
        ],
      ]) {
        await resetIdentityTables(configuration.clientConfig);
        const seeder = createLocalIdentityDatabaseClient(
          configuration.clientConfig,
        );
        await seeder.connect();
        try {
          for (const [index, userId] of conflictingUsers.entries()) {
            await seeder.query(
              'INSERT INTO public.users (user_id, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
              [userId, `conflict-${index}@example.invalid`],
            );
          }
        } finally {
          await seeder.end();
        }
        const beforeConflict = await readIdentityRows(
          configuration.clientConfig,
        );
        const conflicting = await repository.acquire();
        await expect(conflicting.initialize(state)).rejects.toThrow(
          'Local identity database state conflict',
        );
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toEqual(beforeConflict);
        await expect(conflicting.verify(state)).rejects.toThrow(
          'Local identity database state conflict',
        );
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toEqual(beforeConflict);
        await conflicting.release();
        const afterConflict = await acquireEventually(repository);
        await afterConflict.release();
      }

      for (const boundary of ['before', 'after'] as const) {
        await resetIdentityTables(configuration.clientConfig);
        const ambiguityRoot = join(stateParent, `ambiguity-${boundary}`);
        const faultRepository = new LocalIdentityRepository({
          clientConfig: configuration.clientConfig,
          clientFactory: (clientConfiguration) =>
            commitFaultClient(clientConfiguration, boundary),
        });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: ambiguityRoot,
            databaseTargetId: configuration.databaseTargetId,
          }),
          repository: faultRepository,
        });

        await expect(interrupted.initialize()).rejects.toThrow(
          'Local identity recovery required',
        );
        const interruptedNames = (await readdir(ambiguityRoot)).sort();
        expect(interruptedNames).toHaveLength(2);
        expect(interruptedNames).toContain('identity.operation.json');
        const candidateName = interruptedNames.find((name) =>
          name.startsWith('identity.pending-'),
        );
        expect(candidateName).toBeDefined();
        const candidate = decodeLocalIdentityState(
          await readFile(join(ambiguityRoot, candidateName as string)),
        );
        const beforeRecovery = await readIdentityRows(
          configuration.clientConfig,
        );
        expect(beforeRecovery.identities).toEqual([]);
        expect(beforeRecovery.users).toEqual(
          boundary === 'before'
            ? []
            : [
                {
                  user_id: candidate.principalId,
                  email: createSyntheticPrincipalEmail(candidate.principalId),
                },
              ],
        );

        const postFailureSession = await acquireEventually(repository);
        await postFailureSession.release();
        const recovery = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: ambiguityRoot,
            databaseTargetId: configuration.databaseTargetId,
          }),
          repository,
        });
        const ready = await recovery.recoverInitialize();

        expect(ready?.state.databaseTargetId).toBe(candidate.databaseTargetId);
        expect(ready?.state.principalId).toBe(candidate.principalId);
        expect(ready?.state.generation).toBe(candidate.generation);
        expect(ready?.state.credential === candidate.credential).toBe(true);
        expect(await readdir(ambiguityRoot)).toEqual(['identity.json']);
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toEqual({
          users: [
            {
              user_id: candidate.principalId,
              email: createSyntheticPrincipalEmail(candidate.principalId),
            },
          ],
          identities: [],
        });
      }

      for (const conflict of [
        'wrong-user',
        'multiple-users',
        'foreign-identity-owner',
      ] as const) {
        await resetIdentityTables(configuration.clientConfig);
        const recoveryRoot = join(stateParent, `recovery-conflict-${conflict}`);
        const faultRepository = new LocalIdentityRepository({
          clientConfig: configuration.clientConfig,
          clientFactory: (clientConfiguration) =>
            commitFaultClient(clientConfiguration, 'before'),
        });
        const interrupted = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: recoveryRoot,
            databaseTargetId: configuration.databaseTargetId,
          }),
          repository: faultRepository,
        });
        await expect(interrupted.initialize()).rejects.toThrow(
          'Local identity recovery required',
        );
        const candidateName = (await readdir(recoveryRoot)).find((name) =>
          name.startsWith('identity.pending-'),
        );
        if (!candidateName) throw new Error('Recovery candidate was not found');
        const candidate = decodeLocalIdentityState(
          await readFile(join(recoveryRoot, candidateName)),
        );
        const foreignPrincipal = randomBytes(32).toString('base64url');
        const anotherPrincipal = randomBytes(32).toString('base64url');
        const seeder = createLocalIdentityDatabaseClient(
          configuration.clientConfig,
        );
        await seeder.connect();
        try {
          const principals =
            conflict === 'wrong-user'
              ? [foreignPrincipal]
              : conflict === 'multiple-users'
                ? [foreignPrincipal, anotherPrincipal]
                : [candidate.principalId, foreignPrincipal];
          for (const [index, principalId] of principals.entries()) {
            await seeder.query(
              'INSERT INTO public.users (user_id, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())',
              [principalId, `recovery-conflict-${index}@example.invalid`],
            );
          }
          if (conflict === 'foreign-identity-owner') {
            await seeder.query(
              `INSERT INTO public.external_identities
                (id, user_id, provider, issuer, provider_user_id, updated_at)
               VALUES ($1, $2, 'future-provider', 'https://future.example.test/', 'foreign-subject', NOW())`,
              [randomUUID(), foreignPrincipal],
            );
          }
        } finally {
          await seeder.end();
        }
        const artifactsBefore = await readLocalIdentityArtifacts(recoveryRoot);
        const rowsBefore = await readIdentityRows(configuration.clientConfig);
        const recovery = new LocalIdentityStateService({
          fileStore: new LocalIdentityFileStore({
            stateRoot: recoveryRoot,
            databaseTargetId: configuration.databaseTargetId,
          }),
          repository,
        });

        await expect(recovery.recoverInitialize()).rejects.toThrow(
          'Local identity database state conflict',
        );

        const artifactsAfter = await readLocalIdentityArtifacts(recoveryRoot);
        expect(
          sameLocalIdentityArtifacts(artifactsAfter, artifactsBefore),
        ).toBe(true);
        const rowsAfter = await readIdentityRows(configuration.clientConfig);
        expect(JSON.stringify(rowsAfter) === JSON.stringify(rowsBefore)).toBe(
          true,
        );
        const afterRecoveryConflict = await acquireEventually(repository);
        await afterRecoveryConflict.release();
      }

      await resetIdentityTables(configuration.clientConfig);
      const blocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-lock-blocker',
      });
      await blocker.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE');
        let observedDatabaseCode: string | undefined;
        const timeoutRepository = new LocalIdentityRepository({
          clientConfig: {
            ...configuration.clientConfig,
            application_name: 'context-router-local-identity-lock-timeout',
            lock_timeout: 100,
            statement_timeout: 1_000,
            query_timeout: 1_000,
          },
          clientFactory: (clientConfiguration) => {
            const delegate =
              createLocalIdentityDatabaseClient(clientConfiguration);
            return {
              connect: () => delegate.connect(),
              async query(text, values) {
                try {
                  return await delegate.query(text, values);
                } catch (error) {
                  observedDatabaseCode = (error as { code?: string }).code;
                  throw error;
                }
              },
              end: () => delegate.end(),
              destroy: () => delegate.destroy(),
              assertHealthy: () => delegate.assertHealthy(),
            };
          },
          deadlineMs: 2_000,
        });
        const timedOut = await timeoutRepository.acquire();

        await expect(timedOut.verifyEmpty()).rejects.toThrow(
          'Local identity database deadline exceeded',
        );
        expect(observedDatabaseCode).toBe('55P03');
        await expect(timedOut.release()).resolves.toBeUndefined();
      } finally {
        await blocker.query('ROLLBACK');
        await blocker.end();
      }
      await expect(
        readIdentityRows(configuration.clientConfig),
      ).resolves.toEqual({ users: [], identities: [] });
      const afterTimeout = await acquireEventually(repository);
      await afterTimeout.release();

      const terminatedApplication =
        'context-router-local-identity-terminated-session';
      let terminatedPid: number | undefined;
      const terminatedRepository = new LocalIdentityRepository({
        clientConfig: {
          ...configuration.clientConfig,
          application_name: terminatedApplication,
        },
        clientFactory: (clientConfiguration) => {
          const delegate =
            createLocalIdentityDatabaseClient(clientConfiguration);
          return {
            async connect() {
              await delegate.connect();
              const result = await delegate.query(
                'SELECT pg_backend_pid() AS pid',
              );
              terminatedPid = Number(result.rows[0]?.pid);
            },
            query: (text, values) => delegate.query(text, values),
            end: () => delegate.end(),
            destroy: () => delegate.destroy(),
            assertHealthy: () => delegate.assertHealthy(),
          };
        },
      });
      const terminatedSession = await terminatedRepository.acquire();
      expect(terminatedPid).toEqual(expect.any(Number));
      await expect(repository.acquire()).rejects.toThrow(
        'Local identity operation busy',
      );
      const terminator = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-terminator',
      });
      await terminator.connect();
      try {
        await expect(
          terminator.query('SELECT pg_terminate_backend($1) AS terminated', [
            terminatedPid,
          ]),
        ).resolves.toMatchObject({
          rows: [{ terminated: true }],
        });
        await waitForBackendAbsent(terminator, terminatedPid as number);
        const afterTermination = await acquireEventually(repository);
        await afterTermination.release();
        expect(() => terminatedSession.assertHeld()).toThrow(
          'Local identity database unavailable',
        );
        await expect(terminatedSession.release()).resolves.toBeUndefined();
      } finally {
        await terminator.end();
      }

      for (const boundary of ['before-operation', 'after-commit'] as const) {
        await resetIdentityTables(configuration.clientConfig);
        const lossRoot = join(stateParent, `session-loss-${boundary}`);
        let lossPid: number | undefined;
        let lossClient: LocalIdentityDatabaseClient | undefined;
        const lossRepository = new LocalIdentityRepository({
          clientConfig: {
            ...configuration.clientConfig,
            application_name: `context-router-local-identity-${boundary}`,
          },
          clientFactory: (clientConfiguration) => {
            const delegate =
              createLocalIdentityDatabaseClient(clientConfiguration);
            lossClient = delegate;
            return {
              async connect() {
                await delegate.connect();
                const result = await delegate.query(
                  'SELECT pg_backend_pid() AS pid',
                );
                lossPid = Number(result.rows[0]?.pid);
              },
              query: (text, values) => delegate.query(text, values),
              end: () => delegate.end(),
              destroy: () => delegate.destroy(),
              assertHealthy: () => delegate.assertHealthy(),
            };
          },
        });
        const lossTerminator = createLocalIdentityDatabaseClient({
          ...configuration.clientConfig,
          application_name: `context-router-local-identity-${boundary}-terminator`,
        });
        await lossTerminator.connect();
        let fired = false;
        const terminateHeldSession = async (): Promise<void> => {
          if (fired) return;
          fired = true;
          if (!lossPid || !lossClient) {
            throw new Error('Local identity loss fixture was not acquired');
          }
          const result = await lossTerminator.query(
            'SELECT pg_terminate_backend($1) AS terminated',
            [lossPid],
          );
          if (result.rows[0]?.terminated !== true) {
            throw new Error('Local identity loss fixture termination failed');
          }
          await waitForBackendAbsent(lossTerminator, lossPid);
          await waitForClientLoss(lossClient);
        };
        const adversarial: LocalIdentityFileSystem = {
          ...nodeLocalIdentityFileSystem,
          async mkdir(path, options) {
            await nodeLocalIdentityFileSystem.mkdir(path, options);
            if (boundary === 'before-operation') {
              await terminateHeldSession();
            }
          },
          async link(existingPath, newPath) {
            await nodeLocalIdentityFileSystem.link(existingPath, newPath);
            if (
              boundary === 'after-commit' &&
              basename(newPath) === 'identity.json'
            ) {
              await terminateHeldSession();
            }
          },
        };
        try {
          const interrupted = new LocalIdentityStateService({
            fileStore: new LocalIdentityFileStore({
              stateRoot: lossRoot,
              databaseTargetId: configuration.databaseTargetId,
              fileSystem: adversarial,
            }),
            repository: lossRepository,
          });

          await expect(interrupted.initialize()).rejects.toThrow(
            boundary === 'before-operation'
              ? 'Local identity database unavailable'
              : 'Local identity recovery required',
          );
          expect(fired).toBe(true);
          const names = (await readdir(lossRoot)).sort();
          if (boundary === 'before-operation') {
            expect(names).toEqual([]);
            await expect(
              readIdentityRows(configuration.clientConfig),
            ).resolves.toEqual({ users: [], identities: [] });
          } else {
            expect(names).toHaveLength(3);
            expect(names).toContain('identity.json');
            expect(names).toContain('identity.operation.json');
            const candidateName = names.find((name) =>
              name.startsWith('identity.pending-'),
            );
            expect(candidateName).toBeDefined();
            const candidate = decodeLocalIdentityState(
              await readFile(join(lossRoot, candidateName as string)),
            );
            await expect(
              readIdentityRows(configuration.clientConfig),
            ).resolves.toMatchObject({
              users: [{ user_id: candidate.principalId }],
              identities: [],
            });
            const recovery = new LocalIdentityStateService({
              fileStore: new LocalIdentityFileStore({
                stateRoot: lossRoot,
                databaseTargetId: configuration.databaseTargetId,
              }),
              repository,
            });
            const ready = await recovery.recoverInitialize();
            expect(ready?.state.principalId).toBe(candidate.principalId);
            expect(ready?.state.generation).toBe(1);
            expect(await readdir(lossRoot)).toEqual(['identity.json']);
          }
          const afterLoss = await acquireEventually(repository);
          await afterLoss.release();
        } finally {
          await lossTerminator.end();
        }
      }

      const modulesMetadata = await readFile(
        join(repositoryRoot, 'node_modules/.modules.yaml'),
        'utf8',
      );
      const observedStorePath = modulesMetadata
        .match(/^storeDir:\s*(.+)$/mu)?.[1]
        ?.trim();
      if (
        !observedStorePath ||
        resolve(observedStorePath) !== observedStorePath
      ) {
        throw new Error('Installed pnpm store was not found');
      }
      const observedStore = await realpath(observedStorePath);
      if (!(await lstat(observedStore)).isDirectory()) {
        throw new Error('Installed pnpm store was not found');
      }
      await run('pnpm', ['--filter', 'backend', 'build'], {
        timeout: 90_000,
        failureMessage: 'Local identity sealed fixture build failed',
      });
      const sealedStage = join(fixtureRoot, 'sealed-stage');
      const deployedBackend = join(sealedStage, 'backend');
      await mkdir(sealedStage, { mode: 0o700 });
      await mkdir(join(sealedStage, 'web'), { mode: 0o700 });
      await run(
        'pnpm',
        [
          '--offline',
          '--filter',
          'backend',
          'deploy',
          '--prod',
          deployedBackend,
        ],
        {
          env: {
            ...process.env,
            npm_config_offline: 'true',
            npm_config_package_import_method: 'copy',
            npm_config_store_dir: observedStore,
          },
          timeout: 90_000,
          failureMessage: 'Local identity sealed fixture deploy failed',
        },
      );
      const compiledEntrypoint = join(
        deployedBackend,
        'dist/local-identity.js',
      );
      const deployedManifest = JSON.parse(
        await readFile(join(deployedBackend, 'package.json'), 'utf8'),
      ) as { main?: unknown; scripts?: Record<string, unknown> };
      expect(deployedManifest.main).toBe('dist/main.js');
      expect(deployedManifest.scripts?.['local-identity']).toBe(
        'node --no-global-search-paths dist/local-identity.js',
      );
      await expect(readFile(compiledEntrypoint)).resolves.toEqual(
        expect.any(Buffer),
      );
      for (const relative of [
        'dist/local-identity.js',
        'dist/local-identity.js.map',
        'dist/bootstrap/local-identity-preview.js',
        'dist/composition/local-application.module.js',
        'dist/config/local-identity.config.js',
        'dist/modules/auth/local-identity-admin.cli.js',
        'dist/modules/auth/local-identity-filesystem.js',
        'dist/modules/auth/local-identity.repository.js',
        'dist/modules/auth/local-identity-state.codec.js',
        'dist/modules/auth/local-identity-state.service.js',
        'dist/modules/auth/strategies/local-identity.strategy.js',
      ]) {
        const content = await readFile(join(deployedBackend, relative), 'utf8');
        expect(content.includes(repositoryRoot)).toBe(false);
      }
      await unlink(join(deployedBackend, 'pnpm-lock.yaml'));
      await assertTreeExcludesBytes(deployedBackend, repositoryRoot);
      const hostileHome = join(fixtureRoot, 'hostile-home');
      const hostileCwd = join(fixtureRoot, 'hostile-cwd');
      await Promise.all([
        mkdir(hostileHome, { mode: 0o700 }),
        mkdir(hostileCwd, { mode: 0o700 }),
      ]);
      const dotenvRoots = [
        join(stateParent, 'dotenv-package-root'),
        join(stateParent, 'dotenv-cwd-root'),
        join(stateParent, 'dotenv-home-root'),
      ];
      const dotenvFile = (stateRoot: string) =>
        [
          `LOCAL_IDENTITY_STATE_ROOT=${stateRoot}`,
          `DATABASE_URL=${databaseUrl}`,
          `LOCAL_DATABASE_TLS_CA_PEM=${JSON.stringify(ca)}`,
          '',
        ].join('\n');
      await Promise.all([
        writeFile(join(deployedBackend, '.env'), dotenvFile(dotenvRoots[0]), {
          mode: 0o600,
        }),
        writeFile(join(hostileCwd, '.env'), dotenvFile(dotenvRoots[1]), {
          mode: 0o600,
        }),
        writeFile(join(hostileHome, '.env'), dotenvFile(dotenvRoots[2]), {
          mode: 0o600,
        }),
      ]);
      const passThroughEnvironment = Object.fromEntries(
        ['PATH', 'LANG', 'LC_ALL', 'TZ'].flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key]]],
        ),
      );
      const isolatedEnvironment: NodeJS.ProcessEnv = {
        ...passThroughEnvironment,
        HOME: hostileHome,
        TMPDIR: fixtureRoot,
        TMP: fixtureRoot,
        TEMP: fixtureRoot,
        NODE_PG_FORCE_NATIVE: '1',
        PGBINARY: '1',
        AUTH0_DOMAIN: 'process-auth0-canary.invalid',
        GCP_PROJECT_ID: 'process-cloud-canary',
      };
      const cliEnvironment = (
        stateRoot: string,
        url: string = databaseUrl,
      ): NodeJS.ProcessEnv => ({
        ...isolatedEnvironment,
        LOCAL_IDENTITY_STATE_ROOT: stateRoot,
        DATABASE_URL: url,
        LOCAL_DATABASE_TLS_CA_PEM: ca,
      });
      const successOutput = (operation: string, generation: number | null) =>
        `${JSON.stringify({
          type: 'context-router.local-identity.admin',
          version: 1,
          operation,
          status: 'ok',
          generation,
        })}\n`;
      const previewReadiness =
        '{"type":"context-router.local-identity.preview.ready","version":1}\n';
      const compiledArguments = (command: string) => [
        '--no-global-search-paths',
        compiledEntrypoint,
        command,
      ];

      await resetIdentityTables(configuration.clientConfig);
      const dotenvProbe = await capture(
        process.execPath,
        compiledArguments('initialize'),
        {
          cwd: hostileCwd,
          env: isolatedEnvironment,
          timeout: 30_000,
        },
      );
      expect(dotenvProbe).toEqual({
        ok: false,
        stdout: '',
        stderr: 'Local identity command failed\n',
      });
      for (const dotenvRoot of dotenvRoots) {
        await expect(readdir(dotenvRoot)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
      await expect(
        readIdentityRows(configuration.clientConfig),
      ).resolves.toEqual({ users: [], identities: [] });

      await unlink(join(deployedBackend, '.env'));
      const incompleteRoot = join(fixtureRoot, 'incomplete-package');
      await mkdir(incompleteRoot, { mode: 0o700 });
      await writeFile(
        join(incompleteRoot, 'local-identity.js'),
        await readFile(compiledEntrypoint),
        { mode: 0o600 },
      );
      const incompleteResult = await capture(
        process.execPath,
        [
          '--no-global-search-paths',
          join(incompleteRoot, 'local-identity.js'),
          'initialize',
        ],
        {
          cwd: hostileCwd,
          env: cliEnvironment(join(stateParent, 'incomplete-state')),
          timeout: 30_000,
        },
      );
      expect(incompleteResult).toEqual({
        ok: false,
        stdout: '',
        stderr: 'Local identity command failed\n',
      });
      expect(JSON.stringify(incompleteResult).includes(repositoryRoot)).toBe(
        false,
      );
      expect(JSON.stringify(incompleteResult).includes(password)).toBe(false);

      const closureProbeScript = `
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
delete process.env.NODE_PG_FORCE_NATIVE;
delete process.env.PGBINARY;
const root = fs.realpathSync(process.argv[1]);
const modulesRoot = fs.realpathSync(path.join(root, "node_modules"));
const before = new Set(Object.keys(require.cache));
const stagedRequire = createRequire(path.join(root, "package.json"));
const pg = fs.realpathSync(stagedRequire.resolve("pg"));
const pgRelative = path.relative(modulesRoot, pg);
if (pgRelative.startsWith("..") || path.isAbsolute(pgRelative)) throw new Error("pg escaped staged node_modules");
stagedRequire(path.join(root, "dist/modules/auth/local-identity-admin.cli.js"));
const loaded = Object.keys(require.cache).filter((filename) => !before.has(filename));
for (const filename of loaded) {
  const real = fs.realpathSync(filename);
  const relative = path.relative(root, real);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("loaded module escaped staged backend");
  const normalized = real.split(path.sep).join("/").toLowerCase();
  for (const forbidden of ["/auth0/", "/dotenv/", "/@google-cloud/vertexai/", "/jwks-rsa/", "/modules/mcp/"]) {
    if (normalized.includes(forbidden)) throw new Error("hosted provider module entered local closure");
  }
}
process.stdout.write(JSON.stringify({ loaded: true }));
`;
      const closureProbe = await capture(
        process.execPath,
        ['--no-global-search-paths', '-e', closureProbeScript, deployedBackend],
        {
          cwd: hostileCwd,
          env: {
            ...isolatedEnvironment,
            NODE_PATH: join(hostileHome, 'poison-node-path'),
          },
          timeout: 30_000,
        },
      );
      expect(closureProbe).toEqual({
        ok: true,
        stdout: '{"loaded":true}',
        stderr: '',
      });

      const packagingModuleUrl = pathToFileURL(
        join(repositoryRoot, 'scripts/local-migration/packaging-smoke.mjs'),
      ).href;
      const stageBridge = join(fixtureRoot, 'stage-bridge.mjs');
      const stageDescriptor = join(fixtureRoot, 'stage-descriptor.json');
      await writeFile(
        stageBridge,
        `import fs from "node:fs";
const [mode, moduleUrl, stage, descriptor, privateRoot, references] = process.argv.slice(2);
const helpers = await import(moduleUrl);
if (mode === "audit") {
  await helpers.assertNoSharedRegularFiles(stage, JSON.parse(references));
  await helpers.assertNoStageAncestorNodeModules(stage + "/backend", privateRoot);
} else if (mode === "seal") {
  const sealed = await helpers.sealAndDescribeStage(stage, {
    schemaVersion: 1,
    proof: "local-identity-relocation",
    backendEntrypoint: "backend/dist/local-identity.js",
  });
  fs.writeFileSync(descriptor, JSON.stringify(sealed), { flag: "wx", mode: 0o600 });
} else if (mode === "verify") {
  await helpers.verifySealedStage(stage, JSON.parse(fs.readFileSync(descriptor, "utf8")));
} else {
  throw new Error("invalid stage bridge mode");
}
`,
        { mode: 0o600 },
      );
      await run(
        process.execPath,
        [
          stageBridge,
          'audit',
          packagingModuleUrl,
          sealedStage,
          stageDescriptor,
          fixtureRoot,
          JSON.stringify([repositoryRoot, observedStore]),
        ],
        {
          cwd: hostileCwd,
          env: isolatedEnvironment,
          timeout: 90_000,
          failureMessage: 'Local identity sealed fixture audit failed',
        },
      );
      await run(
        process.execPath,
        [
          stageBridge,
          'seal',
          packagingModuleUrl,
          sealedStage,
          stageDescriptor,
          fixtureRoot,
          '[]',
        ],
        {
          cwd: hostileCwd,
          env: isolatedEnvironment,
          timeout: 90_000,
          failureMessage: 'Local identity sealed fixture seal failed',
        },
      );
      const verifySealedLocalIdentityStage = () =>
        run(
          process.execPath,
          [
            stageBridge,
            'verify',
            packagingModuleUrl,
            sealedStage,
            stageDescriptor,
            fixtureRoot,
            '[]',
          ],
          {
            cwd: hostileCwd,
            env: isolatedEnvironment,
            timeout: 90_000,
            failureMessage: 'Local identity sealed fixture verify failed',
          },
        );
      await verifySealedLocalIdentityStage();

      await resetIdentityTables(configuration.clientConfig);
      const firstProcessRoot = join(stateParent, 'process-first');
      const losingProcessRoot = join(stateParent, 'process-loser');
      const processBlocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-process-blocker',
      });
      await processBlocker.connect();
      let firstProcess: ReturnType<typeof startCapturedProcess> | undefined;
      let processBlockerClosed = false;
      try {
        await processBlocker.query('BEGIN');
        await processBlocker.query(
          'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
        );
        firstProcess = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(firstProcessRoot),
        });
        spawnedChildren.push(firstProcess.child);
        const firstCandidateName = await waitForCandidate(firstProcessRoot);
        const firstCandidate = decodeLocalIdentityState(
          await readFile(join(firstProcessRoot, firstCandidateName)),
        );
        const firstOperationBytes = await readFile(
          join(firstProcessRoot, 'identity.operation.json'),
        );
        expect(
          firstOperationBytes.includes(
            Buffer.from(firstCandidate.credential, 'utf8'),
          ),
        ).toBe(false);
        expect(
          firstProcess.child.spawnargs
            .join('\0')
            .includes(firstCandidate.credential),
        ).toBe(false);
        expect(
          JSON.stringify(cliEnvironment(firstProcessRoot)).includes(
            firstCandidate.credential,
          ),
        ).toBe(false);
        const loser = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(losingProcessRoot),
        });
        spawnedChildren.push(loser.child);
        await expect(loser.result).resolves.toEqual({
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'Local identity command failed\n',
        });
        await processBlocker.query('ROLLBACK');
        await processBlocker.end();
        processBlockerClosed = true;
        const winner = await firstProcess.result;
        expect(winner).toEqual({
          code: 0,
          signal: null,
          stdout: successOutput('initialize', 1),
          stderr: '',
        });
        expect(
          `${winner.stdout}${winner.stderr}`.includes(
            firstCandidate.credential,
          ),
        ).toBe(false);
        expect(`${winner.stdout}${winner.stderr}`.includes(password)).toBe(
          false,
        );
        expect(await readdir(firstProcessRoot)).toEqual(['identity.json']);
        await expect(readdir(losingProcessRoot)).rejects.toMatchObject({
          code: 'ENOENT',
        });
        const firstDatabaseRows = await readIdentityRows(
          configuration.clientConfig,
        );
        expect(firstDatabaseRows).toEqual({
          users: [
            {
              user_id: firstCandidate.principalId,
              email: createSyntheticPrincipalEmail(firstCandidate.principalId),
            },
          ],
          identities: [],
        });
        expect(
          JSON.stringify(firstDatabaseRows).includes(firstCandidate.credential),
        ).toBe(false);

        const bindingClient = createLocalIdentityDatabaseClient({
          ...configuration.clientConfig,
          application_name: 'context-router-local-identity-preview-binding',
        });
        await bindingClient.connect();
        try {
          await bindingClient.query(
            `INSERT INTO public.external_identities
              (id, user_id, provider, issuer, provider_user_id, updated_at)
             VALUES
              ($1, $2, 'auth0', 'https://tenant.example.test/', 'subject-one', NOW()),
              ($3, $2, 'second-idp', 'https://issuer.example.test/', 'subject-two', NOW())`,
            [randomUUID(), firstCandidate.principalId, randomUUID()],
          );
        } finally {
          await bindingClient.end();
        }

        const runPackagedPreview = async (
          signal: 'SIGINT' | 'SIGTERM',
          expectedExitCode: number,
        ) => {
          const canonicalBefore = await readFile(
            join(firstProcessRoot, 'identity.json'),
          );
          const preview = startCapturedProcess({
            executable: process.execPath,
            args: compiledArguments('preview'),
            cwd: hostileCwd,
            env: cliEnvironment(firstProcessRoot),
          });
          spawnedChildren.push(preview.child);
          await waitForCapturedStdout(preview, previewReadiness);
          expect(preview.child.exitCode).toBeNull();
          expect(preview.child.signalCode).toBeNull();
          expect(preview.readOutput()).toEqual({
            stdout: previewReadiness,
            stderr: '',
          });
          expect(preview.child.kill(signal)).toBe(true);
          await expect(preview.result).resolves.toEqual({
            code: expectedExitCode,
            signal: null,
            stdout: previewReadiness,
            stderr: '',
          });
          expect(
            (await readFile(join(firstProcessRoot, 'identity.json'))).equals(
              canonicalBefore,
            ),
          ).toBe(true);
          expect(await readdir(firstProcessRoot)).toEqual(['identity.json']);
        };

        await runPackagedPreview('SIGTERM', 143);
        const rotation = await capture(
          process.execPath,
          compiledArguments('rotate'),
          {
            cwd: hostileCwd,
            env: cliEnvironment(firstProcessRoot),
            timeout: 30_000,
          },
        );
        expect(rotation).toEqual({
          ok: true,
          stdout: successOutput('rotate', 2),
          stderr: '',
        });
        const rotatedState = decodeLocalIdentityState(
          await readFile(join(firstProcessRoot, 'identity.json')),
        );
        expect(rotatedState).toMatchObject({
          principalId: firstCandidate.principalId,
          generation: 2,
        });
        expect(rotatedState.credential).not.toBe(firstCandidate.credential);
        await runPackagedPreview('SIGINT', 130);

        const providerBindings = createLocalIdentityDatabaseClient({
          ...configuration.clientConfig,
          application_name: 'context-router-local-identity-preview-inspection',
        });
        await providerBindings.connect();
        try {
          await expect(
            providerBindings.query(
              `SELECT provider, issuer, provider_user_id, user_id
                 FROM public.external_identities
                ORDER BY provider`,
            ),
          ).resolves.toMatchObject({
            rows: [
              {
                provider: 'auth0',
                issuer: 'https://tenant.example.test/',
                provider_user_id: 'subject-one',
                user_id: firstCandidate.principalId,
              },
              {
                provider: 'second-idp',
                issuer: 'https://issuer.example.test/',
                provider_user_id: 'subject-two',
                user_id: firstCandidate.principalId,
              },
            ],
            rowCount: 2,
          });
        } finally {
          await providerBindings.end();
        }
      } finally {
        if (!processBlockerClosed) {
          const cleanupFailures: unknown[] = [];
          try {
            await processBlocker.query('ROLLBACK');
          } catch (error) {
            cleanupFailures.push(error);
          }
          try {
            await processBlocker.end();
          } catch (error) {
            cleanupFailures.push(error);
          }
          if (cleanupFailures.length > 0) {
            throw new AggregateError(
              cleanupFailures,
              'Local identity process blocker cleanup failed',
            );
          }
        }
      }

      await resetIdentityTables(configuration.clientConfig);
      const sameTargetRoot = join(stateParent, 'process-same-target-root');
      const sameTargetBlocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-same-target-blocker',
      });
      await sameTargetBlocker.connect();
      let sameTargetWinner: ReturnType<typeof startCapturedProcess> | undefined;
      let sameTargetBlockerClosed = false;
      try {
        await sameTargetBlocker.query('BEGIN');
        await sameTargetBlocker.query(
          'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
        );
        sameTargetWinner = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(sameTargetRoot),
        });
        spawnedChildren.push(sameTargetWinner.child);
        await waitForCandidate(sameTargetRoot);
        const sameTargetLoser = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(sameTargetRoot),
        });
        spawnedChildren.push(sameTargetLoser.child);
        await expect(sameTargetLoser.result).resolves.toEqual({
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'Local identity command failed\n',
        });
        await sameTargetBlocker.query('ROLLBACK');
        await sameTargetBlocker.end();
        sameTargetBlockerClosed = true;
        await expect(sameTargetWinner.result).resolves.toEqual({
          code: 0,
          signal: null,
          stdout: successOutput('initialize', 1),
          stderr: '',
        });
        expect(await readdir(sameTargetRoot)).toEqual(['identity.json']);
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toMatchObject({
          users: [expect.any(Object)],
          identities: [],
        });
      } finally {
        if (!sameTargetBlockerClosed) {
          const cleanupFailures: unknown[] = [];
          try {
            await sameTargetBlocker.query('ROLLBACK');
          } catch (error) {
            cleanupFailures.push(error);
          }
          try {
            await sameTargetBlocker.end();
          } catch (error) {
            cleanupFailures.push(error);
          }
          if (cleanupFailures.length > 0) {
            throw new AggregateError(
              cleanupFailures,
              'Local identity same-target blocker cleanup failed',
            );
          }
        }
      }

      const databaseAdmin = createLocalIdentityDatabaseClient(
        configuration.clientConfig,
      );
      await databaseAdmin.connect();
      try {
        await databaseAdmin.query('CREATE DATABASE context_router_other');
      } finally {
        await databaseAdmin.end();
      }
      const otherDatabaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/context_router_other`;
      await run(
        'pnpm',
        ['--filter', 'backend', 'exec', 'prisma', 'migrate', 'deploy'],
        {
          env: { ...process.env, DATABASE_URL: otherDatabaseUrl },
          timeout: 90_000,
          failureMessage:
            'Local identity secondary TLS fixture migration failed',
        },
      );
      const otherConfiguration = createLocalIdentityConfiguration({
        LOCAL_IDENTITY_STATE_ROOT: join(stateParent, 'other-placeholder'),
        DATABASE_URL: otherDatabaseUrl,
        LOCAL_DATABASE_TLS_CA_PEM: ca,
      });
      await resetIdentityTables(configuration.clientConfig);
      await resetIdentityTables(otherConfiguration.clientConfig);
      const sharedRoot = join(stateParent, 'process-shared-root');
      const sharedLoserMarker = join(fixtureRoot, 'shared-loser-eexist');
      const sharedWinnerStageReady = join(
        fixtureRoot,
        'shared-winner-stage-ready',
      );
      const sharedWinnerStageRelease = join(
        fixtureRoot,
        'shared-winner-stage-release',
      );
      const sharedLoserStageReady = join(
        fixtureRoot,
        'shared-loser-stage-ready',
      );
      const sharedLoserStageRelease = join(
        fixtureRoot,
        'shared-loser-stage-release',
      );
      const sharedWinnerLinkReady = join(
        fixtureRoot,
        'shared-winner-link-ready',
      );
      const sharedWinnerLinkRelease = join(
        fixtureRoot,
        'shared-winner-link-release',
      );
      const sharedLoserLinkReady = join(fixtureRoot, 'shared-loser-link-ready');
      const sharedLoserLinkRelease = join(
        fixtureRoot,
        'shared-loser-link-release',
      );
      const sharedLoserPreload = join(fixtureRoot, 'eexist-preload.cjs');
      await writeFile(
        sharedLoserPreload,
        `"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const originalOpen = fsp.open;
const originalLink = fsp.link;
const waitCell = new Int32Array(new SharedArrayBuffer(4));
fsp.open = async function (...args) {
  if (path.basename(args[0]).startsWith("identity.stage-operation-") && (args[1] & fs.constants.O_CREAT) !== 0) {
    fs.writeFileSync(process.env.LOCAL_IDENTITY_TEST_STAGE_READY, "ready", { flag: "wx", mode: 0o600 });
    while (!fs.existsSync(process.env.LOCAL_IDENTITY_TEST_STAGE_RELEASE)) {
      Atomics.wait(waitCell, 0, 0, 25);
    }
  }
  return originalOpen(...args);
};
fsp.link = async function (...args) {
  if (path.basename(args[1]) === "identity.operation.json") {
    fs.writeFileSync(process.env.LOCAL_IDENTITY_TEST_LINK_READY, "ready", { flag: "wx", mode: 0o600 });
    while (!fs.existsSync(process.env.LOCAL_IDENTITY_TEST_LINK_RELEASE)) {
      Atomics.wait(waitCell, 0, 0, 25);
    }
  }
  try {
    return await originalLink(...args);
  } catch (error) {
    if (process.env.LOCAL_IDENTITY_TEST_ROLE === "loser" && error && error.code === "EEXIST" && path.basename(args[1]) === "identity.operation.json") {
      fs.writeFileSync(process.env.LOCAL_IDENTITY_TEST_EEXIST_READY, "ready", { flag: "wx", mode: 0o600 });
      for (;;) Atomics.wait(waitCell, 0, 0, 1000);
    }
    throw error;
  }
};
`,
        { mode: 0o600 },
      );
      const sharedBlocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-shared-blocker',
      });
      await sharedBlocker.connect();
      let sharedWinner: ReturnType<typeof startCapturedProcess> | undefined;
      let sharedLoser: ReturnType<typeof startCapturedProcess> | undefined;
      let sharedBlockerClosed = false;
      let sharedPrimaryError: unknown;
      try {
        await sharedBlocker.query('BEGIN');
        await sharedBlocker.query(
          'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
        );
        sharedWinner = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: {
            ...cliEnvironment(sharedRoot),
            NODE_OPTIONS: `--require=${sharedLoserPreload}`,
            LOCAL_IDENTITY_TEST_ROLE: 'winner',
            LOCAL_IDENTITY_TEST_STAGE_READY: sharedWinnerStageReady,
            LOCAL_IDENTITY_TEST_STAGE_RELEASE: sharedWinnerStageRelease,
            LOCAL_IDENTITY_TEST_LINK_READY: sharedWinnerLinkReady,
            LOCAL_IDENTITY_TEST_LINK_RELEASE: sharedWinnerLinkRelease,
          },
        });
        spawnedChildren.push(sharedWinner.child);
        await waitForFile(sharedWinnerStageReady);
        sharedLoser = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: {
            ...cliEnvironment(sharedRoot, otherDatabaseUrl),
            NODE_OPTIONS: `--require=${sharedLoserPreload}`,
            LOCAL_IDENTITY_TEST_ROLE: 'loser',
            LOCAL_IDENTITY_TEST_STAGE_READY: sharedLoserStageReady,
            LOCAL_IDENTITY_TEST_STAGE_RELEASE: sharedLoserStageRelease,
            LOCAL_IDENTITY_TEST_LINK_READY: sharedLoserLinkReady,
            LOCAL_IDENTITY_TEST_LINK_RELEASE: sharedLoserLinkRelease,
            LOCAL_IDENTITY_TEST_EEXIST_READY: sharedLoserMarker,
          },
        });
        spawnedChildren.push(sharedLoser.child);
        await waitForFile(sharedLoserStageReady);
        await writeFile(sharedWinnerStageRelease, 'release', { mode: 0o600 });
        await writeFile(sharedLoserStageRelease, 'release', { mode: 0o600 });
        await waitForFile(sharedWinnerLinkReady);
        await waitForFile(sharedLoserLinkReady);
        await writeFile(sharedWinnerLinkRelease, 'release', { mode: 0o600 });
        const sharedCandidateName = await waitForCandidate(sharedRoot);
        const sharedCandidate = decodeLocalIdentityState(
          await readFile(join(sharedRoot, sharedCandidateName)),
        );
        await writeFile(sharedLoserLinkRelease, 'release', { mode: 0o600 });
        await waitForFile(sharedLoserMarker);
        const loserStages = (await readdir(sharedRoot)).filter((name) =>
          name.startsWith('identity.stage-operation-'),
        );
        expect(loserStages).toHaveLength(1);
        await expect(
          lstat(join(sharedRoot, loserStages[0]), { bigint: true }),
        ).resolves.toMatchObject({ nlink: 1n });
        expect(sharedLoser.child.kill('SIGKILL')).toBe(true);
        await expect(sharedLoser.result).resolves.toMatchObject({
          code: null,
          signal: 'SIGKILL',
        });
        expect(sharedWinner.child.kill('SIGKILL')).toBe(true);
        await expect(sharedWinner.result).resolves.toMatchObject({
          code: null,
          signal: 'SIGKILL',
        });
        await sharedBlocker.query('ROLLBACK');
        await sharedBlocker.end();
        sharedBlockerClosed = true;
        const sharedRecovery = await capture(
          process.execPath,
          compiledArguments('recover-initialize'),
          {
            cwd: hostileCwd,
            env: cliEnvironment(sharedRoot),
            timeout: 30_000,
          },
        );
        expect(sharedRecovery).toEqual({
          ok: true,
          stdout: successOutput('recover-initialize', 1),
          stderr: '',
        });
        const sharedReady = decodeLocalIdentityState(
          await readFile(join(sharedRoot, 'identity.json')),
        );
        expect(sharedReady.databaseTargetId).toBe(
          sharedCandidate.databaseTargetId,
        );
        expect(sharedReady.principalId).toBe(sharedCandidate.principalId);
        expect(sharedReady.generation).toBe(sharedCandidate.generation);
        expect(sharedReady.credential === sharedCandidate.credential).toBe(
          true,
        );
        expect(sharedReady.databaseTargetId).toBe(
          configuration.databaseTargetId,
        );
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toMatchObject({
          users: [{ user_id: sharedCandidate.principalId }],
          identities: [],
        });
        await expect(
          readIdentityRows(otherConfiguration.clientConfig),
        ).resolves.toEqual({ users: [], identities: [] });
      } catch (error) {
        sharedPrimaryError = error;
        throw error;
      } finally {
        for (const processFixture of [sharedLoser, sharedWinner]) {
          if (
            processFixture &&
            processFixture.child.exitCode === null &&
            processFixture.child.signalCode === null
          ) {
            processFixture.child.kill('SIGKILL');
            await processFixture.result.catch(() => undefined);
          }
        }
        if (!sharedBlockerClosed) {
          const cleanupFailures: unknown[] = [];
          try {
            await sharedBlocker.query('ROLLBACK');
          } catch (error) {
            cleanupFailures.push(error);
          }
          try {
            await sharedBlocker.end();
          } catch (error) {
            cleanupFailures.push(error);
          }
          if (cleanupFailures.length > 0 && !sharedPrimaryError) {
            throw new AggregateError(
              cleanupFailures,
              'Local identity shared-root blocker cleanup failed',
            );
          }
        }
      }

      await resetIdentityTables(configuration.clientConfig);
      const killedRoot = join(stateParent, 'process-killed');
      const killedBlocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-kill-blocker',
      });
      await killedBlocker.connect();
      let killedProcess: ReturnType<typeof startCapturedProcess> | undefined;
      let killedCandidate: LocalIdentityState | undefined;
      try {
        await killedBlocker.query('BEGIN');
        await killedBlocker.query(
          'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
        );
        killedProcess = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(killedRoot),
        });
        spawnedChildren.push(killedProcess.child);
        const killedCandidateName = await waitForCandidate(killedRoot);
        killedCandidate = decodeLocalIdentityState(
          await readFile(join(killedRoot, killedCandidateName)),
        );
        expect(killedProcess.child.kill('SIGKILL')).toBe(true);
        await expect(killedProcess.result).resolves.toMatchObject({
          code: null,
          signal: 'SIGKILL',
        });
      } finally {
        await killedBlocker.query('ROLLBACK');
        await killedBlocker.end();
      }
      const afterKill = await acquireEventually(repository);
      await afterKill.release();
      await expect(
        readIdentityRows(configuration.clientConfig),
      ).resolves.toEqual({ users: [], identities: [] });
      const killedRecovery = await capture(
        process.execPath,
        compiledArguments('recover-initialize'),
        {
          cwd: hostileCwd,
          env: cliEnvironment(killedRoot),
          timeout: 30_000,
        },
      );
      expect(killedRecovery).toEqual({
        ok: true,
        stdout: successOutput('recover-initialize', 1),
        stderr: '',
      });
      expect(await readdir(killedRoot)).toEqual(['identity.json']);
      await expect(
        readIdentityRows(configuration.clientConfig),
      ).resolves.toMatchObject({
        users: [{ user_id: killedCandidate?.principalId }],
        identities: [],
      });

      for (const interruption of [
        'SIGINT',
        'SIGTERM',
        'cancel',
        'deadline',
      ] as const) {
        await resetIdentityTables(configuration.clientConfig);
        const interruptionRoot = join(
          stateParent,
          `process-${interruption.toLowerCase()}`,
        );
        const interruptionBlocker = createLocalIdentityDatabaseClient({
          ...configuration.clientConfig,
          application_name: `context-router-local-identity-${interruption}-blocker`,
        });
        await interruptionBlocker.connect();
        let interruptedProcess:
          | ReturnType<typeof startCapturedProcess>
          | undefined;
        let interruptedBackendPid: number | undefined;
        let interruptedCandidate: LocalIdentityState | undefined;
        let interruptedResult:
          | Awaited<ReturnType<typeof startCapturedProcess>['result']>
          | undefined;
        try {
          await interruptionBlocker.query('BEGIN');
          await interruptionBlocker.query(
            'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
          );
          interruptedProcess = startCapturedProcess({
            executable: process.execPath,
            args: compiledArguments('initialize'),
            cwd: hostileCwd,
            env: cliEnvironment(interruptionRoot),
            timeoutMs: 60_000,
          });
          spawnedChildren.push(interruptedProcess.child);
          const candidateName =
            await waitForPublishedCandidateStageRemoval(interruptionRoot);
          interruptedCandidate = decodeLocalIdentityState(
            await readFile(join(interruptionRoot, candidateName)),
          );
          interruptedBackendPid = await waitForBlockedLocalIdentityBackend(
            interruptionBlocker,
            'LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE',
            20_000,
          );

          if (interruption === 'SIGINT' || interruption === 'SIGTERM') {
            expect(interruptedProcess.child.kill(interruption)).toBe(true);
          } else if (interruption === 'cancel') {
            await expect(
              interruptionBlocker.query(
                'SELECT pg_cancel_backend($1) AS cancelled',
                [interruptedBackendPid],
              ),
            ).resolves.toMatchObject({ rows: [{ cancelled: true }] });
          }
          interruptedResult = await interruptedProcess.result;
        } finally {
          if (
            interruptedProcess &&
            interruptedProcess.child.exitCode === null &&
            interruptedProcess.child.signalCode === null
          ) {
            interruptedProcess.child.kill('SIGKILL');
            await interruptedProcess.result.catch(() => undefined);
          }
          await interruptionBlocker.query('ROLLBACK').catch(() => undefined);
          await interruptionBlocker.end().catch(() => undefined);
        }
        if (!interruptedBackendPid || !interruptedCandidate) {
          throw new Error('Local identity interruption fixture incomplete');
        }
        if (interruption === 'SIGINT' || interruption === 'SIGTERM') {
          expect(interruptedResult).toEqual({
            code: null,
            signal: interruption,
            stdout: '',
            stderr: '',
          });
        } else {
          expect(interruptedResult).toEqual({
            code: 1,
            signal: null,
            stdout: '',
            stderr: 'Local identity command failed\n',
          });
        }
        expect(
          JSON.stringify(interruptedResult).includes(
            interruptedCandidate.credential,
          ),
        ).toBe(false);
        const interruptionObserver = createLocalIdentityDatabaseClient({
          ...configuration.clientConfig,
          application_name: `context-router-local-identity-${interruption}-observer`,
        });
        await interruptionObserver.connect();
        try {
          await waitForBackendAbsent(
            interruptionObserver,
            interruptedBackendPid,
          );
        } finally {
          await interruptionObserver.end();
        }
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toEqual({ users: [], identities: [] });
        const afterInterruption = await acquireEventually(repository);
        await afterInterruption.release();
        const recovered = await capture(
          process.execPath,
          compiledArguments('recover-initialize'),
          {
            cwd: hostileCwd,
            env: cliEnvironment(interruptionRoot),
            timeout: 30_000,
          },
        );
        expect(recovered).toEqual({
          ok: true,
          stdout: successOutput('recover-initialize', 1),
          stderr: '',
        });
        expect(await readdir(interruptionRoot)).toEqual(['identity.json']);
        await expect(
          readIdentityRows(configuration.clientConfig),
        ).resolves.toMatchObject({
          users: [{ user_id: interruptedCandidate.principalId }],
          identities: [],
        });
      }

      await resetIdentityTables(configuration.clientConfig);
      const committedKillRoot = join(stateParent, 'committed-kill');
      const committedBarrier = await installCommitBarrier(
        configuration.clientConfig,
      );
      const committedObserver = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-commit-observer',
      });
      await committedObserver.connect();
      let committedProcess: ReturnType<typeof startCapturedProcess> | undefined;
      let committedBackendPid: number | undefined;
      let committedCandidate: LocalIdentityState | undefined;
      const committedTimeline: string[] = [];
      try {
        committedProcess = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(committedKillRoot),
        });
        spawnedChildren.push(committedProcess.child);
        const committedCandidateName =
          await waitForCandidate(committedKillRoot);
        committedCandidate = decodeLocalIdentityState(
          await readFile(join(committedKillRoot, committedCandidateName)),
        );
        committedBackendPid = await committedBarrier.waitForCommit();
        committedTimeline.push('original-at-commit');
        expect(committedProcess.child.pid).toEqual(expect.any(Number));
        expect(committedProcess.child.kill('SIGSTOP')).toBe(true);
        await waitForProcessStopped(committedProcess.child.pid as number);
        committedTimeline.push('original-stopped');
        await committedBarrier.release();
        committedTimeline.push('barrier-released');
        await waitForCommittedPrincipal(
          committedObserver,
          committedCandidate.principalId,
        );
        committedTimeline.push('commit-visible');
        expect((await readdir(committedKillRoot)).sort()).toEqual(
          ['identity.operation.json', committedCandidateName].sort(),
        );
        expect(committedTimeline).not.toContain('recovery-spawned');

        committedTimeline.push('original-kill-requested');
        expect(committedProcess.child.kill('SIGKILL')).toBe(true);
        const committedKilled = await committedProcess.result;
        committedTimeline.push('original-reaped');
        expect(committedKilled).toMatchObject({
          code: null,
          signal: 'SIGKILL',
        });
        expect(
          `${committedKilled.stdout}${committedKilled.stderr}`.includes(
            committedCandidate.credential,
          ),
        ).toBe(false);
        await waitForBackendAbsent(committedObserver, committedBackendPid);
        committedTimeline.push('backend-absent');

        const committedRecovery = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('recover-initialize'),
          cwd: hostileCwd,
          env: cliEnvironment(committedKillRoot),
        });
        spawnedChildren.push(committedRecovery.child);
        committedTimeline.push('recovery-spawned');
        await expect(committedRecovery.result).resolves.toEqual({
          code: 0,
          signal: null,
          stdout: successOutput('recover-initialize', 1),
          stderr: '',
        });
        committedTimeline.push('recovery-complete');
        expect(committedTimeline).toEqual([
          'original-at-commit',
          'original-stopped',
          'barrier-released',
          'commit-visible',
          'original-kill-requested',
          'original-reaped',
          'backend-absent',
          'recovery-spawned',
          'recovery-complete',
        ]);
      } finally {
        if (
          committedProcess &&
          committedProcess.child.exitCode === null &&
          committedProcess.child.signalCode === null
        ) {
          committedProcess.child.kill('SIGKILL');
          await committedProcess.result.catch(() => undefined);
        }
        if (committedBackendPid) {
          await committedBarrier.controller
            .query('SELECT pg_terminate_backend($1)', [committedBackendPid])
            .catch(() => undefined);
        }
        await committedObserver.end();
        await committedBarrier.dispose();
      }
      expect(await readdir(committedKillRoot)).toEqual(['identity.json']);

      const beforeRotation = decodeLocalIdentityState(
        await readFile(join(committedKillRoot, 'identity.json')),
      );
      const rotationBlocker = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name: 'context-router-local-identity-rotation-blocker',
      });
      await rotationBlocker.connect();
      let rotationProcess: ReturnType<typeof startCapturedProcess> | undefined;
      let rotationCandidate: LocalIdentityState | undefined;
      try {
        await rotationBlocker.query('BEGIN');
        await rotationBlocker.query(
          'LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE',
        );
        rotationProcess = startCapturedProcess({
          executable: process.execPath,
          args: compiledArguments('rotate'),
          cwd: hostileCwd,
          env: cliEnvironment(committedKillRoot),
        });
        spawnedChildren.push(rotationProcess.child);
        const rotationCandidateName = await waitForCandidate(committedKillRoot);
        rotationCandidate = decodeLocalIdentityState(
          await readFile(join(committedKillRoot, rotationCandidateName)),
        );
        expect(rotationProcess.child.kill('SIGKILL')).toBe(true);
        await expect(rotationProcess.result).resolves.toMatchObject({
          code: null,
          signal: 'SIGKILL',
        });
      } finally {
        await rotationBlocker.query('ROLLBACK');
        await rotationBlocker.end();
      }
      expect(rotationCandidate?.generation).toBe(2);
      expect(rotationCandidate?.principalId).toBe(beforeRotation.principalId);
      expect(rotationCandidate?.credential === beforeRotation.credential).toBe(
        false,
      );
      const rotationRecovery = await capture(
        process.execPath,
        compiledArguments('recover-rotation'),
        {
          cwd: hostileCwd,
          env: cliEnvironment(committedKillRoot),
          timeout: 30_000,
        },
      );
      expect(rotationRecovery).toEqual({
        ok: true,
        stdout: successOutput('recover-rotation', 1),
        stderr: '',
      });
      const recoveredRotation = decodeLocalIdentityState(
        await readFile(join(committedKillRoot, 'identity.json')),
      );
      expect(recoveredRotation.principalId).toBe(beforeRotation.principalId);
      expect(recoveredRotation.generation).toBe(1);
      expect(recoveredRotation.credential === beforeRotation.credential).toBe(
        true,
      );
      const completedRotation = await capture(
        process.execPath,
        compiledArguments('rotate'),
        {
          cwd: hostileCwd,
          env: cliEnvironment(committedKillRoot),
          timeout: 30_000,
        },
      );
      expect(completedRotation).toEqual({
        ok: true,
        stdout: successOutput('rotate', 2),
        stderr: '',
      });
      const rotatedReady = decodeLocalIdentityState(
        await readFile(join(committedKillRoot, 'identity.json')),
      );
      expect(rotatedReady.principalId).toBe(beforeRotation.principalId);
      expect(rotatedReady.generation).toBe(2);
      expect(rotatedReady.credential === beforeRotation.credential).toBe(false);
      expect(await readdir(committedKillRoot)).toEqual(['identity.json']);

      const mutationBoundaryPreload = join(
        fixtureRoot,
        'mutation-boundary-preload.cjs',
      );
      await writeFile(
        mutationBoundaryPreload,
        `"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(process.env.LOCAL_IDENTITY_STATE_ROOT);
const parent = path.dirname(root);
const target = process.env.LOCAL_IDENTITY_TEST_MUTATION_BOUNDARY;
const marker = process.env.LOCAL_IDENTITY_TEST_MUTATION_MARKER;
const original = {
  mkdir: fsp.mkdir,
  lstat: fsp.lstat,
  open: fsp.open,
  link: fsp.link,
  unlink: fsp.unlink,
  rename: fsp.rename,
};
const waitCell = new Int32Array(new SharedArrayBuffer(4));
let phase = "start";
let pendingVerification = null;

function resolved(value) {
  return path.resolve(String(value));
}

function insideRoot(value) {
  const absolute = resolved(value);
  return absolute === root || absolute.startsWith(root + path.sep);
}

function stopAt(label) {
  if (target !== label) return;
  fs.writeFileSync(marker, label, { flag: "wx", mode: 0o600 });
  for (;;) Atomics.wait(waitCell, 0, 0, 1000);
}

function stageKind(value) {
  const name = path.basename(String(value));
  if (name.startsWith("identity.stage-operation-") && name.endsWith(".tmp")) return "operation";
  if (name.startsWith("identity.stage-") && name.endsWith("-candidate.tmp")) return "candidate";
  return null;
}

function directorySyncLabel(value) {
  const absolute = resolved(value);
  if (absolute === parent && phase === "root-created") return "root.parent-dir-fsync";
  if (absolute !== root) return null;
  if (phase === "operation-linked") return "operation.publish.dir-fsync";
  if (phase === "operation-stage-unlinked") return "operation.stage.dir-fsync";
  if (phase === "candidate-linked") return "candidate.publish.dir-fsync";
  if (phase === "candidate-stage-unlinked") return "candidate.stage.dir-fsync";
  if (phase === "initial-linked") return "initial.publish.dir-fsync";
  if (phase === "initial-candidate-unlinked") return "initial.candidate.dir-fsync";
  if (phase === "rotation-renamed") return "rotation.rename.dir-fsync";
  if (phase === "operation-cleanup-unlinked") return "operation.cleanup.dir-fsync";
  return null;
}

fsp.mkdir = async function (...args) {
  if (resolved(args[0]) === root) stopAt("root.mkdir");
  const result = await original.mkdir(...args);
  if (resolved(args[0]) === root) phase = "root-created";
  return result;
};

fsp.lstat = async function (...args) {
  const file = resolved(args[0]);
  if (pendingVerification && pendingVerification.paths.includes(file)) {
    const label = pendingVerification.label;
    pendingVerification = null;
    stopAt(label);
  }
  return original.lstat(...args);
};

fsp.open = async function (...args) {
  const file = resolved(args[0]);
  const flags = args[1];
  const kind = stageKind(file);
  const creates = typeof flags === "number" && (flags & fs.constants.O_CREAT) !== 0;
  const directory = typeof flags === "number" && (flags & fs.constants.O_DIRECTORY) !== 0;
  if (kind && creates) stopAt(kind + ".stage.create");
  const handle = await original.open(...args);
  return new Proxy(handle, {
    get(instance, property) {
      if (property === "writeFile" && kind && creates) {
        return async (...writeArgs) => {
          stopAt(kind + ".stage.write");
          return instance.writeFile(...writeArgs);
        };
      }
      if (property === "sync") {
        return async (...syncArgs) => {
          const label = kind && creates
            ? kind + ".stage.file-fsync"
            : directory
              ? directorySyncLabel(file)
              : null;
          if (label) stopAt(label);
          return instance.sync(...syncArgs);
        };
      }
      const value = Reflect.get(instance, property, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  });
};

fsp.link = async function (...args) {
  const published = path.basename(String(args[1]));
  let label = null;
  if (insideRoot(args[0]) && insideRoot(args[1])) {
    if (published === "identity.operation.json") label = "operation.publish.link";
    else if (published.startsWith("identity.pending-") || published.startsWith("identity.rotate-")) label = "candidate.publish.link";
    else if (published === "identity.json") label = "initial.publish.link";
  }
  if (label) stopAt(label);
  const result = await original.link(...args);
  if (label === "operation.publish.link") {
    phase = "operation-linked";
    pendingVerification = { label: "operation.publish.verify", paths: [resolved(args[0]), resolved(args[1])] };
  } else if (label === "candidate.publish.link") {
    phase = "candidate-linked";
    pendingVerification = { label: "candidate.publish.verify", paths: [resolved(args[0]), resolved(args[1])] };
  } else if (label === "initial.publish.link") {
    phase = "initial-linked";
    pendingVerification = { label: "initial.publish.verify", paths: [resolved(args[0]), resolved(args[1])] };
  }
  return result;
};

fsp.unlink = async function (...args) {
  const name = path.basename(String(args[0]));
  let label = null;
  if (insideRoot(args[0])) {
    if (name.startsWith("identity.stage-operation-")) label = "operation.stage.unlink";
    else if (name.startsWith("identity.stage-") && name.endsWith("-candidate.tmp")) label = "candidate.stage.unlink";
    else if (name.startsWith("identity.pending-")) label = "initial.candidate.unlink";
    else if (name === "identity.operation.json") label = "operation.cleanup.unlink";
  }
  if (label) stopAt(label);
  const result = await original.unlink(...args);
  if (label === "operation.stage.unlink") phase = "operation-stage-unlinked";
  else if (label === "candidate.stage.unlink") phase = "candidate-stage-unlinked";
  else if (label === "initial.candidate.unlink") phase = "initial-candidate-unlinked";
  else if (label === "operation.cleanup.unlink") phase = "operation-cleanup-unlinked";
  return result;
};

fsp.rename = async function (...args) {
  const isRotation = insideRoot(args[0]) && insideRoot(args[1]) && path.basename(String(args[1])) === "identity.json";
  if (isRotation) stopAt("rotation.rename");
  const result = await original.rename(...args);
  if (isRotation) {
    phase = "rotation-renamed";
    pendingVerification = { label: "rotation.rename.verify", paths: [resolved(args[1])] };
  }
  return result;
};
`,
        { mode: 0o600 },
      );
      await assertTreeExcludesBytes(
        deployedBackend,
        'LOCAL_IDENTITY_TEST_MUTATION_BOUNDARY',
      );

      const boundaryObserver = createLocalIdentityDatabaseClient({
        ...configuration.clientConfig,
        application_name:
          'context-router-local-identity-mutation-boundary-observer',
      });
      await boundaryObserver.connect();
      try {
        for (const scenario of [
          ...INITIALIZE_SESSION_LOSS_BOUNDARIES.map((entry) => ({
            command: 'initialize' as const,
            recovery:
              'recovery' in entry
                ? entry.recovery
                : ('recover-initialize' as const),
            ...entry,
          })),
          ...ROTATION_SESSION_LOSS_BOUNDARIES.map((entry) => ({
            command: 'rotate' as const,
            recovery: 'recover-rotation' as const,
            ...entry,
          })),
        ]) {
          await resetIdentityTables(configuration.clientConfig);
          const safeBoundary = scenario.boundary.replaceAll(
            /[^a-z0-9]+/gu,
            '-',
          );
          const boundaryRoot = join(
            stateParent,
            `session-loss-${scenario.command}-${safeBoundary}`,
          );
          if (scenario.command === 'rotate') {
            const setup = await capture(
              process.execPath,
              compiledArguments('initialize'),
              {
                cwd: hostileCwd,
                env: cliEnvironment(boundaryRoot),
                timeout: 30_000,
              },
            );
            expect(setup).toEqual({
              ok: true,
              stdout: successOutput('initialize', 1),
              stderr: '',
            });
          }

          const marker = join(
            fixtureRoot,
            `session-loss-${scenario.command}-${safeBoundary}.marker`,
          );
          const timeline: string[] = [];
          const interrupted = startCapturedProcess({
            executable: process.execPath,
            args: compiledArguments(scenario.command),
            cwd: hostileCwd,
            env: {
              ...cliEnvironment(boundaryRoot),
              NODE_OPTIONS: `--require=${mutationBoundaryPreload}`,
              LOCAL_IDENTITY_TEST_MUTATION_BOUNDARY: scenario.boundary,
              LOCAL_IDENTITY_TEST_MUTATION_MARKER: marker,
            },
          });
          spawnedChildren.push(interrupted.child);
          await waitForFile(marker);
          expect(await readFile(marker, 'utf8')).toBe(scenario.boundary);
          timeline.push('boundary-observed');

          const backendPid =
            await waitForLocalIdentityProcessBackend(boundaryObserver);
          expect(interrupted.child.pid).toEqual(expect.any(Number));
          expect(interrupted.child.kill('SIGSTOP')).toBe(true);
          await waitForProcessStopped(interrupted.child.pid as number);
          timeline.push('original-stopped');
          const beforeLoss =
            await readOptionalLocalIdentityArtifacts(boundaryRoot);
          const expectedReadyBytes =
            scenario.generation === null || scenario.boundary === 'root.mkdir'
              ? undefined
              : beforeLoss?.find((artifact) =>
                  scenario.command === 'rotate'
                    ? artifact.name === 'identity.json'
                    : artifact.name === 'identity.json' ||
                      artifact.name.startsWith('identity.pending-'),
                )?.bytes;
          if (
            scenario.generation !== null &&
            scenario.boundary !== 'root.mkdir'
          ) {
            expect(Boolean(expectedReadyBytes)).toBe(true);
          }

          const terminated = await boundaryObserver.query(
            'SELECT pg_terminate_backend($1) AS terminated',
            [backendPid],
          );
          expect(terminated.rows).toEqual([{ terminated: true }]);
          await waitForBackendAbsent(boundaryObserver, backendPid);
          timeline.push('backend-terminated');
          const afterLoss =
            await readOptionalLocalIdentityArtifacts(boundaryRoot);
          expect(sameLocalIdentityArtifacts(afterLoss, beforeLoss)).toBe(true);
          const reacquired = await acquireEventually(repository);
          await reacquired.release();
          timeline.push('lock-reacquired-before-reap');
          expect(timeline).not.toContain('recovery-spawned');

          timeline.push('original-kill-requested');
          expect(interrupted.child.kill('SIGKILL')).toBe(true);
          await expect(interrupted.result).resolves.toEqual({
            code: null,
            signal: 'SIGKILL',
            stdout: '',
            stderr: '',
          });
          timeline.push('original-reaped');

          const recovery = startCapturedProcess({
            executable: process.execPath,
            args: compiledArguments(scenario.recovery),
            cwd: hostileCwd,
            env: cliEnvironment(boundaryRoot),
          });
          spawnedChildren.push(recovery.child);
          timeline.push('recovery-spawned');
          await expect(recovery.result).resolves.toEqual({
            code: 0,
            signal: null,
            stdout: successOutput(scenario.recovery, scenario.generation),
            stderr: '',
          });
          timeline.push('recovery-complete');
          expect(timeline).toEqual([
            'boundary-observed',
            'original-stopped',
            'backend-terminated',
            'lock-reacquired-before-reap',
            'original-kill-requested',
            'original-reaped',
            'recovery-spawned',
            'recovery-complete',
          ]);

          if (scenario.generation === null) {
            expect(await readdir(boundaryRoot)).toEqual([]);
            await expect(
              readIdentityRows(configuration.clientConfig),
            ).resolves.toEqual({ users: [], identities: [] });
          } else {
            expect(await readdir(boundaryRoot)).toEqual(['identity.json']);
            const readyBytes = await readFile(
              join(boundaryRoot, 'identity.json'),
            );
            if (expectedReadyBytes) {
              expect(readyBytes.equals(expectedReadyBytes)).toBe(true);
            }
            const ready = decodeLocalIdentityState(readyBytes);
            expect(ready.generation).toBe(scenario.generation);
            await expect(
              readIdentityRows(configuration.clientConfig),
            ).resolves.toMatchObject({
              users: [{ user_id: ready.principalId }],
              identities: [],
            });
          }
        }
      } finally {
        await boundaryObserver.end();
      }
      await verifySealedLocalIdentityStage();
    } catch (error) {
      primaryError = error;
    } finally {
      const cleanupErrors: unknown[] = [];
      for (const child of spawnedChildren) {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await new Promise<void>((resolveStopped) => {
            const timer = setTimeout(resolveStopped, 2_000);
            child.once('close', () => {
              clearTimeout(timer);
              resolveStopped();
            });
          });
          if (child.exitCode === null && child.signalCode === null) {
            cleanupErrors.push(
              new Error('Local identity CLI fixture cleanup failed'),
            );
          }
        }
      }
      try {
        await prisma?.$disconnect();
      } catch (error) {
        cleanupErrors.push(error);
      }
      for (const name of [...startedContainers].reverse()) {
        const removal = await capture('docker', ['rm', '-f', name], {
          timeout: 30_000,
        });
        if (
          !removal.ok &&
          !`${removal.stdout}${removal.stderr}`.includes('No such container')
        ) {
          cleanupErrors.push(
            new Error('Local identity TLS fixture cleanup failed'),
          );
        }
      }
      try {
        await makeTreeOwnerWritable(join(fixtureRoot, 'sealed-stage'));
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        await rm(fixtureRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
      if (primaryError && cleanupErrors.length > 0) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'Local identity TLS fixture and cleanup failed',
        );
      }
      if (primaryError) throw primaryError;
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          cleanupErrors,
          'Local identity TLS fixture cleanup failed',
        );
      }
    }
  });
});
