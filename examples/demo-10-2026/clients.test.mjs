import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { clientLaunchSpec, preflightClient, loginSpec } from './clients.mjs';
import { parseOptions } from './demo.mjs';

test('CLI discovery includes the running Node installation used by npm global installs', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-nvm-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'codex');
  await fs.writeFile(executable, '#!/bin/sh\necho codex-cli 0.160.0\n', { mode: 0o700 });
  const spec = clientLaunchSpec({ command: 'codex', root, dataset: 'demo001', mcpPort: 1 }, { nodeExecutable: path.join(root, 'node') });
  assert.equal(spec.executable, executable);
});

test('client version preflight rejects suffixes and larger versions containing the pinned version', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-version-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'claude-workspace'));
  const executable = path.join(root, 'client');
  const spec = clientLaunchSpec({ command: 'claude', root, dataset: 'demo001', mcpPort: 1 }, { executable });
  for (const version of ['2.1.299', '2.1.299 (Claude Code)', '2.1.299-alpha', '12.1.299', '2.1.2990']) {
    await fs.writeFile(executable, `#!${process.execPath}\nif(process.argv.includes('--bg')||process.argv.includes('--background')){console.error(\"'\"+process.argv[2]+\"' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\");process.exit(1);}console.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : '--bare --strict-mcp-config --tools --setting-sources --disable-slash-commands --no-chrome');\n`, { mode: 0o700 });
    if (['2.1.299', '2.1.299 (Claude Code)'].includes(version)) assert.equal(preflightClient(spec).offlineControls, 'passed');
    else assert.throws(() => preflightClient(spec), /Unsupported client version/);
  }
});
test('durable profiles stay stable while endpoint and selected-generation credential remain pinned', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-profile-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const profiles = path.join(root, 'profiles'); await fs.mkdir(profiles);
  const executable = path.join(root, 'stub.mjs');
  await fs.writeFile(executable, `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2),env:process.env,cwd:process.cwd()}));`, { mode: 0o700 });
  for (const prefix of ['codex-a', 'claude', 'claude-a']) for (const suffix of ['home', 'config', 'workspace']) await fs.mkdir(path.join(profiles, `${prefix}-${suffix}`));
  const options = { command: 'codex', agent: 'a', root: path.join(root, 'generation-one'), profileRoot: profiles, dataset: 'fresh', mcpPort: 8789 };
  const first = clientLaunchSpec(options, { executable });
  const next = clientLaunchSpec({ ...options, root: path.join(root, 'generation-two'), mcpPort: 8790 }, { executable });
  assert.equal(first.env.CODEX_HOME, next.env.CODEX_HOME); assert.equal(first.cwd, path.join(profiles, 'codex-a-workspace'));
  assert.equal(first.credentialFile, path.join(options.root, 'exports/agent-a.token'));
  assert.equal(next.credentialFile, path.join(root, 'generation-two/exports/agent-a.token'));
  assert.ok(first.args.includes('mcp_servers.context_router_demo.url="http://127.0.0.1:8789/mcp"'));
  const login = loginSpec(first);
  const result = spawnSync(login.executable, login.args, { cwd: login.cwd, env: login.env, encoding: 'utf8' });
  assert.equal(result.status, 0); const actual = JSON.parse(result.stdout);
  assert.deepEqual(actual.args, ['-c', 'cli_auth_credentials_store="file"', 'login']);
  assert.equal(actual.env.CODEX_HOME, first.env.CODEX_HOME); assert.equal(actual.env.CR_DEMO_TOKEN, undefined);
  assert.equal(actual.args.some(x => x.includes('mcp')), false);
  const a = clientLaunchSpec({ ...options, command: 'claude', auth: 'subscription' }, { executable });
  const b = clientLaunchSpec({ ...options, command: 'claude', auth: 'subscription', agent: 'b' }, { executable });
  assert.notEqual(a.env.CLAUDE_CONFIG_DIR, b.env.CLAUDE_CONFIG_DIR);
  assert.equal(b.env.CLAUDE_CONFIG_DIR, path.join(profiles, 'claude-config'));
});

