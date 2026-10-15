import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { defaultHome, exists, trustedDirectory, readHomeIdentity, withHomeLock, writeSynced, writeSyncedJson, syncDirectory } from './home.mjs';
import { privateJson, privateBytes, readManifest, repoRoot, cleanEnvironment, safeError } from './runtime.mjs';
import { hash } from './records.mjs';
import { parsedConfig, sameConfigBytes } from '../../apps/backend/scripts/demo/desktop-config.mjs';
import { readCredential } from '../../apps/backend/scripts/mcp-bridge/credential.mjs';

const modules = ['examples/demo-10-2026/desktop-bridge.mjs', ...['cli.mjs', 'bridge.mjs', 'credential.mjs'].map(name => `apps/backend/scripts/mcp-bridge/${name}`)];
const defaultConfig = () => path.join(os.userInfo().homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
const below = (file, root) => file.startsWith(root + path.sep);
async function requireDurableReference(file, label) {
  const temporary = ['/tmp', '/private/tmp', '/var/tmp', '/private/var/tmp', '/var/folders', '/private/var/folders', await fs.realpath(os.tmpdir())];
  if (temporary.some(dir => file === dir || below(file, dir))) throw safeError(`${label} must be durable, outside temporary directories.`);
}
async function durableReferences(home, config, fixtureRoot) {
  await trustedDirectory(home); await trustedDirectory(path.dirname(config), false);
  if (!path.isAbsolute(config) || path.resolve(config) !== config || /[\x00-\x1f\x7f]/.test(config)) throw safeError('Config path must be canonical.');
  if (fixtureRoot !== undefined) {
    // An injected test context, never exposed through CLI or environment flags.
    await trustedDirectory(fixtureRoot);
    if (!process.env.NODE_TEST_CONTEXT || !below(home, fixtureRoot) || !below(config, fixtureRoot)) throw safeError('Invalid owned test fixture context.');
    return;
  }
  for (const file of [home, config]) await requireDurableReference(file, 'Desktop references');
}
async function trustedBytes(file, maxBytes = 512 * 1024 * 1024) {
  await trustedDirectory(path.dirname(file), false);
  if (await fs.realpath(file) !== file) throw safeError('Executable/source paths must not contain links.');
  const before = await fs.lstat(file);
  if (!before.isFile() || before.nlink !== 1 || ![0, process.getuid()].includes(before.uid) || (before.mode & 0o022) || before.size > maxBytes) throw safeError('Untrusted executable/source file.');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat(), bytes = await handle.readFile(), after = await handle.stat(), named = await fs.lstat(file);
    if ([opened, after, named].some(s => s.dev !== before.dev || s.ino !== before.ino || s.mode !== before.mode || s.uid !== before.uid || s.nlink !== 1 || s.size !== before.size || s.ctimeMs !== before.ctimeMs || s.mtimeMs !== before.mtimeMs) || bytes.length !== before.size) throw safeError('Source changed while reading.');
    return bytes;
  } finally { await handle.close(); }
}
async function nodeIdentity(file = process.execPath) {
  const canonical = await fs.realpath(file);
  // The home/config test context never exempts a persisted executable path.
  await requireDurableReference(canonical, 'Pinned Node');
  const bytes = await trustedBytes(canonical);
  const result = spawnSync(canonical, ['--version'], { env: cleanEnvironment(), encoding: 'utf8', timeout: 5000 });
  if (result.status !== 0 || result.stdout.trim() !== 'v24.21.0') throw safeError('Desktop requires pinned Node 24.21.0.');
  return { path: canonical, sha256: hash(bytes) };
}
async function reviewedSource() {
  const git = args => { const r = spawnSync('/usr/bin/git', args, { cwd: repoRoot, encoding: null, maxBuffer: 2 * 1024 * 1024 }); if (r.status !== 0) throw safeError('Reviewed bridge source unavailable.'); return r.stdout; };
  const revision = git(['rev-parse', 'HEAD']).toString().trim();
  const files = [];
  for (const file of modules) {
    const bytes = await trustedBytes(path.join(repoRoot, file), 2 * 1024 * 1024);
    if (!bytes.equals(git(['show', `${revision}:${file}`]))) throw safeError('Bridge source differs from committed reviewed inputs; commit reviewed code before Desktop preparation.');
    files.push({ path: file, sha256: hash(bytes), bytes });
  }
  return { revision, dirty: Boolean(git(['status', '--porcelain']).length), files };
}
async function generation(home, root) {
  const identity = await readHomeIdentity(home);
  await trustedDirectory(root);
  const receipt = await privateJson(path.join(root, 'generation.json'));
  if (receipt.homeId !== identity.id || receipt.home !== home || receipt.root !== root || !/^[a-f0-9-]{36}$/.test(receipt.generation) || root !== path.join(home, 'generations', receipt.generation) ||
      !Number.isInteger(receipt.mcpPort) || receipt.mcpPort < 1 || receipt.mcpPort > 65535) throw safeError('Desktop generation receipt mismatch.');
  const manifest = await readManifest(root);
  if (manifest.format !== 'context-router-portability-demo-v2') throw safeError('Desktop setup requires a durable A/B/C generation.');
  const credential = path.join(root, 'exports/agent-c.token'); readCredential(credential);
  return { receipt, credential, homeId: identity.id };
}
async function configBytes(config) {
  await trustedDirectory(path.dirname(config), false);
  if (!await exists(config)) return null;
  const bytes = await privateBytes(config);
  if (bytes.length > 2 * 1024 * 1024) throw safeError('Desktop config exceeds bound.');
  return bytes;
}

