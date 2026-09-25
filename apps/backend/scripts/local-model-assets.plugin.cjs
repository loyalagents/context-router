'use strict';
const { createHash } = require('node:crypto');
const { readFileSync, mkdirSync, writeFileSync, lstatSync } = require('node:fs');
const { dirname, join, isAbsolute } = require('node:path');

const files = [
  ['package.json', 'package.json', 710, '3fcf6a22713e12b62ac8430e54bf00547d664b3248b618aa57915840c7f8b617'],
  ['LICENSE', 'LICENSE', 10174, '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594'],
  ['legacy/build/pdf.mjs', 'pdf.mjs', 1047456, '91e29f812c593904e8d48d022db5ddf93e3443575d4765ac9bfbb42494cfbd8d'],
  ['legacy/build/pdf.worker.mjs', 'pdf.worker.mjs', 2395538, 'df3bf6bf6b8b8dac8a4042d8c4ecf1cf21e1d197e0fe231c192122409eba656b'],
];

// Build-time only: Nest build/start/watch/debug all invoke this before emitting/launching.
function copyPinnedAssets(outDir, source = dirname(require.resolve('pdfjs-dist/package.json'))) {
  if (typeof outDir !== 'string' || !isAbsolute(outDir)) throw new Error('PDF assets require an absolute compiler output directory');
  // Validate the complete pinned input set on every emit, including repeated watch emits.
  const verified = files.map(([relative, name, size, sha256]) => {
    const path = join(source, relative), stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== size) throw new Error('Pinned PDF build input mismatch');
    const bytes = readFileSync(path);
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Pinned PDF build input mismatch');
    return [name, bytes];
  });
  const target = join(outDir, 'infrastructure/local-model/engine/pdfjs');
  mkdirSync(target, { recursive: true });
  for (const [name, bytes] of verified) {
    const path = join(target, name);
    try {
      if (!lstatSync(path).isFile()) throw new Error('Invalid PDF asset output');
      if (readFileSync(path).equals(bytes)) continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    writeFileSync(path, bytes, { mode: 0o644 });
  }
}

exports.copyPinnedAssets = copyPinnedAssets;
exports.before = (_options, program) => {
  copyPinnedAssets(program.getCompilerOptions().outDir);
  return () => sourceFile => sourceFile;
};