test('Claude subscription B selects its read credential and isolated OAuth configuration', () => {
  const options = parseOptions(['claude', '--root', '/private/tmp/example', '--agent', 'b', '--auth', 'subscription']);
  const spec = clientLaunchSpec(options, { executable: '/bin/false' });
  assert.equal(spec.agent, 'b'); assert.equal(spec.auth, 'subscription'); assert.equal(spec.credential, 'agent-b.token');
  assert.equal(spec.env.HOME, process.platform === 'darwin' ? os.userInfo().homedir : '/private/tmp/example/claude-home');
  assert.equal(spec.env.CLAUDE_CONFIG_DIR, '/private/tmp/example/claude-config');
  assert.equal(spec.env.ANTHROPIC_CONFIG_DIR, '/private/tmp/example/claude-config/anthropic');
  assert.equal(spec.env.TMPDIR, '/private/tmp/example/claude-home');
  assert.equal(spec.cwd, '/private/tmp/example/claude-workspace');
  assert.ok(spec.args.includes('--restricted')); assert.equal(spec.args.includes('--bare'), false);
  assert.equal(spec.args[spec.args.indexOf('--tools') + 1], '');
  assert.equal(spec.args[spec.args.indexOf('--setting-sources') + 1], '');
  assert.deepEqual(JSON.parse(spec.args[spec.args.indexOf('--settings') + 1]), { disableAllHooks: true, forceLoginMethod: 'claudeai' });
  const mcp = JSON.parse(spec.args[spec.args.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(mcp.mcpServers), ['context_router_demo']);
  assert.equal(mcp.mcpServers.context_router_demo.headers.Authorization, 'Bearer ${CR_DEMO_TOKEN}');
  assert.equal(spec.env.ENABLE_CLAUDEAI_MCP_SERVERS, 'false');
  assert.equal(spec.env.CLAUDE_CODE_AUTO_CONNECT_IDE, 'false');
  assert.equal(spec.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(spec.env.DISABLE_AUTOUPDATER, '1');
  assert.equal(spec.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
  assert.equal(spec.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(spec.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1');
  for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SIMPLE']) assert.equal(spec.env[key], undefined);
  const legacy = clientLaunchSpec({ ...options, agent: undefined, auth: undefined }, { executable: '/bin/false' });
  assert.equal(legacy.agent, 'a'); assert.equal(legacy.auth, 'api-key'); assert.ok(legacy.args.includes('--bare'));
  assert.equal(legacy.env.HOME, '/private/tmp/example/claude-home');
  assert.equal(legacy.env.ANTHROPIC_CONFIG_DIR, undefined);
  for (const args of [ ['codex', '--auth', 'subscription'], ['claude', '--auth', 'unknown'], ['serve', '--agent', 'b'] ]) {
    assert.throws(() => parseOptions([...args, '--root', '/private/tmp/example']));
  }
});

test('Claude subscription preflight requires restricted mode and exact fresh auth-status result', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-pro-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const p of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `claude-${p}`));
  const executable = path.join(root, 'client');
  const observedFile = path.join(root, 'observed.json');
  const spec = clientLaunchSpec({ command: 'claude', auth: 'subscription', agent: 'b', root, dataset: 'demo001', mcpPort: 1 }, { executable });
  for (const behavior of ['valid', 'missing-flag', 'logged-in', 'unexpected-error']) {
    await fs.writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';\nconst a=process.argv.slice(2);\nif(a.includes('--bg')||a.includes('--background')){console.error(\"'\"+a[0]+\"' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\");process.exit(1);}\nif(a.includes('--version'))console.log('2.1.299');\nelse if(a.includes('--help'))console.log('--strict-mcp-config --tools --setting-sources --disable-slash-commands --no-chrome ${behavior === 'missing-flag' ? '' : '--restricted'}');\nelse { fs.writeFileSync(${JSON.stringify(observedFile)},JSON.stringify({env:process.env,cwd:process.cwd()}));console.log(${JSON.stringify(behavior)}==='unexpected-error'?'error':JSON.stringify({loggedIn:${behavior === 'logged-in'},authMethod:'none',apiProvider:'firstParty',analyticsDisabled:true,configDirectory:process.env.CLAUDE_CONFIG_DIR}));process.exitCode=1; }\n`, { mode: 0o700 });
    if (behavior === 'valid') {
      assert.equal(preflightClient(spec).offlineControls, 'passed');
      const observed = JSON.parse(await fs.readFile(observedFile, 'utf8'));
      assert.notEqual(observed.env.CLAUDE_CONFIG_DIR, spec.env.CLAUDE_CONFIG_DIR);
      assert.equal(observed.env.ANTHROPIC_CONFIG_DIR, path.join(observed.env.CLAUDE_CONFIG_DIR, 'anthropic'));
      const probeRoot = path.dirname(observed.env.CLAUDE_CONFIG_DIR);
      assert.equal(observed.env.HOME, process.platform === 'darwin' ? os.userInfo().homedir : path.join(probeRoot, 'home'));
      assert.equal(observed.env.TMPDIR, path.join(probeRoot, 'home'));
      assert.equal(observed.cwd, path.join(probeRoot, 'workspace'));
      await assert.rejects(fs.access(probeRoot));
    }
    else assert.throws(() => preflightClient(spec), /controls|auth-status/);
  }
});

test('installed Claude accepts full subscription B argv in fresh unauthenticated configuration', { skip: process.env.CR_DEMO_TEST_CLAUDE !== '1' }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-real-pro-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const suffix of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `claude-${suffix}`), { mode: 0o700 });
  const executable = process.env.CR_DEMO_TEST_CLAUDE_EXECUTABLE;
  if (executable) { assert.ok(path.isAbsolute(executable)); await fs.access(executable, fs.constants.X_OK); }
  const spec = clientLaunchSpec({ command: 'claude', auth: 'subscription', agent: 'b', root, dataset: 'demo001', mcpPort: 1 }, { executable });
  const result = spawnSync(spec.executable, [...spec.args, 'auth', 'status', '--json'], { cwd: spec.cwd, env: spec.env, input: '', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1); assert.equal(result.stderr, '');
  const status = JSON.parse(result.stdout);
  assert.equal(status.loggedIn, false); assert.equal(status.authMethod, 'none'); assert.equal(status.apiProvider, 'firstParty');
  assert.equal(status.analyticsDisabled, true); assert.equal(status.configDirectory, spec.env.CLAUDE_CONFIG_DIR);
  if (process.platform === 'darwin') {
    // Read the default keychain path only; never query credentials or change it.
    const keychain = spawnSync('/usr/bin/security', ['default-keychain', '-d', 'user'], { env: spec.env, encoding: 'utf8', timeout: 5000 });
    assert.equal(keychain.error, undefined); assert.equal(keychain.signal, null);
    assert.equal(keychain.status, 0); assert.equal(keychain.stderr, '');
    assert.match(keychain.stdout.trim(), /^"\/.+"$/);
  }
  assert.equal(preflightClient(spec).offlineControls, 'passed');
  assert.throws(() => preflightClient({ ...spec, args: [...spec.args, '--demo-unknown-option'] }), /auth-status/);
});

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
      assert.ok(spec.args.includes('features.view_image=false'));
      assert.equal(spec.args.includes('tools.view_image=false'), false);
      assert.ok(spec.args.includes('features.apps=false'));
      assert.equal(spec.env.CODEX_HOME, path.join(root, 'codex-config'));
    }
  }
  const subscription = clientLaunchSpec({ command: 'claude', auth: 'subscription', agent: 'b', root, mcpPort: 8788, dataset: 'custom' }, { executable });
  const result = spawnSync(subscription.executable, subscription.args, { cwd: subscription.cwd, env: subscription.env, encoding: 'utf8' });
  assert.equal(result.status, 0);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.env.HOME, process.platform === 'darwin' ? os.userInfo().homedir : path.join(root, 'claude-home'));
  assert.equal(actual.env.CLAUDE_CONFIG_DIR, path.join(root, 'claude-config'));
  assert.equal(actual.env.ANTHROPIC_CONFIG_DIR, path.join(root, 'claude-config', 'anthropic'));
  assert.equal(actual.env.TMPDIR, path.join(root, 'claude-home'));
  assert.equal(actual.cwd, path.join(root, 'claude-workspace'));
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_PROFILE', 'CLAUDE_CODE_OAUTH_TOKEN']) assert.equal(actual.env[key], undefined);
  for (const suffix of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `codex-a-${suffix}`), { mode: 0o700 });
  const writer = clientLaunchSpec({ command: 'codex', agent: 'a', root, mcpPort: 8788, dataset: 'custom' }, { executable });
  const writerResult = spawnSync(writer.executable, writer.args, { cwd: writer.cwd, env: writer.env, encoding: 'utf8' });
  assert.equal(writerResult.status, 0);
  const writerArgs = JSON.parse(writerResult.stdout).args;
  assert.equal(writerArgs[writerArgs.indexOf('--ask-for-approval') + 1], 'on-request');
  assert.ok(writerArgs.includes('approvals_reviewer="user"'));
  assert.ok(writerArgs.includes('mcp_servers.context_router_demo.tools.mutatePreferences.approval_mode="prompt"'));
  assert.equal(writerArgs[writerArgs.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(writerArgs.includes('features.shell_tool=false'));
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
  assert.equal(a.args[a.args.indexOf('--ask-for-approval') + 1], 'on-request');
  assert.equal(b.args[b.args.indexOf('--ask-for-approval') + 1], 'never');
  assert.ok(a.args.includes('approvals_reviewer="user"'));
  assert.ok(a.args.includes('mcp_servers.context_router_demo.tools.mutatePreferences.approval_mode="prompt"'));
  assert.equal(b.args.some(x => x.startsWith('approvals_reviewer=')), false);
  assert.deepEqual(a.args.filter(x => x.startsWith('features.')), b.args.filter(x => x.startsWith('features.')));
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
    await fs.writeFile(executable, `#!${process.execPath}\nconst a=process.argv.slice(2);\nif(a.includes('--bg')||a.includes('--background')){console.error(\"'\"+a[0]+\"' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\");process.exit(1);}\nif(a.includes('--version'))console.log('codex-cli 0.160.0');\nelse if(a.includes('--help'))console.log('--no-daemon --strict-config --sandbox');\nelse if(a.includes('--strict-config')){console.error('Error: stdin is not a terminal');process.exitCode=1;}\nelse if(a.includes('mcp'))console.log(JSON.stringify([{name:'context_router_demo',transport:{bearer_token_env_var:'CR_DEMO_TOKEN'}}]));\nelse console.log(${JSON.stringify(features)});\n`, { mode: 0o700 });
    if (shell === 'false') assert.equal(preflightClient(spec).offlineControls, 'passed');
    else assert.throws(() => preflightClient(spec), /native-tool controls/);
  }
});

