import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Ordinary build input, never the CP1 download directory. Keep the runtime closure small.
const backend = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(backend, 'package.json'));
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(backend, 'dist/infrastructure/local-model/engine/pdfjs');
const files = [
  ['package.json', 'package.json', 710, '3fcf6a22713e12b62ac8430e54bf00547d664b3248b618aa57915840c7f8b617'],
  ['LICENSE', 'LICENSE', 10174, '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'],
  ['legacy/build/pdf.mjs', 'pdf.mjs', 1047456, '91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d'],
  ['legacy/build/pdf.worker.mjs', 'pdf.worker.mjs', 2395538, 'df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b'],
];
await mkdir(target, { recursive: true });
for (const [relative, name, size, sha256] of files) {
  const path = join(source, relative);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size !== size) throw new Error('Pinned PDF build input mismatch');
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Pinned PDF build input mismatch');
  await writeFile(join(target, name), bytes, { flag: 'wx', mode: 0o644 });
}
