import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readManifest, safeError, privatePath } from './runtime.mjs';
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';
import { clientLaunchSpec, loginSpec, preflightClient } from '../../apps/backend/scripts/demo/clients.mjs';
export { clientLaunchSpec, loginSpec, preflightClient };

export async function launchClient(options) {
  const manifest = await readManifest(options.root);
  let spec = clientLaunchSpec({ ...options, dataset: manifest.dataset });
  for (const suffix of ['workspace', 'home', 'config']) await privatePath(path.join(options.profileRoot ?? options.root, `${spec.prefix}-${suffix}`), true);
  // Fresh workspaces deliberately contain no corpus, import report or repository instruction files.
  // Client-generated session/config state persists in the dedicated config roots;
  // macOS subscription auth uses the account Keychain with a distinct demo entry.
  if ((await fs.readdir(spec.cwd)).length) throw safeError('Demo client workspace must remain empty. Move unrelated files before launching.');
  preflightClient(spec);
  if (options.login) {
    spec = loginSpec(spec);
  } else if (options.command === 'claude') {
    if (spec.auth === 'api-key') {
      if (!process.env.CR_DEMO_ANTHROPIC_API_KEY) throw safeError('Claude bare isolation requires an explicitly supplied CR_DEMO_ANTHROPIC_API_KEY for this launch; use --auth subscription for a separate demo-only Claude Pro login.');
      spec.env.ANTHROPIC_API_KEY = process.env.CR_DEMO_ANTHROPIC_API_KEY;
    }
  } else {
    // Only an explicitly user-created demo login is accepted; no personal auth fallback.
    try { await privatePath(path.join(spec.env.CODEX_HOME, 'auth.json')); }
    catch { throw safeError('Sign in to the demo-only CODEX_HOME first using the README login command. Personal auth is not copied.'); }
  }
  if (!options.login) spec.env.CR_DEMO_TOKEN = readCredential(spec.credentialFile);
  console.log(options.login ? 'Starting explicit login for the selected isolated Codex profile.' : 'Starting demo-only assistant configuration. Its provider may receive retrieved demo context.');
  const child = spawn(spec.executable, spec.args, { cwd: spec.cwd, env: spec.env, stdio: 'inherit' });
  return await new Promise((resolve, reject) => {
    child.once('error', () => reject(safeError('Could not start the selected demo assistant.')));
    child.once('exit', code => resolve(code ?? 1));
  });
}