test('strict preflight rejects an unknown override that non-strict readers ignore', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-strict-gate-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const p of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `codex-${p}`));
  const executable = path.join(root, 'client');
  const spec = clientLaunchSpec({ command: 'codex', root, dataset: 'demo001', mcpPort: 8788 }, { executable });
  const features = spec.args.filter(arg => /^features\..*=false$/.test(arg)).map(arg => `${arg.slice(9, -6)} stable false`).join('\n');
  await fs.writeFile(executable, `#!${process.execPath}\nconst a=process.argv.slice(2);\nif(a.includes('--bg')||a.includes('--background')){console.error(\"'\"+a[0]+\"' is disabled by CLAUDE_CODE_DISABLE_AGENT_VIEW.\");process.exit(1);}\nif(a.includes('--version'))console.log('codex-cli 0.160.0');\nelse if(a.includes('--help'))console.log('--no-daemon --strict-config --sandbox');\nelse if(a.includes('--strict-config')){console.error(a.includes('demo_unknown_override=true')?'Error loading config.toml: unknown configuration field demo_unknown_override':'Error: stdin is not a terminal');process.exitCode=1;}\nelse if(a.includes('mcp'))console.log(JSON.stringify([{name:'context_router_demo',transport:{bearer_token_env_var:'CR_DEMO_TOKEN'}}]));\nelse console.log(${JSON.stringify(features)});\n`, { mode: 0o700 });
  assert.equal(preflightClient(spec).offlineControls, 'passed');
  const unknown = { ...spec, args: [...spec.args.slice(0, -1), '-c', 'demo_unknown_override=true', spec.args.at(-1)] };
  assert.throws(() => preflightClient(unknown), /strict startup/);
});

