import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import { discoverFiles } from '../src/discover';

test('discoverFiles recurses visible files, skips hidden entries by default, and supports markdown natively', async (t) => {
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
  assert.equal(noteRecord.file.uploadMimeType, 'text/markdown');
  assert.equal(noteRecord.file.coercedToPlainText, false);

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

test('discoverFiles recognizes native markdown/yaml and local text-like config formats', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'guide.markdown'), '## preferences\n');
  await writeFile(path.join(tempRoot, 'config.yml'), 'tone: brief\n');
  await writeFile(path.join(tempRoot, 'config.yaml'), 'locale: us\n');
  await writeFile(path.join(tempRoot, 'settings.toml'), 'tone = "brief"\n');
  await writeFile(path.join(tempRoot, 'service.conf'), 'locale=en-US\n');
  await writeFile(path.join(tempRoot, 'image.jpeg'), 'jpeg-bytes');
  await writeFile(path.join(tempRoot, '.prettierrc'), '{ "semi": false }\n');

  const discovery = await discoverFiles(tempRoot);

  assert.equal(discovery.hiddenEntriesSkipped, 1);
  assert.equal(
    discovery.files.some((record) => record.relativePath === '.prettierrc'),
    false,
  );

  const markdownRecord = discovery.files.find(
    (record) => record.relativePath === 'guide.markdown',
  );
  assert.equal(markdownRecord?.file?.uploadMimeType, 'text/markdown');
  assert.equal(markdownRecord?.file?.coercedToPlainText, false);

  const ymlRecord = discovery.files.find(
    (record) => record.relativePath === 'config.yml',
  );
  assert.equal(ymlRecord?.file?.uploadMimeType, 'application/yaml');
  assert.equal(ymlRecord?.file?.coercedToPlainText, false);

  const yamlRecord = discovery.files.find(
    (record) => record.relativePath === 'config.yaml',
  );
  assert.equal(yamlRecord?.file?.uploadMimeType, 'application/yaml');
  assert.equal(yamlRecord?.file?.coercedToPlainText, false);

  const tomlRecord = discovery.files.find(
    (record) => record.relativePath === 'settings.toml',
  );
  assert.equal(tomlRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(tomlRecord?.file?.coercedToPlainText, true);

  const confRecord = discovery.files.find(
    (record) => record.relativePath === 'service.conf',
  );
  assert.equal(confRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(confRecord?.file?.coercedToPlainText, true);

  const jpegRecord = discovery.files.find(
    (record) => record.relativePath === 'image.jpeg',
  );
  assert.equal(jpegRecord?.file?.uploadMimeType, 'image/jpeg');
  assert.equal(jpegRecord?.file?.coercedToPlainText, false);
});

test('discoverFiles can include hidden entries and recognize .env patterns', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await mkdir(path.join(tempRoot, '.config'));
  await writeFile(path.join(tempRoot, '.env'), 'TONE=brief\n');
  await writeFile(path.join(tempRoot, '.env.local'), 'LOCALE=en-US\n');
  await writeFile(path.join(tempRoot, '.config', 'service.ini'), 'tone=brief\n');
  await writeFile(path.join(tempRoot, '.prettierrc'), '{ "semi": false }\n');

  const discovery = await discoverFiles(tempRoot, { includeHidden: true });

  assert.equal(discovery.hiddenEntriesSkipped, 0);

  const envRecord = discovery.files.find(
    (record) => record.relativePath === '.env',
  );
  assert.equal(envRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(envRecord?.file?.coercedToPlainText, true);

  const envLocalRecord = discovery.files.find(
    (record) => record.relativePath === '.env.local',
  );
  assert.equal(envLocalRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(envLocalRecord?.file?.coercedToPlainText, true);

  const iniRecord = discovery.files.find(
    (record) => record.relativePath === path.join('.config', 'service.ini'),
  );
  assert.equal(iniRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(iniRecord?.file?.coercedToPlainText, true);

  const unsupportedDotfile = discovery.files.find(
    (record) => record.relativePath === '.prettierrc',
  );
  assert.equal(unsupportedDotfile?.discovery.action, 'skip');
  assert.equal(unsupportedDotfile?.discovery.reason, 'unsupported_extension');
});

test('discoverFiles matches supported extensions case-insensitively', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, 'GUIDE.MD'), '# preferences\n');
  await writeFile(path.join(tempRoot, 'CONFIG.YAML'), 'tone: brief\n');
  await writeFile(path.join(tempRoot, 'SETTINGS.TOML'), 'tone = "brief"\n');
  await writeFile(path.join(tempRoot, 'SERVICE.CONF'), 'locale=en-US\n');

  const discovery = await discoverFiles(tempRoot);

  const markdownRecord = discovery.files.find(
    (record) => record.relativePath === 'GUIDE.MD',
  );
  assert.equal(markdownRecord?.extension, '.md');
  assert.equal(markdownRecord?.file?.uploadMimeType, 'text/markdown');
  assert.equal(markdownRecord?.file?.coercedToPlainText, false);

  const yamlRecord = discovery.files.find(
    (record) => record.relativePath === 'CONFIG.YAML',
  );
  assert.equal(yamlRecord?.extension, '.yaml');
  assert.equal(yamlRecord?.file?.uploadMimeType, 'application/yaml');
  assert.equal(yamlRecord?.file?.coercedToPlainText, false);

  const tomlRecord = discovery.files.find(
    (record) => record.relativePath === 'SETTINGS.TOML',
  );
  assert.equal(tomlRecord?.extension, '.toml');
  assert.equal(tomlRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(tomlRecord?.file?.coercedToPlainText, true);

  const confRecord = discovery.files.find(
    (record) => record.relativePath === 'SERVICE.CONF',
  );
  assert.equal(confRecord?.extension, '.conf');
  assert.equal(confRecord?.file?.uploadMimeType, 'text/plain');
  assert.equal(confRecord?.file?.coercedToPlainText, true);
});

test('discoverFiles does not over-match hidden .env lookalikes', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'local-orchestrator-'));
  t.after(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  await writeFile(path.join(tempRoot, '.env.local'), 'LOCALE=en-US\n');
  await writeFile(path.join(tempRoot, '.envrc'), 'export TONE=brief\n');
  await writeFile(path.join(tempRoot, '.env-example'), 'TONE=brief\n');

  const discovery = await discoverFiles(tempRoot, { includeHidden: true });

  const envLocalRecord = discovery.files.find(
    (record) => record.relativePath === '.env.local',
  );
  assert.equal(envLocalRecord?.discovery.action, 'analyze');
  assert.equal(envLocalRecord?.file?.uploadMimeType, 'text/plain');

  const envrcRecord = discovery.files.find(
    (record) => record.relativePath === '.envrc',
  );
  assert.equal(envrcRecord?.discovery.action, 'skip');
  assert.equal(envrcRecord?.discovery.reason, 'unsupported_extension');
  assert.equal(envrcRecord?.discovery.details, 'Unsupported extension "[none]"');

  const envExampleRecord = discovery.files.find(
    (record) => record.relativePath === '.env-example',
  );
  assert.equal(envExampleRecord?.discovery.action, 'skip');
  assert.equal(envExampleRecord?.discovery.reason, 'unsupported_extension');
  assert.equal(
    envExampleRecord?.discovery.details,
    'Unsupported extension "[none]"',
  );
});
