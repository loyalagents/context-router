import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

// CP1 only. The parent supplies one fixed reviewed worker entry, never document input.
const control = new Socket({ fd: 3, readable: true, writable: true });
let timer;
try {
  await import(pathToFileURL(process.argv[2]).href);
  await new Promise((resolve, reject) => {
    const fail = () => reject(new Error('PDF_CONTROL'));
    control.once('error', fail); control.once('end', fail);
    timer = setTimeout(fail, 1000);
    control.once('data', (chunk) => {
      if (chunk.length !== 1 || chunk[0] !== 2) { fail(); return; }
      control.write(Buffer.from([3]), (error) => error ? fail() : resolve());
    });
    control.write(Buffer.from([1]), (error) => { if (error) fail(); });
  });
} catch { process.exitCode = 1; }
finally { clearTimeout(timer); control.destroy(); }
