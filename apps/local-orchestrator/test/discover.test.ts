import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { discoverFiles } from '../src/discover';

test('discoverFiles recurses visible files, skips hidden entries, and coerces markdown', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(tempRoot, 'nested'));
  await mkdir(path.join(tempRoot, '.hidden-dir'));
  await writeFile(path.join(tempRoot, 'notes.md'), '# heading\n- item\n');
  await writeFile(path.join(tempRoot, 'prefs.json'), '{"tone":"brief"}\n');
  await writeFile(path.join(tempRoot, 'nested', 'photo.jpg'), 'jpg-bytes');
  await writeFile(path.join(tempRoot, 'nested', 'ignore.docx'), 'docx');
  await writeFile(path.join(tempRoot, '.env'), 'SECRET=true');
  await writeFile(path.join(tempRoot, '.hidden-dir', 'inside.txt'), 'hidden');

  const discovery = await discoverFiles(tempRoot);

  assert.equal(discovery.hiddenEntriesSkipped, 2);
  assert.equal(discovery.files.length, 4);

  const noteRecord = discovery.files.find(
    (record) => record.relativePath === 'notes.md',
  );
  assert.ok(noteRecord?.file);
  assert.equal(noteRecord.file.uploadMimeType, 'text/plain');
  assert.equal(noteRecord.file.coercedToPlainText, true);

  const jsonRecord = discovery.files.find(
    (record) => record.relativePath === 'prefs.json',
  );
  assert.equal(jsonRecord?.discovery.action, 'analyze');
  assert.equal(jsonRecord?.uploadMimeType, 'application/json');

  const nestedJpeg = discovery.files.find(
    (record) => record.relativePath === path.join('nested', 'photo.jpg'),
  );
  assert.equal(nestedJpeg?.uploadMimeType, 'image/jpeg');

  const unsupported = discovery.files.find(
    (record) => record.relativePath === path.join('nested', 'ignore.docx'),
  );
  assert.equal(unsupported?.discovery.action, 'skip');
  assert.equal(unsupported?.discovery.reason, 'unsupported_extension');

  const noteStats = await stat(path.join(tempRoot, 'notes.md'));
  assert.equal(noteRecord?.sizeBytes, noteStats.size);
});