test('installed Codex accepts complete strict A/B launch argv before the nonterminal boundary', { skip: process.env.CR_DEMO_TEST_CODEX !== '1' }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cr-demo-real-strict-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const role of ['codex-a', 'codex']) for (const suffix of ['home', 'config', 'workspace']) await fs.mkdir(path.join(root, `${role}-${suffix}`), { mode: 0o700 });
  for (const agent of ['a', 'b']) {
    const executable = process.env.CR_DEMO_TEST_CODEX_EXECUTABLE;
    if (executable) { assert.ok(path.isAbsolute(executable)); await fs.access(executable, fs.constants.X_OK); }
    const spec = clientLaunchSpec({ command: 'codex', agent, root, mcpPort: 1, dataset: 'demo001' }, { executable });
    assert.equal(spec.args[spec.args.indexOf('--ask-for-approval') + 1], agent === 'a' ? 'on-request' : 'never');
    const run = args => spawnSync(spec.executable, args, { cwd: spec.cwd, env: spec.env, input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });
    assert.equal(run(['--version']).stdout.trim(), 'codex-cli 0.160.0');
    const strict = run(spec.args);
    assert.equal(strict.error, undefined); assert.equal(strict.signal, null); assert.equal(strict.status, 1);
    assert.equal(strict.stdout, ''); assert.equal(strict.stderr, 'Error: stdin is not a terminal\n');
    const invalidArgs = [...spec.args.slice(0, -1), '-c', 'demo_unknown_override=true', spec.args.at(-1)];
    const invalid = run(invalidArgs);
    assert.equal(invalid.status, 1); assert.match(invalid.stderr, /unknown configuration field `demo_unknown_override`/);
    assert.equal(preflightClient(spec).offlineControls, 'passed');
    assert.throws(() => preflightClient({ ...spec, args: invalidArgs }), /strict startup/);
    await assert.rejects(fs.access(path.join(spec.env.CODEX_HOME, 'auth.json')));
  }
});

test('qualified interactive clients receive an explicit terminal type through the clean environment',()=>{
 for(const command of ['claude','codex']){
  const spec=clientLaunchSpec({command,root:'/owned/demo',dataset:'demo001',mcpPort:3213},{executable:'/owned/native'});
  assert.equal(spec.env.TERM,'xterm-256color');assert.equal(spec.env.ANTHROPIC_API_KEY,undefined);
 }
});
