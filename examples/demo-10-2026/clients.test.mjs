import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clientLaunchSpec, preflightClient } from './clients.mjs';

test('launch specs confine config/workspace and omit ambient secrets, tools and source data', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-clients-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'stub.mjs');
  await fs.writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));`, { mode: 0o700 });
  for (const command of ['claude', 'codex']) {
    for (const part of ['workspace', 'home', 'config']) await fs.mkdir(path.join(root, `${command}-${part}`), { mode: 0o700 });
    const spec = clientLaunchSpec({ command, root, mcpPort: 8788, dataset: 'custom' }, { executable });
    const result = spawnSync(spec.executable, spec.args, { cwd: spec.cwd, env: { ...spec.env, CR_DEMO_TOKEN: 'synthetic-token' }, encoding: 'utf8' });
    assert.equal(result.status, 0);
    const actual = JSON.parse(result.stdout);
    assert.deepEqual(actual.args, spec.args);
    assert.equal(actual.cwd, path.join(root, `${command}-workspace`));
    assert.equal(actual.env.HOME, path.join(root, `${command}-home`));
    assert.equal(actual.env.CR_DEMO_TOKEN, 'synthetic-token');
    for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS', 'DATABASE_URL', 'HTTPS_PROXY', 'CODEX_THREAD_ID']) assert.equal(actual.env[key], undefined);
    assert.equal(JSON.stringify(actual.args).includes('synthetic-token'), false);
    assert.equal(JSON.stringify(actual.args).includes('001_user_001'), false);
    assert.deepEqual(await fs.readdir(spec.cwd), []);
    if (command === 'claude') {
      assert.ok(spec.args.includes('--bare')); assert.ok(spec.args.includes('--strict-mcp-config'));
      assert.equal(spec.args[spec.args.indexOf('--tools') + 1], '');
    } else {
      assert.ok(spec.args.includes('features.shell_tool=false'));
      assert.ok(spec.args.includes('tools.view_image=false'));
      assert.ok(spec.args.includes('features.apps=false'));
      assert.equal(spec.env.CODEX_HOME, path.join(root, 'codex-config'));
    }
  }
});

test('unsupported installed controls fail closed during offline preflight', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-preflight-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'unsupported');
  await fs.writeFile(executable, '#!/bin/sh\necho unsupported\n', { mode: 0o700 });
  const spec = clientLaunchSpec({ command: 'codex', root, dataset: 'demo001', mcpPort: 8788 }, { executable });
  assert.throws(() => preflightClient(spec), /unsupported|Unsupported/);
});

 test('Codex roles have independent homes, credentials and tool lists', () => {
  const root = '/private/tmp/example';
  const a = clientLaunchSpec({ command: 'codex', agent: 'a', root, mcpPort: 8788, dataset: 'demo001' }, { executable: '/bin/false' });
  const b = clientLaunchSpec({ command: 'codex', agent: 'b', root, mcpPort: 8788, dataset: 'demo001' }, { executable: '/bin/false' });
  assert.notEqual(a.env.CODEX_HOME, b.env.CODEX_HOME);
  assert.notEqual(a.env.HOME, b.env.HOME);
  assert.notEqual(a.cwd, b.cwd);
  assert.equal(a.credential, 'agent-a.token'); assert.equal(b.credential, 'agent-b.token');
  assert.ok(a.args.some(x => x.includes('mutatePreferences')));
  assert.equal(b.args.some(x => x.includes('mutatePreferences')), false);
 });

test('documented ignored unified-exec opt-out is accepted only with shell exposure disabled', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-gates-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const p of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `codex-${p}`));
  const executable = path.join(root, 'client');
  const spec = clientLaunchSpec({ command: 'codex', root, dataset: 'demo001', mcpPort: 8788 }, { executable });
  const names = spec.args.filter(arg => /^features\..*=false$/.test(arg)).map(arg => arg.slice(9, -6));
  for (const shell of ['false', 'true', 'missing']) {
    const features = names.filter(name => shell !== 'missing' || name !== 'shell_tool').map(name => `${name} stable ${name === 'unified_exec' ? 'true' : name === 'shell_tool' ? shell : 'false'}`).join('\n');
    await fs.writeFile(executable, `#!${process.execPath}\nconst a=process.argv.slice(2);\nif(a.includes('--version'))console.log('codex-cli 0.160.0');\nelse if(a.includes('--help'))console.log('--no-daemon --strict-config --sandbox');\nelse if(a.includes('mcp'))console.log(JSON.stringify([{name:'context_router_demo',transport:{bearer_token_env_var:'CR_DEMO_TOKEN'}}]));\nelse console.log(${JSON.stringify(features)});\n`, { mode: 0o700 });
    if (shell === 'false') assert.equal(preflightClient(spec).offlineControls, 'passed');
    else assert.throws(() => preflightClient(spec), /native-tool controls/);
  }
});
