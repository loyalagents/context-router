import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPackageManifest, inventoryPayload } from '../../src/package-manifest.mjs';

export const fixtureInfo = identifier => `<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>context-router</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`;
export function sealFixture(bundle) {
  const result = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', bundle],
    { env: { PATH: '', LC_ALL: 'C' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
}
export async function writeSignedFixture(bundle, alter = () => {}) {
  const info = path.join(bundle, 'Contents/Info.plist');
  try { await access(info); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(info, fixtureInfo('local.context-router.pilot'));
  }
  const manifest = createPackageManifest({ source: 'a'.repeat(64), files: await inventoryPayload(bundle, { forSigning: true }) });
  alter(manifest);
  const manifestFile = path.join(bundle, 'Contents/Resources/package-manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest));
  sealFixture(bundle);
  return { manifest, manifestFile };
}