const entryFor = (snapshot, node, credential, port) => ({ command: node.path, args: ['--no-global-search-paths', path.join(snapshot, modules[0]), '--credential-file', credential, '--mcp-port', String(port)], env: { NODE_OPTIONS: '', NODE_DEBUG: '', NODE_DEBUG_NATIVE: '' } });
async function collision(home, config, entryName) {
  if (!Object.hasOwn(config.mcpServers ?? {}, entryName)) return;
  const receiptFile = path.join(home, 'desktop', 'installed.json');
  if (!await exists(receiptFile)) throw safeError('Desktop entry collision; existing configuration was not changed.');
  const owned = await privateJson(receiptFile);
  if (owned.entryName !== entryName || owned.homeId !== (await readHomeIdentity(home)).id || !isDeepStrictEqual(owned.entry, config.mcpServers[entryName])) throw safeError('Desktop entry collision with an unrecognized or edited entry.');
}

export async function prepareDesktop({ home = defaultHome(), root, config = defaultConfig() }, { fixtureRoot } = {}) {
  await durableReferences(home, config, fixtureRoot);
  return withHomeLock(home, async markUncertain => {
    const selected = await generation(home, root), original = await configBytes(config), parsed = parsedConfig(original);
    const entryName = `context-router-demo-${selected.homeId}`;
    await collision(home, parsed, entryName);
    const source = await reviewedSource(), node = await nodeIdentity();
    const id = randomUUID(), directory = path.join(home, 'desktop', id), snapshot = path.join(directory, 'snapshot');
    markUncertain(); await fs.mkdir(directory, { mode: 0o700 }); await fs.mkdir(snapshot, { mode: 0o700 });
    for (const file of source.files) {
      const target = path.join(snapshot, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await writeSynced(target, file.bytes, 0o400); await syncDirectory(path.dirname(target));
    }
    // Sync every directory entry in the small snapshot before its receipt is published.
    const syncDirs = async dir => { for (const name of await fs.readdir(dir)) if ((await fs.lstat(path.join(dir, name))).isDirectory()) await syncDirs(path.join(dir, name)); await syncDirectory(dir); };
    await syncDirs(snapshot);
    const entry = entryFor(snapshot, node, selected.credential, selected.receipt.mcpPort);
    const proposal = path.join(directory, 'proposal.json');
    await writeSyncedJson(proposal, { format: 'context-router-demo-desktop-v1', id, home, homeId: selected.homeId, root, config, snapshot, node, entryName, entry,
      source: { revision: source.revision, dirty: source.dirty, files: source.files.map(({ path, sha256 }) => ({ path, sha256 })) }, original: original?.toString('base64') ?? null });
    await syncDirectory(directory); await syncDirectory(path.join(home, 'desktop'));
    return { status: 'proposed', proposal, entryName, generation: selected.receipt.generation, config, snapshot, node: node.path, next: 'Close Desktop and config editors; review proposal before explicit desktop-apply.' };
  });
}

export async function applyDesktop({ home = defaultHome(), proposal, desktopClosed = false }, { fixtureRoot, checkpoint = async () => {} } = {}) {
  if (!desktopClosed) throw safeError('Explicit --desktop-closed attestation is required; close Desktop and config editors first.');
  await trustedDirectory(home);
  if (!proposal || path.basename(proposal) !== 'proposal.json' || path.dirname(path.dirname(proposal)) !== path.join(home, 'desktop')) throw safeError('Proposal must be inside this demo home.');
  await trustedDirectory(path.dirname(proposal));
  return withHomeLock(home, async markUncertain => {
    const p = await privateJson(proposal);
    if (p.format !== 'context-router-demo-desktop-v1' || p.home !== home || p.id !== path.basename(path.dirname(proposal)) || !/^[a-f0-9-]{36}$/.test(p.id) || p.snapshot !== path.join(path.dirname(proposal), 'snapshot')) throw safeError('Invalid Desktop proposal.');
    await durableReferences(home, p.config, fixtureRoot);
    const selected = await generation(home, p.root);
    if (p.homeId !== selected.homeId || p.entryName !== `context-router-demo-${selected.homeId}`) throw safeError('Desktop proposal identity mismatch.');
    // A proposal is data, never permission to execute its claimed Node path.
    const node = await nodeIdentity();
    if (!isDeepStrictEqual(node, p.node)) throw safeError('Pinned Node hash changed.');
    const source = await reviewedSource();
    if (!isDeepStrictEqual(source.files.map(({ path, sha256 }) => ({ path, sha256 })), p.source.files)) throw safeError('Reviewed source hashes changed.');
    for (const file of p.source.files) if (hash(await trustedBytes(path.join(p.snapshot, file.path), 2 * 1024 * 1024)) !== file.sha256) throw safeError('Desktop snapshot hash mismatch.');
    const entry = entryFor(p.snapshot, node, selected.credential, selected.receipt.mcpPort);
    if (!isDeepStrictEqual(entry, p.entry)) throw safeError('Desktop proposal entry mismatch.');
    const original = await configBytes(p.config), expected = p.original === null ? null : Buffer.from(p.original, 'base64');
    const sameBytes = bytes => sameConfigBytes(bytes, expected);
    if (!sameBytes(original)) throw safeError('Desktop config changed since proposal; prepare and review a new proposal.');
    const config = parsedConfig(original); await collision(home, config, p.entryName);
    const replacement = Buffer.from(JSON.stringify({ ...config, mcpServers: { ...config.mcpServers, [p.entryName]: entry } }, null, 2) + '\n');
    const backup = original === null ? null : path.join(path.dirname(proposal), 'backup.json');
    const temporary = path.join(path.dirname(p.config), `.context-router-demo-${p.id}.json`);
    markUncertain();
    if (backup) { await writeSynced(backup, original); await syncDirectory(path.dirname(backup)); }
    await writeSynced(temporary, replacement); await syncDirectory(path.dirname(p.config));
    await checkpoint('before-rename');
    if (!sameBytes(await configBytes(p.config))) throw safeError('Desktop config changed immediately before replacement.');
    await fs.rename(temporary, p.config); await syncDirectory(path.dirname(p.config));
    await checkpoint('after-rename');
    if (!(await configBytes(p.config))?.equals(replacement)) throw safeError('Desktop config readback mismatch.');
    const installed = path.join(home, 'desktop', 'installed.json'), receipt = path.join(home, 'desktop', `installed-${p.id}.json`);
    await writeSyncedJson(receipt, { homeId: selected.homeId, entryName: p.entryName, entry, proposalSha256: hash(await privateBytes(proposal)) });
    await fs.rename(receipt, installed); await syncDirectory(path.dirname(installed));
    return { status: 'applied', config: p.config, backup, entryName: p.entryName, generation: selected.receipt.generation, next: 'Restart Desktop normally. Live model acceptance remains a user step.' };
  });
}
