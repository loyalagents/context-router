import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createFreshRoot, prepareDemo, readManifest, verifyDemo, privatePath, privateJson, safeError, repoRoot } from './runtime.mjs';
import { defaultInput, loadDemoPlan } from './records.mjs';

export const defaultHome = () => {
  if (process.platform !== 'darwin') throw safeError('Specify --home on this platform; the default demo home is macOS Application Support.');
  return path.join(os.userInfo().homedir, 'Library', 'Application Support', 'Context Router Demo');
};
export const exists = async file => { try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
export async function trustedDirectory(dir, privateLeaf = true) {
  if (!path.isAbsolute(dir) || path.resolve(dir) !== dir || /[\x00-\x1f\x7f]/.test(dir) || await fs.realpath(dir) !== dir) throw safeError('Directory must be canonical, without links.');
  let current = dir;
  for (;;) {
    const s = await fs.lstat(current);
    if (!s.isDirectory() || ![0, process.getuid()].includes(s.uid) || ((s.mode & 0o022) && !(s.uid === 0 && (s.mode & 0o1000)))) throw safeError('Untrusted directory ancestry.');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
  if (privateLeaf) await privatePath(dir, true);
}
export async function syncDirectory(dir) { const handle = await fs.open(dir, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
export async function writeSynced(file, bytes, mode = 0o600) {
  const handle = await fs.open(file, 'wx', mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
export const writeSyncedJson = (file, value) => writeSynced(file, JSON.stringify(value, null, 2) + '\n');
async function syncTree(dir) {
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name), stat = await fs.lstat(file);
    if (stat.isDirectory()) await syncTree(file);
    else if (stat.isFile() && stat.nlink === 1) { const h = await fs.open(file, 'r'); try { await h.sync(); } finally { await h.close(); } }
    else throw safeError('Generation contains an unsafe file.');
  }
  await syncDirectory(dir);
}

export async function withHomeLock(home, action) {
  await trustedDirectory(home);
  const lock = path.join(home, 'writer.lock'); let uncertain = false, succeeded = false;
  try { await writeSyncedJson(lock, { pid: process.pid, startedAt: new Date().toISOString(), recovery: 'Inspect stopped writers and partial artifacts; never remove an unknown lock automatically.' }); }
  catch (e) { if (e.code === 'EEXIST') throw safeError('Demo home writer lock exists. Stop and inspect; no automatic stale-lock cleanup.'); throw e; }
  await syncDirectory(home);
  try { const result = await action(() => { uncertain = true; }); succeeded = true; return result; }
  catch (e) { if (uncertain) throw safeError('Demo home mutation uncertain. Stop for read-only inspection of writer.lock and retained artifacts; do not replay.'); throw e; }
  finally { if (succeeded || !uncertain) { await fs.unlink(lock); await syncDirectory(home); } }
}

async function initializeHome(home, syncHomeParent) {
  if (home === repoRoot || home.startsWith(repoRoot + path.sep)) throw safeError('Demo home must be outside the repository.');
  if (!await exists(home)) { try { await createFreshRoot(home); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
  await trustedDirectory(home);
  if (!await exists(path.join(home, 'home.json'))) {
    // Publish the newly created home's own directory entry before any state.
    // An empty home retained after a failed sync must repeat this boundary.
    await syncHomeParent(path.dirname(home));
    if ((await fs.readdir(home)).length) throw safeError('Unrecognized or locked demo home; stop for inspection.');
  }
}
async function initializeLayout(home) {
  if (!await exists(path.join(home, 'home.json'))) await writeSyncedJson(path.join(home, 'home.json'), { format: 'context-router-demo-home-v1', home, id: randomUUID() });
  for (const name of ['generations', 'profiles', 'desktop']) {
    const dir = path.join(home, name); if (!await exists(dir)) await fs.mkdir(dir, { mode: 0o700 }); await trustedDirectory(dir);
  }
  // Profiles are stable across generations, and never copied from personal state.
  for (const prefix of ['codex-a', 'codex', 'claude', 'claude-a']) for (const suffix of ['home', 'config', 'workspace']) {
    const dir = path.join(home, 'profiles', `${prefix}-${suffix}`);
    if (!await exists(dir)) await fs.mkdir(dir, { mode: 0o700 }); await privatePath(dir, true);
  }
  await syncDirectory(path.join(home, 'profiles')); await syncDirectory(home);
}

export async function readHomeIdentity(home) {
  await trustedDirectory(home);
  const identity = await privateJson(path.join(home, 'home.json'));
  if (identity.format !== 'context-router-demo-home-v1' || identity.home !== home || !/^[a-f0-9-]{36}$/.test(identity.id)) throw safeError('Invalid demo home identity.');
  return identity;
}

export async function resolveHome({ home = defaultHome(), allowLocked = false } = {}) {
  const identity = await readHomeIdentity(home);
  const locked = await exists(path.join(home, 'writer.lock'));
  if (locked && !allowLocked) throw safeError('Demo home writer lock exists; only read-only status/inspection is allowed.');
  const selected = await privateJson(path.join(home, 'current.json'));
  if (selected.format !== 'context-router-demo-selection-v1' || !/^[a-f0-9-]{36}$/.test(selected.generation)) throw safeError('Invalid demo selection.');
  const root = path.join(home, 'generations', selected.generation);
  await trustedDirectory(root);
  const receipt = await privateJson(path.join(root, 'generation.json'));
  if (receipt.format !== 'context-router-demo-generation-v1' || receipt.home !== home || receipt.homeId !== identity.id || receipt.root !== root || receipt.generation !== selected.generation ||
      ![receipt.port, receipt.mcpPort].every(p => Number.isInteger(p) && p > 0 && p <= 65535) || receipt.port === receipt.mcpPort) throw safeError('Invalid generation receipt.');
  const manifest = await readManifest(root);
  if (manifest.format !== 'context-router-portability-demo-v2' || receipt.dataset !== manifest.dataset) throw safeError('Selected generation manifest mismatch.');
  await trustedDirectory(path.join(home, 'profiles'));
  return { ...receipt, profileRoot: path.join(home, 'profiles'), locked };
}

export async function prepareHome({ home = defaultHome(), input, dataset, port, mcpPort, fresh = false } = {}, { prepare = prepareDemo, checkpoint = async () => {}, syncHomeParent = syncDirectory } = {}) {
  await initializeHome(home, syncHomeParent);
  return withHomeLock(home, async markUncertain => {
    const selected = await exists(path.join(home, 'current.json')) ? await resolveHome({ home, allowLocked: true }) : undefined;
    if (!fresh && selected) {
      if ((dataset !== undefined && dataset !== selected.dataset) || (port !== undefined && port !== selected.port) || (mcpPort !== undefined && mcpPort !== selected.mcpPort)) throw safeError('Explicit prepare options conflict with selected generation; use --fresh for another rehearsal.');
      if (input !== undefined) {
        let matches = false;
        try { const plan = await loadDemoPlan(input, selected.dataset); matches = await fs.realpath(input) === selected.input && isDeepStrictEqual(plan.sources, (await readManifest(selected.root)).sources); } catch { /* Conflicting source is never imported into existing state. */ }
        if (!matches) throw safeError('Explicit input conflicts with selected generation.');
      }
      return { ...selected, locked: false };
    }
    const source = await fs.realpath(input ?? selected?.input ?? defaultInput);
    const plan = await loadDemoPlan(source, dataset ?? selected?.dataset ?? 'demo001');
    const ports = [port ?? selected?.port ?? 3004, mcpPort ?? selected?.mcpPort ?? 8789];
    if (!ports.every(p => Number.isInteger(p) && p > 0 && p <= 65535) || ports[0] === ports[1]) throw safeError('Invalid distinct demo ports.');
    markUncertain(); await initializeLayout(home);
    const generation = randomUUID(), root = path.join(home, 'generations', generation);
    await prepare({ out: root, input: source, dataset: plan.dataset, durable: true });
    await verifyDemo(root);
    const receipt = { format: 'context-router-demo-generation-v1', home, homeId: (await readHomeIdentity(home)).id, generation, root, input: source, dataset: plan.dataset, port: ports[0], mcpPort: ports[1] };
    await writeSyncedJson(path.join(root, 'generation.json'), receipt);
    await syncTree(root); await syncDirectory(path.join(home, 'generations'));
    await checkpoint('before-selector');
    const temporary = path.join(home, `selection-${generation}.json`);
    await writeSyncedJson(temporary, { format: 'context-router-demo-selection-v1', generation });
    await fs.rename(temporary, path.join(home, 'current.json')); await syncDirectory(home);
    await checkpoint('after-selector');
    return { ...receipt, profileRoot: path.join(home, 'profiles'), locked: false };
  });
}
