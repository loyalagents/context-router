#!/usr/bin/env node
import { parseArgs } from 'node:util';

const commands: Record<string, string[]> = {
  upgrade: [],
  list: [],
  provision: ['label', 'out'],
  rotate: ['id', 'out'],
  revoke: ['id'],
  permissions: ['id', 'capabilities', 'targets', 'allow-sensitive'],
  grant: ['id', 'target', 'action', 'effect'],
  backup: ['out'],
  restore: ['from', 'out'],
  serve: ['port'],
  'serve-model': ['port'],
};

function parse(argv: readonly string[]) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      label: { type: 'string' },
      out: { type: 'string' },
      id: { type: 'string' },
      capabilities: { type: 'string' },
      targets: { type: 'string' },
      'allow-sensitive': { type: 'boolean' },
      target: { type: 'string' },
      action: { type: 'string' },
      effect: { type: 'string' },
      from: { type: 'string' },
      port: { type: 'string' },
    },
  });
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    !Object.prototype.hasOwnProperty.call(commands, command) ||
    Object.keys(values).some((key) => !commands[command].includes(key))
  )
    throw new Error();
  for (const key of commands[command])
    if (!['allow-sensitive', 'port'].includes(key) && values[key] === undefined)
      throw new Error();
  if (
    values.port !== undefined &&
    (!/^(0|[1-9][0-9]{0,4})$/.test(values.port) || Number(values.port) > 65535)
  )
    throw new Error();
  return { command, values };
}

async function serve(port: number, configuredModel: boolean): Promise<number> {
  const [{ createLocalDatabaseConfiguration }, { createLocalMcpApplication }] =
    await Promise.all([
      import('./config/local-database.config'),
      import('./bootstrap/local-mcp'),
    ]);
  let signal: 'SIGINT' | 'SIGTERM' | undefined, wake: () => void;
  const received = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const sigint = () => {
      signal ??= 'SIGINT';
      wake();
    },
    sigterm = () => {
      signal ??= 'SIGTERM';
      wake();
    };
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  const keepAlive = setInterval(() => {}, 60000);
  let startup: ReturnType<typeof createLocalMcpApplication>;
  let close: Promise<void>;
  const shutdown = async () => {
    close ??= startup
      ? startup.then(
          (runtime) => runtime.close(),
          () => {},
        )
      : Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        close,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error()), 10000);
        }),
      ]);
    } catch {
      process.stderr.write('Local MCP shutdown failed\n');
      process.exit(1); // This CLI owns only itself, never the manual inference process.
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const configuration = createLocalDatabaseConfiguration();
    const model = configuredModel
      ? (
          await import('./config/local-model.config')
        ).createLocalModelSelection()
      : undefined;
    startup = createLocalMcpApplication(configuration, { port, model });
    const runtime = await Promise.race([
      startup,
      received.then(() => undefined),
    ]);
    if (runtime && !signal) {
      process.stdout.write(
        JSON.stringify({
          type: 'context-router.local-mcp.ready',
          version: 1,
          host: '127.0.0.1',
          port: runtime.port,
          modelConfigured: configuredModel,
        }) + '\n',
      );
      await received;
    }
    await shutdown();
    return signal === 'SIGINT' ? 130 : 143;
  } catch {
    await shutdown();
    throw new Error('Local MCP command failed');
  } finally {
    clearInterval(keepAlive);
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
  }
}

export async function runLocalMcp(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch {
    process.stderr.write('Local MCP invalid command\n');
    return 2;
  }
  const { command, values } = parsed;
  try {
    const { clearLocalIdentityAmbientDriverSelection } = await import(
      './config/local-identity.config'
    );
    clearLocalIdentityAmbientDriverSelection();
    if (command === 'serve' || command === 'serve-model')
      return await serve(
        Number(values.port ?? '8787'),
        command === 'serve-model',
      );
    let result: unknown;
    if (command === 'restore') {
      const { SqliteBackup } = await import(
        './infrastructure/storage/sqlite/sqlite-backup'
      );
      await new SqliteBackup().restore(values.from, values.out);
      result = 'restored';
    } else {
      const [
        { createLocalDatabaseConfiguration },
        { createSqliteIdentityRuntime },
        { SqliteMcpCredentials },
      ] = await Promise.all([
        import('./config/local-database.config'),
        import('./infrastructure/storage/sqlite/sqlite-local-runtime'),
        import('./infrastructure/storage/sqlite/sqlite-mcp-credentials'),
      ]);
      const { database, service } = createSqliteIdentityRuntime(
        createLocalDatabaseConfiguration(),
      );
      const ready = await service.verifyReadyState();
      const store = new SqliteMcpCredentials(database, ready.state.principalId);
      switch (command) {
        case 'upgrade':
          result = store.upgrade();
          break;
        case 'list':
          result = store.list();
          break;
        case 'provision':
          result = store.provision(values.label, values.out);
          break;
        case 'rotate':
          result = store.rotate(values.id, values.out);
          break;
        case 'revoke':
          result = store.revoke(values.id);
          break;
        case 'permissions':
          result = store.permissions(values.id, {
            capabilities: values.capabilities
              ? values.capabilities.split(',')
              : [],
            targets: values.targets ? values.targets.split(',') : [],
            allowSensitive: values['allow-sensitive'] === true,
          });
          break;
        case 'grant':
          store.grant(values.id, values.target, values.action, values.effect);
          result = 'updated';
          break;
        case 'backup': {
          const { SqliteBackup } = await import(
            './infrastructure/storage/sqlite/sqlite-backup'
          );
          await new SqliteBackup().create(database, values.out);
          result = 'backed-up';
          break;
        }
      }
    }
    process.stdout.write(
      JSON.stringify({
        type: 'context-router.local-mcp.admin',
        version: 1,
        operation: command,
        result,
      }) + '\n',
    );
    return 0;
  } catch {
    process.stderr.write('Local MCP command failed\n');
    return 1;
  }
}
if (require.main === module)
  void runLocalMcp().then((code) => {
    process.exitCode = code;
  });
