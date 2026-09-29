import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const fail = () => new Error('PDF layout failed');
const packageFiles = ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs'];
const layoutFiles = ['package.json', 'pdf.mjs', 'pdf-worker.mjs', ...packageFiles.map((path) => `node_modules/pdfjs-dist/${path}`)].sort();
const layoutDirectories = ['', 'node_modules', 'node_modules/pdfjs-dist', 'node_modules/pdfjs-dist/legacy', 'node_modules/pdfjs-dist/legacy/build'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function pdfSandboxProfile(deniedRoots) {
  if (!Array.isArray(deniedRoots) || !deniedRoots.length || deniedRoots.some((root) =>
    typeof root !== 'string' || root === '/' || resolve(root) !== root || !/^\/[A-Za-z0-9_./ -]+$/.test(root))) throw fail();
  return `(version 1)(allow default)(deny network*)(deny mach-lookup (global-name "com.apple.dnssd.service"))(deny file-read* ${deniedRoots.map((root) => `(subpath ${JSON.stringify(root)})`).join(' ')})`;
}
async function regularFile(path) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > 8 * 1024 * 1024 || await realpath(path) !== path) throw fail();
  const data = await readFile(path); const after = await lstat(path);
  if (data.length !== before.size || before.ino !== after.ino || before.dev !== after.dev ||
      before.mtimeMs !== after.mtimeMs || before.mode !== after.mode) throw fail();
  return data;
}

export async function describePdfLayout(root) {
  try {
    if (await realpath(root) !== root) throw fail();
    const files = []; const directories = [];
    async function walk(path) {
      const full = join(root, path); const info = await lstat(full);
      if (info.isDirectory()) {
        if (!layoutDirectories.includes(path)) throw fail();
        directories.push({ path, mode: info.mode & 0o777 });
        for (const child of (await readdir(full)).sort()) await walk(path ? `${path}/${child}` : child);
      } else {
        if (!layoutFiles.includes(path)) throw fail();
        const data = await regularFile(full);
        files.push({ path, mode: info.mode & 0o777, bytes: data.length, sha256: hash(data) });
      }
    }
    await walk('');
    files.sort((a, b) => a.path.localeCompare(b.path)); directories.sort((a, b) => a.path.localeCompare(b.path));
    if (files.length !== layoutFiles.length || directories.length !== layoutDirectories.length) throw fail();
    return { files, directories, sha256: hash(JSON.stringify({ files, directories })) };
  } catch { throw fail(); }
}

export async function verifyPdfLayout(root, expected) {
  if ((await describePdfLayout(root)).sha256 !== expected.sha256) throw fail();
}

/** Disposable CP1 closure only; never changes installed application dependencies. */
export async function stagePdfLayout({ target, sourceRoot, packageRoot, sealed = false }) {
  try {
    if (target !== resolve(target) || sourceRoot !== await realpath(sourceRoot) || packageRoot !== await realpath(packageRoot)) throw fail();
    for (let parent = dirname(target); ; parent = dirname(parent)) {
      try { await lstat(join(parent, 'node_modules')); throw fail(); }
      catch (error) { if (error?.code !== 'ENOENT') throw fail(); }
      if (parent === dirname(parent)) break;
    }
    const contents = new Map([['package.json', Buffer.from('{"type":"module","private":true}\n')]]);
    for (const file of ['pdf.mjs', 'pdf-worker.mjs']) contents.set(file, await regularFile(join(sourceRoot, file)));
    for (const file of packageFiles) contents.set(`node_modules/pdfjs-dist/${file}`, await regularFile(join(packageRoot, file)));
    if (JSON.parse(contents.get('node_modules/pdfjs-dist/package.json')).version !== '6.3.289') throw fail();
    for (const path of layoutDirectories) await mkdir(join(target, path), { mode: 0o700 });
    for (const [path, data] of contents) await writeFile(join(target, path), data, { flag: 'wx', mode: 0o600 });
    if (sealed) {
      for (const path of layoutFiles) await chmod(join(target, path), 0o400);
      for (const path of [...layoutDirectories].reverse()) await chmod(join(target, path), 0o500);
    }
    return await describePdfLayout(target);
  } catch { throw fail(); }
}
