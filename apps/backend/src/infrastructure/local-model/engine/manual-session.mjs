import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';

const unavailable = () => new Error('MODEL_UNAVAILABLE');
const marker = Buffer.from('context-router/local-model-session/v1\n');
const same = (left, right, file = false) => ['dev', 'ino', 'uid', 'mode', ...(file ? ['size', 'nlink', 'mtimeNs', 'ctimeNs'] : [])]
  .every((field) => left[field] === right[field]);
function rootPath(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || resolve(value) !== value || value === '/' ||
      Buffer.byteLength(value) > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw unavailable();
  return value;
}
const overlaps = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

/** Exclusive manual-session claim. No network, runtime control, claim deletion or recovery. */
export async function claimManualSession(configuration, { fileSystem = fs, uid = process.getuid(), now = Date.now() } = {}) {
  let directory;
  try {
    const { root: rootInput, identityRoot: identityInput, databaseRoot: databaseInput, port } = configuration;
    const root = rootPath(rootInput); const identityRoot = rootPath(identityInput); const databaseRoot = rootPath(databaseInput);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(uid) || uid < 0 || !Number.isFinite(now) ||
        overlaps(root, identityRoot) || overlaps(root, databaseRoot)) throw unavailable();
    const owner = BigInt(uid);
    for (const path of [identityRoot, databaseRoot]) {
      if (await fileSystem.realpath(path) !== path || !(await fileSystem.lstat(path, { bigint: true })).isDirectory()) throw unavailable();
    }
    async function ancestry() {
      let path = '/'; const entries = [];
      for (const part of ['', ...root.split('/').filter(Boolean)]) {
        path = part ? join(path, part) : path;
        const stats = await fileSystem.lstat(path, { bigint: true });
        if (!stats.isDirectory() || (stats.uid !== 0n && stats.uid !== owner)) throw unavailable();
        entries.push({ path, stats });
      }
      for (let index = 0; index < entries.length; index++) {
        const current = entries[index].stats;
        if ((current.mode & 0o022n) !== 0n &&
            !(current.uid === 0n && (current.mode & 0o1000n) !== 0n && entries[index + 1]?.stats.uid === owner)) throw unavailable();
      }
      const leaf = entries.at(-1).stats;
      if (leaf.uid !== owner || (leaf.mode & 0o7777n) !== 0o700n || await fileSystem.realpath(root) !== root) throw unavailable();
      for (const entry of entries) if (!same(entry.stats, await fileSystem.lstat(entry.path, { bigint: true }))) throw unavailable();
      return entries;
    }
    const pins = await ancestry();
    async function recheck() {
      const current = await ancestry();
      if (current.length !== pins.length || current.some((entry, index) => !same(entry.stats, pins[index].stats)) ||
          !same(await directory.stat({ bigint: true }), pins.at(-1).stats)) throw unavailable();
    }
    function privateFile(stats, maximum, empty = false) {
      if (!stats.isFile() || stats.uid !== owner || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n ||
          stats.size < (empty ? 0n : 1n) || stats.size > BigInt(maximum)) throw unavailable();
    }
    directory = await fileSystem.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    await recheck();
    async function readPrivate(name, maximum) {
      await recheck(); const path = join(root, name);
      const before = await fileSystem.lstat(path, { bigint: true }); privateFile(before, maximum);
      const handle = await fileSystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let bytes;
      try {
        const opened = await handle.stat({ bigint: true }); privateFile(opened, maximum);
        if (!same(before, opened, true)) throw unavailable();
        const buffer = Buffer.alloc(maximum + 1); let count = 0;
        while (count < buffer.length) {
          const chunk = await handle.read(buffer, count, buffer.length - count, count);
          if (chunk.bytesRead === 0) break;
          count += chunk.bytesRead;
        }
        const after = await handle.stat({ bigint: true }); privateFile(after, maximum);
        if (count > maximum || BigInt(count) !== opened.size || !same(opened, after, true)) throw unavailable();
        bytes = buffer.subarray(0, count);
      } finally { await handle.close(); }
      const after = await fileSystem.lstat(path, { bigint: true }); privateFile(after, maximum);
      if (!same(before, after, true)) throw unavailable();
      await recheck(); return bytes;
    }
    const keyBytes = await readPrivate('api-key.txt', 65);
    const apiKeyText = new TextDecoder('utf-8', { fatal: true }).decode(keyBytes);
    if (!/^[0-9a-f]{64}\n?$/.test(apiKeyText)) throw unavailable();
    const certificate = new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate('server-cert.pem', 32768));
    if (!/^-----BEGIN CERTIFICATE-----\r?\n(?:[A-Za-z0-9+/]{1,80}={0,2}\r?\n)+-----END CERTIFICATE-----\r?\n?$/.test(certificate)) throw unavailable();
    const x509 = new X509Certificate(certificate);
    if (!x509.ca || x509.issuer !== x509.subject || !x509.verify(x509.publicKey) || x509.checkIP('127.0.0.1') !== '127.0.0.1' ||
        !(Date.parse(x509.validFrom) <= now && now < Date.parse(x509.validTo))) throw unavailable();
    await recheck();
    const claimPath = join(root, 'backend-session.claim');
    const claim = await fileSystem.open(claimPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    let written;
    try {
      const created = await claim.stat({ bigint: true }); privateFile(created, 0, true);
      await recheck(); await claim.writeFile(marker);
      written = await claim.stat({ bigint: true }); privateFile(written, marker.length);
      if (!same(created, written) || written.size !== BigInt(marker.length)) throw unavailable();
      await claim.sync();
      if (!same(written, await claim.stat({ bigint: true }), true)) throw unavailable();
    } finally { await claim.close(); }
    const claimed = await fileSystem.lstat(claimPath, { bigint: true }); privateFile(claimed, marker.length);
    if (!same(written, claimed, true)) throw unavailable();
    await recheck(); await directory.sync(); await recheck();
    if (!same(written, await fileSystem.lstat(claimPath, { bigint: true }), true)) throw unavailable();
    return Object.freeze({ port, certificate, apiKey: apiKeyText.trimEnd() });
  } catch { throw unavailable(); }
  finally { if (directory) { try { await directory.close(); } catch { throw unavailable(); } } }
}
