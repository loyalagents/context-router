import path from 'node:path';
import { admit, backend, authority, nativeOwners, resources } from './managed.mjs';
let control, exitCode = 1;
try {
  if (process.argv.length !== 2) throw new Error();
  const state = await admit('demo-prepare'); control = state.control;
  const { loadBundledSeed } = await import(backend.resolve('backend/scripts/demo/seed.mjs'));
  const seed = await loadBundledSeed(path.join(resources, 'demo-seed-v1'));
  control.assertActive();
  await backend('backend/dist/infrastructure/managed/managed-prepare.js').prepareManagedStore();
  control.assertActive();
  const { seedDemo } = await import(backend.resolve('backend/scripts/demo/domain.mjs'));
  await seedDemo({ configuration: state.configuration, directory: path.join(state.cap.envelope, 'demo', state.cap.storeId),
    seed, storeId: state.cap.storeId, installationId: state.cap.installationId }, { signal: control.signal });
  control.assertActive(); exitCode = 0;
} catch { exitCode = 1; }
finally {
  authority.revokeManagedAdmission(); await nativeOwners.waitForNativeOwners();
  try {
    if (!control || control.failed || (control.signal.aborted && !control.orderlyStopRequested)) throw new Error();
    if (control.signal.aborted) exitCode = 1;
    await control.send('demo-complete', { exitCode });
  } catch { exitCode = 1; }
  await control?.close().catch(() => { exitCode = 1; }); process.exitCode = exitCode;
}
