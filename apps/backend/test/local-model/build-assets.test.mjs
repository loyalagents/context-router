import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const backend = new URL('../../', import.meta.url).pathname;
const expected = [
  ['package.json', '3fcf6a22713e12b62ac8430e54bf00547d664b3248b618aa57915840c7f8b617'],
  ['LICENSE', '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'],
  ['pdf.mjs', '91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d'],
  ['pdf.worker.mjs', 'df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b'],
];
async function verify(output) {
  for (const [name, hash] of expected) assert.equal(createHash('sha256').update(await readFile(join(output, 'infrastructure/local-model/engine/pdfjs', name))).digest('hex'), hash);
}

test('installed Nest compiler and watch emits provision identical pinned assets before application launch', { timeout: 30000 }, async () => {
  const { PluginsLoader } = require('@nestjs/cli/lib/compiler/plugins/plugins-loader');
  const { Compiler } = require('@nestjs/cli/lib/compiler/compiler');
  const { WatchCompiler } = require('@nestjs/cli/lib/compiler/watch-compiler');
  const { TsConfigProvider } = require('@nestjs/cli/lib/compiler/helpers/tsconfig-provider');
  const { TypeScriptBinaryLoader } = require('@nestjs/cli/lib/compiler/typescript-loader');
  const config = JSON.parse(await readFile(new URL('../../nest-cli.json', import.meta.url), 'utf8'));
  assert.equal(config.compilerOptions.plugins?.length, 1);
  const root = await mkdtemp(join(tmpdir(), 'model-build-assets-')), output = join(root, 'dist');
  const previous = process.cwd(); let watch;
  try {
    process.chdir(backend);
    const plugins = new PluginsLoader(); assert.equal(plugins.load(config.compilerOptions.plugins).beforeHooks.length, 1);
    const loader = new TypeScriptBinaryLoader(), provider = new TsConfigProvider(loader);
    const source = join(root, 'main.ts'), tsconfig = join(root, 'tsconfig.json');
    await writeFile(source, 'export const value = 1;\n');
    await writeFile(tsconfig, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'CommonJS', types: [], outDir: output }, files: [source] }));
    let completed = false;
    new Compiler(plugins, provider, loader).run(config, relative(backend, tsconfig), undefined, {}, () => { completed = true; });
    assert.equal(completed, true); await verify(output); assert.match(await readFile(join(output, 'main.js'), 'utf8'), /exports.value = 1/);
    await rm(output, { recursive: true });
    const ts = loader.load(); let emitted = 0; let next;
    const watchLoader = { load: () => ({ ...ts, createWatchProgram(host) { watch = ts.createWatchProgram(host); return watch; } }) };
    const wait = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compiler did not finish')), 10000);
      next = () => { clearTimeout(timer); resolve(); };
    });
    const first = wait();
    new WatchCompiler(plugins, provider, watchLoader).run(config, relative(backend, tsconfig), undefined, {}, () => { emitted++; next?.(); });
    await first; await verify(output);
    for (const value of [2, 3]) {
      if (value === 3) await rm(join(output, 'infrastructure/local-model/engine/pdfjs/pdf.worker.mjs'));
      const done = wait(); await writeFile(source, `export const value = ${value};\n`); await done;
      await verify(output); assert.match(await readFile(join(output, 'main.js'), 'utf8'), new RegExp(`exports.value = ${value}`));
    }
    assert.equal(emitted, 3);
  } finally { watch?.close(); process.chdir(previous); await rm(root, { recursive: true, force: true }); }
});

test('pinned asset copier validates every input before writing and rejects corruption on repeated emits', async () => {
  const { copyPinnedAssets } = require('../../scripts/local-model-assets.plugin.cjs');
  const root = await mkdtemp(join(tmpdir(), 'model-copy-assets-'));
  try {
    const source = join(root, 'pdfjs'), output = join(root, 'dist');
    await mkdir(join(source, 'legacy/build'), { recursive: true });
    const installed = dirname(require.resolve('pdfjs-dist/package.json'));
    for (const name of ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs']) await writeFile(join(source, name), await readFile(join(installed, name)));
    const worker = join(source, 'legacy/build/pdf.worker.mjs'), original = await readFile(worker);
    await writeFile(worker, Buffer.alloc(original.length));
    assert.throws(() => copyPinnedAssets(output, source), /Pinned PDF build input mismatch/);
    await assert.rejects(readFile(join(output, 'infrastructure/local-model/engine/pdfjs/package.json')));
    await writeFile(worker, original); copyPinnedAssets(output, source); copyPinnedAssets(output, source); await verify(output);
    await writeFile(worker, Buffer.alloc(original.length));
    assert.throws(() => copyPinnedAssets(output, source), /Pinned PDF build input mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
