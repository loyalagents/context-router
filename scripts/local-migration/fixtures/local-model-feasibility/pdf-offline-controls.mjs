import { readFile } from 'node:fs/promises';
import { offlineControls } from './offline-controls.mjs';
try {
  const files = JSON.parse(process.argv[2]);
  if (!Array.isArray(files) || files.length < 3 || files.length > 5) throw new Error();
  if (JSON.parse(await readFile(process.argv[3], 'utf8')).version !== '6.3.289') throw new Error();
  for (const file of files) {
    let denied = false;
    try { await readFile(file); } catch (error) { denied = ['EPERM', 'EACCES'].includes(error?.code); }
    if (!denied) throw new Error();
  }
  console.log(JSON.stringify({ passed: true, localReadPositive: true, deniedReadRoots: files.length,
    network: await offlineControls(49197) }));
} catch { console.log('{"passed":false}'); process.exitCode = 1; }
