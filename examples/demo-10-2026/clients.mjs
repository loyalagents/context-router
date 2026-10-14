import fs from 'node:fs/promises';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { readManifest, cleanEnvironment, safeError, privatePath } from './runtime.mjs';
import { validateDataset } from './records.mjs';
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';

// Version-pinned controls, verified offline before a provider-backed session can start.
const disabled = ['shell_tool', 'unified_exec', 'shell_snapshot', 'view_image', 'apps', 'plugins', 'hooks', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser', 'multi_agent', 'multi_agent_v2', 'workspace_dependencies', 'image_generation', 'skill_search', 'skill_mcp_dependency_install', 'tool_suggest', 'memories'];
const claudeSubscriptionEnvironment = {
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: 'false',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
};
export function clientLaunchSpec({ command, root, mcpPort, dataset, agent = command === 'claude' ? 'a' : 'b', auth = command === 'claude' ? 'api-key' : undefined }, { executable } = {}) {
  validateDataset(dataset);
  if (!['claude', 'codex'].includes(command)) throw safeError('Unknown demo client.');
  if (!['a', 'b'].includes(agent)) throw safeError('Unsupported client role.');
  if (command === 'claude' ? !['api-key', 'subscription'].includes(auth) : auth !== undefined) throw safeError('Unsupported client authentication mode.');
  const prefix = command === 'codex' && agent === 'a' ? 'codex-a' : command;
  const env = { ...cleanEnvironment(), HOME: path.join(root, `${prefix}-home`), TMPDIR: path.join(root, `${prefix}-home`) };
  const cwd = path.join(root, `${prefix}-workspace`), url = `http://127.0.0.1:${mcpPort}/mcp`;
  const instruction = `This is a Context Router portability rehearsal. Retrieve saved personal context only through context_router_demo MCP tools. The saved context is a historical 2024–2025 snapshot, not a claim of current facts. Use fresh searchPreferences category-prefix reads such as home.${dataset}., family.${dataset}., leisure.${dataset}., tech.${dataset}. and work.${dataset}. A single unfiltered read may truncate. Do not use smartSearchPreferences or consolidateSchema: no local model is running. Save a change only when explicitly requested. Explain missing or denied context honestly.`;
  let args, version;
  if (command === 'claude') {
    env.CLAUDE_CONFIG_DIR = path.join(root, 'claude-config');
    if (auth === 'subscription') Object.assign(env, claudeSubscriptionEnvironment);
    args = [auth === 'subscription' ? '--restricted' : '--bare', '--setting-sources', '',
      '--settings', JSON.stringify({ disableAllHooks: true, ...(auth === 'subscription' ? { forceLoginMethod: 'claudeai' } : {}) }), '--disable-slash-commands', '--no-chrome',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: { context_router_demo: { type: 'http', url, headers: { Authorization: 'Bearer ${CR_DEMO_TOKEN}' } } } }),
      '--tools', '', '--append-system-prompt', instruction];
    version = '2.1.299';
  } else {
    env.CODEX_HOME = path.join(root, `${prefix}-config`);
    args = ['--no-daemon', '--strict-config', '--sandbox', 'read-only', '--ask-for-approval', 'never',
      ...disabled.flatMap(name => ['-c', `features.${name}=false`]),
      '-c', 'web_search="disabled"', '-c', 'cli_auth_credentials_store="file"',
      '-c', 'project_doc_max_bytes=0', '-c', 'apps._default.enabled=false',
      '-c', `mcp_servers.context_router_demo.url=${JSON.stringify(url)}`,
      '-c', 'mcp_servers.context_router_demo.bearer_token_env_var="CR_DEMO_TOKEN"',
      '-c', `mcp_servers.context_router_demo.enabled_tools=${JSON.stringify(['listPreferenceSlugs','searchPreferences','listPermissionGrants', ...(agent === 'a' ? ['mutatePreferences'] : [])])}`,
      '-c', 'mcp_servers.context_router_demo.required=true', instruction];
    version = '0.160.0';
  }
  if (!executable) {
    const found = spawnSync('/usr/bin/which', [command], { env: { PATH: `${path.join(os.homedir(), '.local/bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin` }, encoding: 'utf8' });
    if (found.status !== 0) throw safeError(`Install the qualified ${command} CLI before launching this demo.`);
    executable = found.stdout.trim();
  }
  return { command, prefix, agent, auth, executable, credential: agent === 'a' ? 'agent-a.token' : 'agent-b.token', version, cwd, args, env };
}

