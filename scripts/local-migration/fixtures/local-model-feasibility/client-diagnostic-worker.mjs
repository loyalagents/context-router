import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { repoRoot } from './cases.mjs';
import { offlineControls } from './offline-controls.mjs';
import { buildProductionManifest } from './production-quality.mjs';
import { productionCancellationInputs } from './production-cancellation.mjs';
import { runClientDiagnostic } from './client-diagnostic.mjs';

const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const require = createRequire(resolve(repoRoot, 'apps/backend/package.json'));
require('reflect-metadata'); require('@nestjs/common').Logger.overrideLogger(false);
const load = name => require(resolve(repoRoot, 'apps/backend/dist', name + '.js'));
const { createSqliteIdentityRuntime } = load('infrastructure/storage/sqlite/sqlite-local-runtime');
const { createNestLocalIdentityApplication, configureLocalIdentityPreview } = load('bootstrap/local-identity-preview');
const { AI_TEXT_GENERATOR_PORT, AI_STRUCTURED_OUTPUT_PORT } = load('domains/shared/ports/ai.tokens');
const root = await realpath(dirname(process.argv[2]));
const local = { kind: 'sqlite', databaseRoot: join(root, 'data'), stateRoot: join(root, 'identity') };
let app, stage = 'manifest';
let receipt = { mode: 'client-only-cancellation-diagnostic', qualification: false, diagnosticValid: false };
try {
  const manifest = JSON.parse(await readFile(resolve(repoRoot, 'docs/plans/active/local-migration/06-local-model/evidence/client-diagnostic-manifest.json'), 'utf8'));
  assert.equal((await buildProductionManifest()).buildSha256, manifest.buildSha256);
  assert.deepEqual(productionCancellationInputs(), manifest.originalInputs);
  assert.deepEqual(manifest.operations, { baselines: 5, prefill: 1, decode: 0, followups: 0, maximum: 6 });
  stage = 'offline'; receipt.offlineControls = await offlineControls(input.configuration.port);
  stage = 'application'; await createSqliteIdentityRuntime(local, true).service.initialize();
  const identity = await readFile(join(local.stateRoot, 'identity.json'));
  app = await createNestLocalIdentityApplication(local, { root: input.credentialRoot, port: input.configuration.port });
  app.listen = () => { throw new Error('Diagnostic cannot listen'); };
  configureLocalIdentityPreview(app); await app.init();
  const model = app.get(AI_TEXT_GENERATOR_PORT); assert.equal(model, app.get(AI_STRUCTURED_OUTPUT_PORT));
  stage = 'cancellation'; receipt = { ...receipt, ...await runClientDiagnostic(model) };
  assert.ok(identity.equals(await readFile(join(local.stateRoot, 'identity.json')))); receipt.identityStable = true;
  stage = 'close'; await app.close(); app = undefined; receipt.applicationClosed = true;
} catch { receipt.diagnosticValid = false; receipt.failureStage = stage; }
finally {
  if (app) {
    try { await app.close(); receipt.applicationClosed = true; }
    catch { receipt.diagnosticValid = false; receipt.applicationClosed = false; }
  }
}
const encoded = JSON.stringify(receipt) + '\n';
if (Buffer.byteLength(encoded) > 800 * 1024) throw new Error('Diagnostic receipt invalid');
await writeFile(input.outputPath, encoded, { flag: 'wx', mode: 0o600 });
process.exitCode = receipt.diagnosticValid ? 0 : 1;
