import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

/** Disposable probe credentials only; never a product credential provisioner. */
export async function createTlsFixture({ ip = '127.0.0.1' } = {}) {
  if (!['127.0.0.1', '127.0.0.2'].includes(ip)) throw new Error('Invalid fixture address');
  const root = await mkdtemp(join(tmpdir(), 'step06-model-tls-'));
  await chmod(root, 0o700);
  const keyPath = join(root, 'server-key.pem');
  const certPath = join(root, 'server-cert.pem');
  const apiKeyPath = join(root, 'api-key.txt');
  try {
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
      '-nodes', '-sha256', '-days', '1', '-subj', '/CN=Step06Probe', '-addext', `subjectAltName=IP:${ip}`,
      '-keyout', keyPath, '-out', certPath], { env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
      stdio: 'ignore', timeout: 15_000 });
    if (result.status !== 0) throw new Error('Fixture certificate creation failed');
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    const apiKey = randomBytes(32).toString('hex');
    await writeFile(apiKeyPath, `${apiKey}\n`, { mode: 0o600, flag: 'wx' });
    return { root, keyPath, certPath, apiKeyPath, apiKey,
      key: await readFile(keyPath), cert: await readFile(certPath),
      remove: () => rm(root, { recursive: true, force: true }) };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