// Validate the exact interactive argv before any session can start. This pinned
// version parses strict configuration before refusing piped/nonterminal stdin.
// Disposable roots contain no authentication; never use the signed-in demo HOME.
function checkStrictCodexStartup(spec) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cr-demo-strict-')));
  try {
    for (const name of ['home', 'config', 'workspace']) mkdirSync(path.join(root, name), { mode: 0o700 });
    const result = spawnSync(spec.executable, spec.args, {
      cwd: path.join(root, 'workspace'),
      env: { ...cleanEnvironment(), HOME: path.join(root, 'home'), CODEX_HOME: path.join(root, 'config'), TMPDIR: path.join(root, 'home') },
      input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 65536,
    });
    if (result.error || result.signal !== null || result.status !== 1 || result.stdout !== '' ||
        result.stderr !== 'Error: stdin is not a terminal\n') {
      throw safeError('Codex strict startup preflight failed. No assistant session was started.');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// This parses the full Claude argv offline. A unique config directory also has
// a distinct macOS Keychain entry, so this probe never reads the user's login.
function checkClaudeSubscriptionStartup(spec) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'cr-demo-claude-')));
  try {
    for (const name of ['home', 'config', 'workspace']) mkdirSync(path.join(root, name), { mode: 0o700 });
    const config = path.join(root, 'config');
    const result = spawnSync(spec.executable, [...spec.args, 'auth', 'status', '--json'], {
      cwd: path.join(root, 'workspace'),
      env: { ...cleanEnvironment(), ...claudeSubscriptionEnvironment, HOME: path.join(root, 'home'), CLAUDE_CONFIG_DIR: config, TMPDIR: path.join(root, 'home') },
      input: '', encoding: 'utf8', timeout: 10000, maxBuffer: 65536,
    });
    let status;
    try { status = JSON.parse(result.stdout); } catch { /* Report only a sanitized failure below. */ }
    if (result.error || result.signal !== null || result.status !== 1 || result.stderr !== '' ||
        status?.loggedIn !== false || status.authMethod !== 'none' || status.apiProvider !== 'firstParty' ||
        status.analyticsDisabled !== true || status.configDirectory !== config) {
      throw safeError('Claude subscription auth-status preflight failed. No assistant session was started.');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

export function preflightClient(spec) {
  const run = args => {
    const result = spawnSync(spec.executable, args, { cwd: spec.cwd, env: spec.env, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw safeError('Unsupported client or isolation settings. No assistant was started.');
    return result.stdout;
  };
  if (!run(['--version']).includes(spec.version)) throw safeError('Unsupported client version; revalidate isolation controls before using it.');
  const help = run(['--help']);
  const required = spec.command === 'claude' ? [spec.auth === 'subscription' ? '--restricted' : '--bare', '--strict-mcp-config', '--tools', '--setting-sources', '--disable-slash-commands', '--no-chrome'] : ['--no-daemon', '--strict-config', '--sandbox'];
  if (required.some(flag => !help.includes(flag))) throw safeError('Unsupported client isolation controls.');
  if (spec.command === 'claude' && spec.auth === 'subscription') checkClaudeSubscriptionStartup(spec);
  if (spec.command === 'codex') {
    checkStrictCodexStartup(spec);
    // This version restricts --strict-config to interactive/exec; features and mcp list are offline readers.
    const offline = spec.args.slice(0, -1).filter(arg => arg !== '--strict-config');
    const servers = JSON.parse(run([...offline, 'mcp', 'list', '--json']));
    if (servers.length !== 1 || servers[0].name !== 'context_router_demo' || servers[0].transport.bearer_token_env_var !== 'CR_DEMO_TOKEN') throw safeError('Unexpected Codex MCP configuration.');
    const output = run([...offline, 'features', 'list']);
    // unified_exec selects the execution transport; documented user opt-outs are ignored.
    // shell_tool is the command-execution exposure gate and must actually be false.
    for (const name of disabled.filter(name => name !== 'unified_exec')) if (!new RegExp(`^${name}\\s+[^\\n]*\\sfalse$`, 'm').test(output)) throw safeError('Unsupported Codex native-tool controls.');
  }
  return { client: spec.command, version: spec.version, offlineControls: 'passed', ...(spec.command === 'codex' ? { unifiedExec: 'User opt-out may be ignored; shell_tool exposure is disabled.' } : {}) };
}

export async function launchClient(options) {
  const manifest = await readManifest(options.root);
  const spec = clientLaunchSpec({ ...options, dataset: manifest.dataset });
  for (const suffix of ['workspace', 'home', 'config']) await privatePath(path.join(options.root, `${spec.prefix}-${suffix}`), true);
  // Fresh workspaces deliberately contain no corpus, import report or repository instruction files.
  // Client-generated session/config state can persist in the dedicated HOME/config roots.
  if ((await fs.readdir(spec.cwd)).length) throw safeError('Demo client workspace must remain empty. Move unrelated files before launching.');
  preflightClient(spec);
  if (options.command === 'claude') {
    if (spec.auth === 'api-key') {
      if (!process.env.CR_DEMO_ANTHROPIC_API_KEY) throw safeError('Claude bare isolation requires an explicitly supplied CR_DEMO_ANTHROPIC_API_KEY for this launch; use --auth subscription for a separate demo-only Claude Pro login.');
      spec.env.ANTHROPIC_API_KEY = process.env.CR_DEMO_ANTHROPIC_API_KEY;
    }
  } else {
    // Only an explicitly user-created demo login is accepted; no personal auth fallback.
    try { await privatePath(path.join(spec.env.CODEX_HOME, 'auth.json')); }
    catch { throw safeError('Sign in to the demo-only CODEX_HOME first using the README login command. Personal auth is not copied.'); }
  }
  spec.env.CR_DEMO_TOKEN = readCredential(path.join(options.root, 'exports', spec.credential));
  console.log('Starting demo-only assistant configuration. Its provider may receive retrieved demo context.');
  const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit' });
  return await new Promise((resolve, reject) => {
    child.once('error', () => reject(safeError('Could not start the selected demo assistant.')));
    child.once('exit', code => resolve(code ?? 1));
  });
}
