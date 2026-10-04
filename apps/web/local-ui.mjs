#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
export function parseLocalUiArgs(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: true,
    options: {
      'unlock-dir': { type: 'string' },
      port: { type: 'string' },
      'mcp-port': { type: 'string' },
    },
  });
  if (
    positionals.length !== 1 ||
    !['serve', 'serve-model'].includes(positionals[0])
  )
    throw new Error();
  const exportRoot = values['unlock-dir'];
  if (
    typeof exportRoot !== 'string' ||
    !path.isAbsolute(exportRoot) ||
    path.resolve(exportRoot) !== exportRoot ||
    /[\u0000-\u001f\u007f]/u.test(exportRoot)
  )
    throw new Error();
  const port = values.port ?? '3002',
    mcpPort = values['mcp-port'] ?? '8787';
  for (const value of [port, mcpPort])
    if (!/^(0|[1-9][0-9]{0,4})$/.test(value) || Number(value) > 65535)
      throw new Error();
  if (port !== '0' && port === mcpPort) throw new Error();
  return {
    command: positionals[0],
    exportRoot,
    port: Number(port),
    mcpPort: Number(mcpPort),
  };
}

export async function runLocalUi(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseLocalUiArgs(argv);
  } catch {
    process.stderr.write('Local UI invalid command\n');
    return 2;
  }
  process.env.CONTEXT_ROUTER_WEB_MODE = 'local';
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  let receivedSignal, signalWake;
  const received = new Promise((resolve) => {
    signalWake = resolve;
  });
  const sigint = () => {
    receivedSignal ??= 'SIGINT';
    signalWake();
  };
  const sigterm = () => {
    receivedSignal ??= 'SIGTERM';
    signalWake();
  };
  process.on('SIGINT', sigint);
  process.on('SIGTERM', sigterm);
  let web, runtime, input, startup, closing;
  const close = () =>
    (closing ??= (async () => {
      input?.close();
      if (startup) await startup.catch(() => {});
      try {
        await runtime?.close();
      } finally {
        await web?.close();
      }
    })());
  const shutdown = async () => {
    let timer;
    try {
      await Promise.race([
        close(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error()), 10000);
        }),
      ]);
    } catch {
      process.stderr.write('Local UI shutdown failed\n');
      process.exit(1);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    startup = (async () => {
      require('backend/dist/config/local-identity.config.js').clearLocalIdentityAmbientDriverSelection();
      const configuration =
        require('backend/dist/config/local-database.config.js').createLocalDatabaseConfiguration();
      const model =
        parsed.command === 'serve-model'
          ? require('backend/dist/config/local-model.config.js').createLocalModelSelection()
          : undefined;
      const next = (await import('next')).default;
      web = next({
        dev: false,
        dir: webRoot,
        hostname: '127.0.0.1',
        port: parsed.port,
      });
      await web.prepare();
      if (receivedSignal) return;
      const {
        createLocalUiApplication,
      } = require('backend/dist/bootstrap/local-ui.js');
      runtime = await createLocalUiApplication(configuration, {
        port: parsed.port,
        mcpPort: parsed.mcpPort,
        exportRoot: parsed.exportRoot,
        model,
        webHandler: web.getRequestHandler(),
      });
    })();
    await Promise.race([startup, received]);
    if (!receivedSignal && runtime) {
      const delivery = runtime.issueUnlock();
      process.stdout.write(
        JSON.stringify({
          type: 'context-router.local-ui.ready',
          version: 1,
          origin: `http://127.0.0.1:${runtime.port}`,
          mcpOrigin: `http://127.0.0.1:${runtime.mcpPort}/mcp`,
          unlockFile: delivery.path,
          modelConfigured: parsed.command === 'serve-model',
        }) + '\n',
      );
      input = createInterface({ input: process.stdin, terminal: false });
      input.on('line', (line) => {
        if (line !== 'unlock' || receivedSignal) return;
        try {
          const nextDelivery = runtime.issueUnlock();
          process.stdout.write(
            JSON.stringify({
              type: 'context-router.local-ui.unlock',
              version: 1,
              unlockFile: nextDelivery.path,
              origin: `http://127.0.0.1:${runtime.port}`,
            }) + '\n',
          );
        } catch {
          process.stderr.write('Local UI unlock export failed\n');
        }
      });
      // EOF closes only the command input; listeners/model owner remain running.
      await received;
    }
    await shutdown();
    return receivedSignal === 'SIGINT' ? 130 : 143;
  } catch {
    await shutdown();
    process.stderr.write('Local UI startup failed\n');
    return 1;
  } finally {
    process.off('SIGINT', sigint);
    process.off('SIGTERM', sigterm);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runLocalUi();
}
